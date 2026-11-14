/**
 * The EVM account backed by AWS KMS: the relayer's
 * transactions and the binder's EIP-712 binding, signed through `KmsClient` against the fake in
 * `fake-kms.ts`. The anvil run in `kms-anvil.integration.test.ts` proves the same on real bytecode.
 */
import { bindingTypedData } from "@dropchad/shared";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  getAddress,
  hashTypedData,
  hexToBigInt,
  hexToBytes,
  parseEther,
  parseSignature,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { evmBinderFromAccount } from "../src/binder/binders.js";
import {
  createReadClient,
  createViemRelayerTransport,
  getServedEvmChain,
} from "../src/chain/client.js";
import { derSignatureToRs, kmsEvmAccount } from "../src/chain/evm/kms-account.js";
import { KmsKeyError } from "../src/chain/kms.js";
import { createFakeKms, derSignature } from "./fake-kms.js";

// Anvil's published test accounts 2 and 3. Play money only.
const RELAYER_SECRET = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const BINDER_SECRET = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const HALF_N = secp256k1.CURVE.n / 2n;

function kmsWith(options: { highS?: boolean } = {}) {
  const kms = createFakeKms();
  kms.addSecp256k1("relayer", RELAYER_SECRET, options);
  kms.addSecp256k1("binder", BINDER_SECRET, options);
  return kms;
}

const BINDING = {
  drop: "0x5d2de86e3D602F8874d32B47b97F4f25b82CCac8" as Address,
  chainId: 46630,
  index: 0,
  xId: 44196397n,
  recipient: "0xBF46c6446A03419ACcD198d12F333a922a24301a" as Address,
};

describe("the KMS EVM account", () => {
  it("takes its address from GetPublicKey, the same as the local key", async () => {
    const kms = kmsWith();
    const account = await kmsEvmAccount(kms.client, "relayer");
    expect(account.address).toBe(privateKeyToAccount(RELAYER_SECRET).address);
    expect(kms.calls).toHaveLength(0);
  });

  it("refuses a key with the wrong spec or usage before any sign", async () => {
    const kms = createFakeKms();
    kms.addOther("nist", "ECC_NIST_P256", "SIGN_VERIFY");
    kms.addOther("crypt", "ECC_SECG_P256K1", "ENCRYPT_DECRYPT");
    await expect(kmsEvmAccount(kms.client, "nist")).rejects.toBeInstanceOf(KmsKeyError);
    await expect(kmsEvmAccount(kms.client, "crypt")).rejects.toBeInstanceOf(KmsKeyError);
    expect(kms.calls).toHaveLength(0);
  });

  it("signs the EIP-712 binding: recovers to the key, low s, a 32 byte DIGEST", async () => {
    for (const highS of [false, true]) {
      const kms = kmsWith({ highS });
      const account = await kmsEvmAccount(kms.client, "binder");
      const typed = bindingTypedData(BINDING);
      const signature = await account.signTypedData(typed);

      expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(account.address);
      expect(hexToBigInt(parseSignature(signature).s)).toBeLessThanOrEqual(HALF_N);
      expect(kms.calls).toHaveLength(1);
      expect(kms.calls[0]?.algorithm).toBe("ECDSA_SHA_256");
      expect(kms.calls[0]?.messageType).toBe("DIGEST");
      expect(kms.calls[0]?.message).toEqual(hexToBytes(hashTypedData(typed)));
    }
  });

  it("signs an EIP-1559 transaction that recovers to the key", async () => {
    for (const highS of [false, true]) {
      const kms = kmsWith({ highS });
      const account = await kmsEvmAccount(kms.client, "relayer");
      const serialized = (await account.signTransaction({
        type: "eip1559",
        chainId: 46630,
        nonce: 7,
        to: BINDING.recipient,
        value: parseEther("0.001"),
        data: "0x",
        gas: 21_000n,
        maxFeePerGas: 100_000_000n,
        maxPriorityFeePerGas: 0n,
      })) as TransactionSerialized;

      expect(await recoverTransactionAddress({ serializedTransaction: serialized })).toBe(
        account.address,
      );
      const parsed = parseTransaction(serialized);
      expect(parsed.chainId).toBe(46630);
      expect(parsed.nonce).toBe(7);
      expect(getAddress(parsed.to ?? "0x")).toBe(BINDING.recipient);
      expect(parsed.value).toBe(parseEther("0.001"));
      expect(hexToBigInt(parsed.s ?? "0x0")).toBeLessThanOrEqual(HALF_N);
    }
  });

  it("signs a plain message that recovers to the key", async () => {
    const kms = kmsWith({ highS: true });
    const account = await kmsEvmAccount(kms.client, "relayer");
    const signature = await account.signMessage({ message: "gm" });
    expect(await recoverMessageAddress({ message: "gm", signature })).toBe(account.address);
  });

  it("a failed KMS sign rejects, nothing is returned", async () => {
    const kms = kmsWith();
    const account = await kmsEvmAccount(kms.client, "binder");
    kms.failSigns(new Error("ThrottlingException"));
    await expect(account.signTypedData(bindingTypedData(BINDING))).rejects.toThrow(
      "ThrottlingException",
    );
  });
});

describe("the DER signature from KMS", () => {
  it("reads r and s, with a padded r and a short s", () => {
    // n - 1: the high bit is set, so DER pads it with a zero byte.
    const r = secp256k1.CURVE.n - 1n;
    const s = 0x0102n;
    expect(derSignatureToRs(derSignature(r, s))).toEqual({ r, s });
  });

  it("refuses bytes that are not a DER signature", () => {
    expect(() => derSignatureToRs(Uint8Array.from([0x31, 0x00]))).toThrow();
    expect(() => derSignatureToRs(Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01]))).toThrow();
  });
});

describe("the binder and the relayer on a KMS account", () => {
  it("the binder signs the binding with the account", async () => {
    const kms = kmsWith({ highS: true });
    const account = await kmsEvmAccount(kms.client, "binder");
    const binder = evmBinderFromAccount(account);
    expect(binder.address).toBe(account.address);
    const signature = await binder.sign(BINDING);
    expect(await recoverTypedDataAddress({ ...bindingTypedData(BINDING), signature })).toBe(
      account.address,
    );
  });

  it("the relayer transport takes an account in place of a raw key", async () => {
    const kms = kmsWith();
    const account = await kmsEvmAccount(kms.client, "relayer");
    const chain = getServedEvmChain("robinhood-testnet");
    const rpcUrls = "http://127.0.0.1:1";
    const publicClient = createReadClient(chain, rpcUrls);

    const transport = createViemRelayerTransport({ chain, rpcUrls, account, publicClient });
    expect(transport.address).toBe(account.address);
    expect(() =>
      createViemRelayerTransport({
        chain,
        rpcUrls,
        account,
        privateKey: RELAYER_SECRET,
        publicClient,
      }),
    ).toThrow();
  });
});

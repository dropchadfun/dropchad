/**
 * The KMS EVM account on a real EVM. Anvil, the real
 * `BinderRegistryV2`, `DropV6` and `DropFactoryV6` bytecode, the real relayer: a KMS relayer
 * key sends `createDrop`, `activate` and `claimHandle`, and a KMS binder key signs the binding
 * that `DropV6` checks with OpenZeppelin `ECDSA`, which refuses a high `s`. The fake KMS answers
 * with a high `s` on purpose, so the claim only pays if the account moved it to the low half.
 *
 * It skips itself when anvil is not installed or the contracts are not built, like
 * `anvil.integration.test.ts`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getChain } from "@dropchad/chains";
import {
  binderRegistryV2Abi,
  buildHandleDropTree,
  dropFactoryV6Abi,
  dropV6Abi,
} from "@dropchad/shared";
import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evmBinderFromAccount } from "../src/binder/binders.js";
import { createReadClient, createViemRelayerTransport, toViemChain } from "../src/chain/client.js";
import { kmsEvmAccount } from "../src/chain/evm/kms-account.js";
import { createRelayer } from "../src/chain/relayer.js";
import type { ServedEvmChain } from "../src/chain/write-side.js";
import { createFakeKms } from "./fake-kms.js";

// Anvil's published test accounts 0, 2, 3 and 4. Play money on a local node only.
const DEPLOYER_SECRET = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const KMS_RELAYER_SECRET =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const KMS_BINDER_SECRET =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const FUNDER_SECRET = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex;

const RECIPIENT = getAddress("0x5555555555555555555555555555555555550005");
const X_ID = 44196397n;
const AMOUNT = parseEther("0.01");
const CHAIN_ID = 46630;
const PORT = 8548;
const RPC_URL = `http://127.0.0.1:${String(PORT)}`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "contracts", "evm", "out");
const v6Built = existsSync(join(outDir, "DropFactoryV6.sol", "DropFactoryV6.json"));
const anvilBinary = process.platform === "win32" ? "anvil.exe" : "anvil";

function artifactBytecode(file: string, name: string): Hex {
  const json = JSON.parse(readFileSync(join(outDir, file, `${name}.json`), "utf8")) as {
    bytecode: { object: string };
  };
  return json.bytecode.object as Hex;
}

/** A V6 only registry entry for anvil, the mainnet shape. */
function anvilV6Chain(factory: Address, implementation: Address, registry: Address) {
  return {
    key: "anvil",
    name: "Anvil",
    kind: "testnet",
    family: "evm",
    chainId: CHAIN_ID,
    status: "active",
    displayOrder: null,
    nativeSymbol: "ETH",
    explorer: null,
    explorerKind: null,
    rpcEnv: "ANVIL_RPC_URL",
    archiveRpcEnv: null,
    fallbackRpcEnv: null,
    finalityDepth: null,
    contracts: {
      ...getChain("robinhood").contracts,
      factoryV6: factory,
      implementationV6: implementation,
      binderRegistryV2: registry,
      deployBlockV6: 0,
    },
    launchpadFactories: [],
    quickTokens: [],
  } as unknown as ServedEvmChain;
}

let anvil: ChildProcess | undefined;
let started = false;
let skipReason = "";

async function waitForAnvil(): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

beforeAll(async () => {
  if (!v6Built) {
    skipReason = "DropFactoryV6 is not built. Run: cd contracts/evm && forge build";
    return;
  }
  try {
    anvil = spawn(anvilBinary, [
      "--port",
      String(PORT),
      "--chain-id",
      String(CHAIN_ID),
      "--silent",
    ]);
  } catch {
    skipReason = "anvil is not installed";
    return;
  }
  anvil.on("error", () => {
    skipReason = "anvil could not be started";
  });
  started = await waitForAnvil();
  if (!started) skipReason = skipReason || "anvil did not come up on time";
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

describe("K2: a KMS relayer and a KMS binder on a real EVM", () => {
  it("creates, activates and pays a handle claim on DropV6", async () => {
    if (!started) {
      console.log(`skipping the KMS anvil test: ${skipReason}`);
      return;
    }

    // 1. the two KMS keys, both answering with a high s
    const kms = createFakeKms();
    kms.addSecp256k1("relayer", KMS_RELAYER_SECRET, { highS: true });
    kms.addSecp256k1("binder", KMS_BINDER_SECRET, { highS: true });
    const relayerAccount = await kmsEvmAccount(kms.client, "relayer");
    const binder = evmBinderFromAccount(await kmsEvmAccount(kms.client, "binder"));

    // 2. deploy the V6 trio, the KMS binder set, the KMS relayer allowed and funded
    const deployer = privateKeyToAccount(DEPLOYER_SECRET);
    const funder = privateKeyToAccount(FUNDER_SECRET);
    const boot = anvilV6Chain(deployer.address, deployer.address, deployer.address);
    const viemChain = toViemChain(boot, RPC_URL);
    const publicClient: PublicClient = createReadClient(boot, RPC_URL);
    const deployerWallet = createWalletClient({
      account: deployer,
      chain: viemChain,
      transport: http(RPC_URL),
    });
    const funderWallet = createWalletClient({
      account: funder,
      chain: viemChain,
      transport: http(RPC_URL),
    });
    const mined = (hash: Hex) => publicClient.waitForTransactionReceipt({ hash });
    const deployed = async (hash: Hex) => (await mined(hash)).contractAddress as Address;

    const registry = await deployed(
      await deployerWallet.deployContract({
        abi: binderRegistryV2Abi,
        bytecode: artifactBytecode("BinderRegistryV2.sol", "BinderRegistryV2"),
        args: [deployer.address],
      }),
    );
    const implementation = await deployed(
      await deployerWallet.deployContract({
        abi: dropV6Abi,
        bytecode: artifactBytecode("DropV6.sol", "DropV6"),
        args: [registry],
      }),
    );
    const factory = await deployed(
      await deployerWallet.deployContract({
        abi: dropFactoryV6Abi,
        bytecode: artifactBytecode("DropFactoryV6.sol", "DropFactoryV6"),
        args: [deployer.address, implementation, deployer.address],
      }),
    );
    await mined(
      await deployerWallet.writeContract({
        address: registry,
        abi: binderRegistryV2Abi,
        functionName: "setBinder",
        args: [binder.address],
        chain: viemChain,
      }),
    );
    await mined(
      await deployerWallet.writeContract({
        address: factory,
        abi: dropFactoryV6Abi,
        functionName: "setCreatorAllowed",
        args: [relayerAccount.address, true],
        chain: viemChain,
      }),
    );
    await mined(
      await funderWallet.sendTransaction({
        to: relayerAccount.address,
        value: parseEther("1"),
        chain: viemChain,
        account: funder,
      }),
    );

    // 3. the real relayer over a transport that signs with the KMS account
    const chain = anvilV6Chain(factory, implementation, registry);
    const commitment = keccak256(stringToHex("k2 kms anvil"));
    const nonce = 1n;
    const drop = getAddress(
      await publicClient.readContract({
        address: factory,
        abi: dropFactoryV6Abi,
        functionName: "predictDrop",
        args: [relayerAccount.address, commitment, nonce],
      }),
    );
    const relayer = createRelayer({
      transport: createViemRelayerTransport({
        chain,
        rpcUrls: RPC_URL,
        account: relayerAccount,
        publicClient,
      }),
      factory,
      factoryVersion: 6,
      isKnownDrop: (address) => Promise.resolve(getAddress(address) === drop),
      gasBudget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
      gasCaps: { createDrop: 3_000_000n, claimBatch: 5_000_000n, claimHandle: 300_000n },
    });

    // 4. create a one leaf handle drop, fund it, activate
    const tree = buildHandleDropTree({
      drop,
      chainId: CHAIN_ID,
      receivers: [{ xId: X_ID, amount: AMOUNT }],
    });
    const created = await relayer.createDrop({
      asset: zeroAddress,
      merkleRoot: tree.root,
      manifestHash: keccak256(stringToHex("k2 manifest")),
      totalEntitlements: tree.totalEntitlements,
      leafCount: tree.leafCount,
      refundRecipient: funder.address,
      creatorCommitment: commitment,
      nonce,
      fundingPeriod: 24 * 60 * 60,
      claimPeriod: 7 * 24 * 60 * 60,
      tokenFactory: zeroAddress,
    });
    expect(created.receipt.status).toBe("success");

    const gross = await publicClient.readContract({
      address: drop,
      abi: dropV6Abi,
      functionName: "grossRequired",
    });
    await mined(
      await funderWallet.sendTransaction({
        to: drop,
        value: gross,
        chain: viemChain,
        account: funder,
      }),
    );
    const activated = await relayer.activate(drop);
    expect(activated.receipt.status).toBe("success");

    // 5. the KMS binder signs, the KMS relayer claims, DropV6 pays
    const entry = tree.entries[0];
    if (entry === undefined) throw new Error("no leaf");
    const signature = await binder.sign({
      drop,
      chainId: CHAIN_ID,
      index: entry.index,
      xId: X_ID,
      recipient: RECIPIENT,
    });
    const claimed = await relayer.claimHandle(drop, {
      index: BigInt(entry.index),
      xId: X_ID,
      amount: AMOUNT,
      recipient: RECIPIENT,
      proof: entry.proof,
      signature,
    });
    expect(claimed.receipt.status).toBe("success");
    expect(await publicClient.getBalance({ address: RECIPIENT })).toBe(AMOUNT);

    // 6. every relayer transaction is from the KMS address
    for (const { hash } of [created, activated, claimed]) {
      const tx = await publicClient.getTransaction({ hash });
      expect(getAddress(tx.from)).toBe(relayerAccount.address);
    }
    expect(kms.calls.filter((call) => call.keyId === "relayer")).toHaveLength(3);
    expect(kms.calls.filter((call) => call.keyId === "binder")).toHaveLength(1);
  }, 120_000);
});

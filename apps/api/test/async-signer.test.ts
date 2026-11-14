/**
 * Every Solana signer is async, local and remote alike, so a KMS key can sign through the same
 * interface. No behaviour change for a local key.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it } from "vitest";

import { setComputeUnitLimit } from "../src/chain/svm/instructions.js";
import { randomSigner, signerFromSecret, type Signer } from "../src/chain/svm/keypair.js";
import { SYSTEM_PROGRAM_ID } from "../src/chain/svm/pubkey.js";
import {
  compileMessage,
  serializeMessage,
  signTransaction,
  verifySignature,
} from "../src/chain/svm/transaction.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A signer that answers later, the way a remote key does. */
function slowSigner(ms: number): Signer {
  const seed = ed25519.utils.randomPrivateKey();
  return {
    publicKey: ed25519.getPublicKey(seed),
    sign: async (message: Uint8Array) => {
      await delay(ms);
      return ed25519.sign(message, seed);
    },
  };
}

function messageFor(feePayer: Signer, second?: Signer) {
  return compileMessage({
    feePayer: feePayer.publicKey,
    recentBlockhash: new Uint8Array(32).fill(3),
    instructions:
      second === undefined
        ? [setComputeUnitLimit(200_000)]
        : [
            setComputeUnitLimit(200_000),
            {
              programId: SYSTEM_PROGRAM_ID,
              keys: [{ pubkey: second.publicKey, isSigner: true, isWritable: false }],
              data: new Uint8Array(0),
            },
          ],
  });
}

describe("the async Solana signer", () => {
  it("a local signer's sign returns a promise of a valid signature", async () => {
    const seed = ed25519.utils.randomPrivateKey();
    const pub = ed25519.getPublicKey(seed);
    const local = signerFromSecret(JSON.stringify([...seed, ...pub]));
    const message = new TextEncoder().encode("gm");

    const pending = local.sign(message);
    expect(pending).toBeInstanceOf(Promise);
    expect(ed25519.verify(await pending, message, pub)).toBe(true);
    expect(randomSigner().sign(message)).toBeInstanceOf(Promise);
  });

  it("signTransaction returns a promise", async () => {
    const signer = randomSigner();
    const pending = signTransaction(messageFor(signer), [signer]);
    expect(pending).toBeInstanceOf(Promise);
    expect(verifySignature(await pending)).toBe(true);
  });

  it("waits for a signer that answers later", async () => {
    const signer = slowSigner(10);
    const message = messageFor(signer);
    const tx = await signTransaction(message, [signer]);
    expect(verifySignature(tx)).toBe(true);
    expect(
      ed25519.verify(tx.signatures[0] as Uint8Array, serializeMessage(message), signer.publicKey),
    ).toBe(true);
  });

  it("keeps the header order when the second signer answers first", async () => {
    const first = slowSigner(30);
    const second = slowSigner(1);
    const message = messageFor(first, second);
    expect(message.header.numRequiredSignatures).toBe(2);

    const tx = await signTransaction(message, [second, first]);
    expect(verifySignature(tx, 0)).toBe(true);
    expect(verifySignature(tx, 1)).toBe(true);
    expect(tx.bytes.length).toBe(1 + 64 * 2 + tx.messageBytes.length);
  });

  it("a signer that fails rejects the promise, nothing is returned", async () => {
    const good = randomSigner();
    const failing: Signer = {
      publicKey: good.publicKey,
      sign: async () => {
        await delay(1);
        throw new Error("signer unavailable");
      },
    };
    await expect(signTransaction(messageFor(failing), [failing])).rejects.toThrow(
      "signer unavailable",
    );
  });
});

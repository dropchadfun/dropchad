/**
 * The Solana primitives written in house: PDAs, the transaction wire format, the keypair parser
 * and the instruction encoding. Every number below is pinned to something outside this code: the
 * fixture, the Solana docs example, the real devnet `ProgramData` address, and
 * the transaction sizes the Rust batching tests measured.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { dropchadIdl } from "@dropchad/shared";
import { hexToBytes } from "viem";
import { describe, expect, it } from "vitest";

import {
  activateInstruction,
  cancelUnfundedInstruction,
  claimHandleInstruction,
  claimInstruction,
  closeDropInstruction,
  createDropInstruction,
  discriminatorOf,
  encodeCreateParams,
  initializeConfigInstruction,
  instructionNameOf,
  refundInstruction,
  setComputeUnitLimit,
  setComputeUnitPrice,
  setDefaultFeeBpsInstruction,
} from "../src/chain/svm/instructions.js";
import { SecretFormatError, randomSigner, signerFromSecret } from "../src/chain/svm/keypair.js";
import {
  bitmapPda,
  configPda,
  dropPda,
  findProgramAddress,
  programDataPda,
} from "../src/chain/svm/pda.js";
import {
  BPF_UPGRADEABLE_LOADER_ID,
  DROPCHAD_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  pubkeyFromBase58,
  pubkeyToBase58,
} from "../src/chain/svm/pubkey.js";
import {
  MAX_TRANSACTION_BYTES,
  compileMessage,
  encodeShortVec,
  serializeMessage,
  signTransaction,
  transactionSize,
  verifySignature,
} from "../src/chain/svm/transaction.js";
import { decodeTransaction } from "./fake-svm.js";

/** step 1. The same commitment as the EVM example. */
const COMMITMENT = hexToBytes("0x9c9c4b2787ccf315857d894a848d0d5dd248723d87fe8b14759584b4e56f67d6");

describe("program derived addresses", () => {
  it("derives the drop, bitmap and config PDAs of the worked example, bumps included", () => {
    const drop = dropPda(COMMITMENT, 0n);
    expect(pubkeyToBase58(drop.address)).toBe("G5wphfR2mffv3dd2yWb5eFioBf1BFGVtAZfbG6CXQbh5");
    expect(drop.bump).toBe(255);

    const bitmap = bitmapPda(drop.address);
    expect(pubkeyToBase58(bitmap.address)).toBe("GXTteQJdJkJmQPenaKHEt1WZTttZS2ZwyEWUhGbZ9w98");
    expect(bitmap.bump).toBe(255);

    const config = configPda();
    expect(pubkeyToBase58(config.address)).toBe("bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD");
    expect(config.bump).toBe(255);
  });

  it("rejects an on curve candidate, like the Solana docs example at bump 255", () => {
    const pda = findProgramAddress([new TextEncoder().encode("helloWorld")], SYSTEM_PROGRAM_ID);
    expect(pubkeyToBase58(pda.address)).toBe("46GZzzetjCURsdFPb7rcnspbEMnCBXe9kpjrsZAkKb6X");
    expect(pda.bump).toBe(254);
  });

  it("derives the real devnet ProgramData address, as `solana program show` printed it", () => {
    // recorded. The upgrade authority check of the design reads this account.
    expect(pubkeyToBase58(programDataPda().address)).toBe(
      "76JPAERZztsCTSUExJXiAMABnbvJfRcqMM5erCjTnTR",
    );
    expect(pubkeyToBase58(BPF_UPGRADEABLE_LOADER_ID)).toBe(
      "BPFLoaderUpgradeab1e11111111111111111111111",
    );
  });

  it("reads the program id from the IDL", () => {
    expect(pubkeyToBase58(DROPCHAD_PROGRAM_ID)).toBe(dropchadIdl.address);
    expect(dropchadIdl.address).toBe("EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft");
  });

  it("refuses a seed over 32 bytes", () => {
    expect(() => findProgramAddress([new Uint8Array(33)], DROPCHAD_PROGRAM_ID)).toThrow(/32 bytes/);
  });
});

describe("shortvec", () => {
  it("encodes the way the runtime reads it", () => {
    expect([...encodeShortVec(0)]).toEqual([0]);
    expect([...encodeShortVec(1)]).toEqual([1]);
    expect([...encodeShortVec(127)]).toEqual([127]);
    expect([...encodeShortVec(128)]).toEqual([0x80, 0x01]);
    expect([...encodeShortVec(300)]).toEqual([0xac, 0x02]);
    expect([...encodeShortVec(16383)]).toEqual([0xff, 0x7f]);
  });
});

describe("the legacy transaction", () => {
  const signer = randomSigner();
  const drop = dropPda(COMMITMENT, 0n).address;
  const bitmap = bitmapPda(drop).address;
  const recipient = pubkeyFromBase58("CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB");

  const claim = (depth: number, index = 0) =>
    claimInstruction({
      caller: signer.publicKey,
      drop,
      bitmap,
      recipient,
      index,
      amount: 1_000_000_000n,
      proof: Array.from({ length: depth }, (_, i) => new Uint8Array(32).fill(i + 1)),
    });

  it("compiles the payer first and orders the rest as the header says", () => {
    const message = compileMessage({
      feePayer: signer.publicKey,
      recentBlockhash: new Uint8Array(32),
      instructions: [claim(2)],
    });
    expect(message.accountKeys[0]).toEqual(signer.publicKey);
    expect(message.header.numRequiredSignatures).toBe(1);
    expect(message.header.numReadonlySigned).toBe(0);
    // Writable non-signers: drop, bitmap, recipient. Readonly: the program (absent slots), system.
    const writable = message.accountKeys.slice(1, 4).map(pubkeyToBase58);
    expect(writable).toEqual([drop, bitmap, recipient].map(pubkeyToBase58));
    expect(message.header.numReadonlyUnsigned).toBe(2);
    // Ten account slots per SOL claim, five of them the program id.
    expect(message.instructions[0]?.accountIndexes).toHaveLength(10);
  });

  it("produces the byte sizes the Rust batching tests measured", () => {
    const size = (depth: number, count: number) =>
      transactionSize({
        feePayer: signer.publicKey,
        instructions: Array.from({ length: count }, (_, i) =>
          claimInstruction({
            caller: signer.publicKey,
            drop,
            bitmap,
            // Distinct recipients, as in a real batch: each one is a new key in the message.
            recipient: new Uint8Array(32).fill(0xa0 + i),
            index: i,
            amount: 1_000_000_000n,
            proof: Array.from({ length: depth }, (_, j) => new Uint8Array(32).fill(j + 1)),
          }),
        ),
      });
    expect(size(14, 1)).toBe(780);
    expect(size(14, 2)).toBe(1298);
    expect(size(1, 9)).toBe(1171);
    expect(size(3, 5)).toBe(1087);
    expect(size(14, 2)).toBeGreaterThan(MAX_TRANSACTION_BYTES);
  });

  it("signs the message bytes with ed25519 and refuses one over 1,232 bytes", () => {
    const message = compileMessage({
      feePayer: signer.publicKey,
      recentBlockhash: new Uint8Array(32).fill(7),
      instructions: [setComputeUnitLimit(200_000), claim(3)],
    });
    const tx = signTransaction(message, [signer]);
    expect(tx.signatures).toHaveLength(1);
    expect(verifySignature(tx)).toBe(true);
    expect(
      ed25519.verify(tx.signatures[0] as Uint8Array, serializeMessage(message), signer.publicKey),
    ).toBe(true);
    expect(tx.bytes.length).toBe(1 + 64 + tx.messageBytes.length);

    const tooBig = compileMessage({
      feePayer: signer.publicKey,
      recentBlockhash: new Uint8Array(32),
      instructions: [claim(14, 0), claim(14, 1)],
    });
    expect(() => signTransaction(tooBig, [signer])).toThrow(/1232/);
  });

  it("round trips through the fake cluster's decoder", () => {
    const message = compileMessage({
      feePayer: signer.publicKey,
      recentBlockhash: new Uint8Array(32).fill(9),
      instructions: [setComputeUnitPrice(5n), claim(4, 3)],
    });
    const tx = signTransaction(message, [signer]);
    const decoded = decodeTransaction(tx.bytes);
    expect(decoded.signatures[0]).toEqual(tx.signatures[0]);
    expect(decoded.message.header).toEqual(message.header);
    expect(decoded.message.accountKeys.map(pubkeyToBase58)).toEqual(
      message.accountKeys.map(pubkeyToBase58),
    );
    expect(decoded.message.instructions).toEqual(message.instructions);
  });

  it("refuses to sign when a required signer is missing", () => {
    const other = randomSigner();
    const message = compileMessage({
      feePayer: signer.publicKey,
      recentBlockhash: new Uint8Array(32),
      instructions: [claim(1)],
    });
    expect(() => signTransaction(message, [other])).toThrow(/missing signer/);
  });
});

/**
 * The accounts of `ix` match the IDL entry for `name`: the count, the signer flag, and the
 * writable flag of every present account. The IDL's entries only carry the flags that are set,
 * so they are read loosely. Anchor passes an absent optional account as the program id,
 * readonly, whatever the flags say for the present case; that is what the Rust tests'
 * `to_account_metas` does.
 */
function expectIdlLayout(
  name: string,
  ix: {
    keys: readonly { pubkey: Uint8Array; isSigner: boolean; isWritable: boolean }[];
    data: Uint8Array;
  },
): void {
  const idl = dropchadIdl.instructions.find((i) => i.name === name);
  expect(idl, name).toBeDefined();
  expect(instructionNameOf(ix.data)).toBe(name);
  const flags = (idl?.accounts ?? []) as readonly {
    name: string;
    signer?: boolean;
    writable?: boolean;
    optional?: boolean;
  }[];
  expect(ix.keys, `${name} account count`).toHaveLength(flags.length);
  flags.forEach((account, i) => {
    const key = ix.keys[i];
    expect(key?.isSigner, `${name}.${account.name} signer`).toBe(account.signer === true);
    if (account.optional === true) {
      expect(key?.pubkey, `${name}.${account.name} absent`).toEqual(DROPCHAD_PROGRAM_ID);
      expect(key?.isWritable, `${name}.${account.name} absent readonly`).toBe(false);
    } else {
      expect(key?.isWritable, `${name}.${account.name} writable`).toBe(account.writable === true);
    }
  });
}

describe("instruction encoding from the IDL", () => {
  it("uses the IDL discriminator for every instruction and maps bytes back to a name", () => {
    for (const ix of dropchadIdl.instructions) {
      const disc = discriminatorOf(ix.name);
      expect([...disc]).toEqual([...ix.discriminator]);
      expect(instructionNameOf(disc)).toBe(ix.name);
    }
    expect(instructionNameOf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(instructionNameOf(new Uint8Array(3))).toBeNull();
  });

  it("encodes CreateParams as 164 borsh bytes in IDL field order, sol_fee_lamports last", () => {
    const bytes = encodeCreateParams({
      merkleRoot: new Uint8Array(32).fill(1),
      manifestHash: new Uint8Array(32).fill(2),
      totalEntitlements: 6_000_000_000n,
      leafCount: 3,
      refundRecipient: new Uint8Array(32).fill(3),
      creatorCommitment: COMMITMENT,
      nonce: 7n,
      fundingPeriod: 604_800,
      claimPeriod: 2_592_000,
      solFeeLamports: 123_456_789n,
    });
    expect(bytes.length).toBe(32 + 32 + 8 + 4 + 32 + 32 + 8 + 4 + 4 + 8);
    // total_entitlements, little endian u64, right after the two hashes
    expect(new DataView(bytes.buffer).getBigUint64(64, true)).toBe(6_000_000_000n);
    expect(new DataView(bytes.buffer).getUint32(72, true)).toBe(3);
    expect(new DataView(bytes.buffer).getBigUint64(140, true)).toBe(7n);
    expect(new DataView(bytes.buffer).getBigUint64(156, true)).toBe(123_456_789n);
  });

  it("names the CreateParams fields in the same order as the IDL type", () => {
    const type = (
      dropchadIdl.types as readonly {
        name: string;
        type: { fields?: readonly { name: string }[] };
      }[]
    ).find((t) => t.name === "CreateParams");
    expect(type?.type.fields?.map((f) => f.name)).toEqual([
      "merkle_root",
      "manifest_hash",
      "total_entitlements",
      "leaf_count",
      "refund_recipient",
      "creator_commitment",
      "nonce",
      "funding_period",
      "claim_period",
      "sol_fee_lamports",
    ]);
  });

  it("lays the create_drop accounts out as the IDL declares them, absent SPL slots as the program id", () => {
    const relayer = randomSigner().publicKey;
    const drop = dropPda(COMMITMENT, 0n).address;
    const ix = createDropInstruction({
      relayer,
      drop,
      bitmap: bitmapPda(drop).address,
      params: {
        merkleRoot: new Uint8Array(32).fill(1),
        manifestHash: new Uint8Array(32).fill(2),
        totalEntitlements: 1n,
        leafCount: 1,
        refundRecipient: new Uint8Array(32).fill(3),
        creatorCommitment: COMMITMENT,
        nonce: 0n,
        fundingPeriod: 3600,
        claimPeriod: 86_400,
        solFeeLamports: 0n,
      },
    });
    expectIdlLayout("create_drop", ix);
    expect(pubkeyToBase58(ix.keys[1]?.pubkey as Uint8Array)).toBe(
      "bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD",
    );
    expect(ix.data.length).toBe(8 + 164);
    // A SOL drop sends a zero SOL fee.
    expect(new DataView(ix.data.buffer).getBigUint64(8 + 156, true)).toBe(0n);
  });

  it("lays every SOL drop instruction out as the IDL declares it", () => {
    const me = randomSigner().publicKey;
    const other = randomSigner().publicKey;
    const drop = dropPda(COMMITMENT, 0n).address;
    const bitmap = bitmapPda(drop).address;
    const proof = [new Uint8Array(32).fill(9)];
    expectIdlLayout("activate", activateInstruction({ caller: me, drop, feeWallet: other }));
    expectIdlLayout(
      "claim",
      claimInstruction({ caller: me, drop, bitmap, recipient: other, index: 0, amount: 1n, proof }),
    );
    expectIdlLayout(
      "claim_handle",
      claimHandleInstruction({
        caller: me,
        drop,
        bitmap,
        recipient: other,
        index: 0,
        xId: 1n,
        amount: 1n,
        proof,
      }),
    );
    expectIdlLayout("refund", refundInstruction({ caller: me, drop, refundRecipient: other }));
    expectIdlLayout(
      "cancel_unfunded",
      cancelUnfundedInstruction({ caller: me, drop, refundRecipient: other }),
    );
    expectIdlLayout(
      "close_drop",
      closeDropInstruction({ caller: me, drop, bitmap, rentPayer: other, refundRecipient: other }),
    );
  });

  it("activate has six accounts and no fee token account", () => {
    const ix = activateInstruction({
      caller: randomSigner().publicKey,
      drop: dropPda(COMMITMENT, 0n).address,
      feeWallet: randomSigner().publicKey,
    });
    expect(ix.keys).toHaveLength(6);
    const idl = dropchadIdl.instructions.find((i) => i.name === "activate");
    expect(idl?.accounts.map((a) => a.name)).toEqual([
      "caller",
      "drop",
      "fee_wallet",
      "mint",
      "vault",
      "token_program",
    ]);
  });

  it("builds initialize_config against the ProgramData account of the program", () => {
    const authority = randomSigner().publicKey;
    const ix = initializeConfigInstruction({
      authority,
      chainId: 103n,
      relayer: new Uint8Array(32).fill(4),
      feeWallet: new Uint8Array(32).fill(5),
      defaultFeeBps: 0,
    });
    expect(pubkeyToBase58(ix.keys[3]?.pubkey as Uint8Array)).toBe(
      "76JPAERZztsCTSUExJXiAMABnbvJfRcqMM5erCjTnTR",
    );
    expect(ix.keys[0]?.isSigner).toBe(true);
    // 8 disc + u64 + 32 + 32 + u16
    expect(ix.data.length).toBe(8 + 8 + 32 + 32 + 2);
    expect(new DataView(ix.data.buffer).getBigUint64(8, true)).toBe(103n);
  });

  it("builds set_default_fee_bps as admin signer, config writable, a u16 after the discriminator", () => {
    const admin = randomSigner().publicKey;
    const ix = setDefaultFeeBpsInstruction({ admin, bps: 100 });
    expect(instructionNameOf(ix.data)).toBe("set_default_fee_bps");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.pubkey).toBe(admin);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(pubkeyToBase58(ix.keys[1]?.pubkey as Uint8Array)).toBe(
      "bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD",
    );
    expect(ix.keys[1]?.isWritable).toBe(true);
    expect(ix.keys[1]?.isSigner).toBe(false);
    expect(ix.data.length).toBe(8 + 2);
    expect(new DataView(ix.data.buffer).getUint16(8, true)).toBe(100);
  });

  it("encodes the two compute budget instructions", () => {
    expect([...setComputeUnitLimit(200_000).data]).toEqual([2, 0x40, 0x0d, 0x03, 0x00]);
    expect([...setComputeUnitPrice(1n).data]).toEqual([3, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("the relayer secret", () => {
  const seed = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(seed);
  const asArray = JSON.stringify([...seed, ...pub]);

  it("parses the JSON array solana-keygen writes and derives the address", () => {
    const signer = signerFromSecret(asArray);
    expect(signer.publicKey).toEqual(pub);
    const message = new TextEncoder().encode("gm");
    expect(ed25519.verify(signer.sign(message), message, pub)).toBe(true);
  });

  it("refuses a secret whose public half does not match the seed, without echoing it", () => {
    const corrupt = JSON.stringify([...seed, ...new Uint8Array(32).fill(9)]);
    let caught: unknown;
    try {
      signerFromSecret(corrupt);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SecretFormatError);
    expect((caught as Error).message).not.toContain(String(seed[0]));
    expect((caught as Error).message).toMatch(/corrupt/);
  });

  it("refuses the wrong length and junk", () => {
    expect(() => signerFromSecret(JSON.stringify([...seed]))).toThrow(/64 bytes/);
    expect(() => signerFromSecret("not a key at all!!")).toThrow(SecretFormatError);
    expect(() => signerFromSecret("[1, 2, 300]")).toThrow(/0 to 255/);
  });
});

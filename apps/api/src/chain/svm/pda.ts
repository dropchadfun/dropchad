/**
 * Program derived addresses.
 *
 * A PDA is `sha256(seeds ‖ bump ‖ program id ‖ "ProgramDerivedAddress")`, tried from bump 255
 * downwards until the result is **not** a point on the ed25519 curve. That is the whole
 * derivation, and it is why a PDA has no private key: nobody can sign for it, only the program.
 *
 * Written out here rather than pulled from a client library for the same reason base58 is in
 * house in `packages/shared`: forty lines, one fixture to pin them, no new dependency. The on
 * curve check comes from `@noble/curves`, which viem already brings into the tree and which the
 * api now names as its own dependency.
 *
 * The 7.4 worked example pins every derivation below: the drop PDA, the bitmap PDA and the
 * config PDA, each with its bump. `test/svm-pda.test.ts`.
 */
import { createHash } from "node:crypto";

import { ed25519 } from "@noble/curves/ed25519";

import {
  BPF_UPGRADEABLE_LOADER_ID,
  DROPCHAD_PROGRAM_ID,
  pubkeyEquals,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "./pubkey.js";

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const MAX_SEED_LENGTH = 32;

export interface Pda {
  readonly address: Pubkey;
  readonly bump: number;
}

/** A wallet key is on the curve; a PDA never is. Also the recipient check. */
export function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(Buffer.from(bytes).toString("hex"));
    return true;
  } catch {
    return false;
  }
}

function sha256(...parts: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

/** `Pubkey::find_program_address`. Throws when no bump works, which is astronomically unlikely. */
export function findProgramAddress(seeds: readonly Uint8Array[], programId: Pubkey): Pda {
  for (const seed of seeds) {
    if (seed.length > MAX_SEED_LENGTH)
      throw new Error(`seed longer than ${String(MAX_SEED_LENGTH)} bytes`);
  }
  for (let bump = 255; bump >= 0; bump -= 1) {
    const address = sha256(...seeds, new Uint8Array([bump]), programId, PDA_MARKER);
    if (!isOnCurve(address)) return { address, bump };
  }
  throw new Error("no program address found for these seeds");
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** `["config"]`. One per cluster. */
export function configPda(programId: Pubkey = DROPCHAD_PROGRAM_ID): Pda {
  return findProgramAddress([utf8("config")], programId);
}

/** `["drop", creator_commitment (32), nonce (u64 little endian)]`. */
export function dropPda(
  creatorCommitment: Uint8Array,
  nonce: bigint,
  programId: Pubkey = DROPCHAD_PROGRAM_ID,
): Pda {
  if (creatorCommitment.length !== 32) throw new Error("creator commitment must be 32 bytes");
  const nonceLe = new Uint8Array(8);
  new DataView(nonceLe.buffer).setBigUint64(0, nonce, true);
  return findProgramAddress([utf8("drop"), creatorCommitment, nonceLe], programId);
}

/** `["bitmap", drop (32)]`. */
export function bitmapPda(drop: Pubkey, programId: Pubkey = DROPCHAD_PROGRAM_ID): Pda {
  return findProgramAddress([utf8("bitmap"), drop], programId);
}

/**
 * The `ProgramData` account of an upgradeable program: `[program id]` under the upgradeable
 * loader. `initialize_config` reads the upgrade authority out of it.
 */
export function programDataPda(programId: Pubkey = DROPCHAD_PROGRAM_ID): Pda {
  return findProgramAddress([programId], BPF_UPGRADEABLE_LOADER_ID);
}

/** True when `candidate` is exactly the PDA these seeds derive to. Account substitution. */
export function isPdaFor(candidate: Pubkey, pda: Pda): boolean {
  return pubkeyEquals(candidate, pda.address);
}

/** The classic SPL Token program. */
export const TOKEN_PROGRAM_ID: Pubkey = pubkeyFromBase58(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
/** Token-2022. */
export const TOKEN_2022_PROGRAM_ID: Pubkey = pubkeyFromBase58(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
/** The Associated Token Account program, which the program calls to make the vault. */
export const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey = pubkeyFromBase58(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/**
 * The associated token account of `owner` for `mint` under `tokenProgram`: the seeds
 * token program, mint under the ATA program. A drop's vault is the one of the drop PDA.
 */
export function associatedTokenAddress(owner: Pubkey, mint: Pubkey, tokenProgram: Pubkey): Pubkey {
  return findProgramAddress([owner, tokenProgram, mint], ASSOCIATED_TOKEN_PROGRAM_ID).address;
}

/** The size of one token account of this program: 165 classic, 170 on Token-2022. */
export function tokenAccountBytes(tokenProgram: Pubkey): number {
  return pubkeyToBase58(tokenProgram) === pubkeyToBase58(TOKEN_2022_PROGRAM_ID) ? 170 : 165;
}

/**
 * Solana public keys and the program ids this api talks to.
 *
 * A key is 32 raw bytes. Base58 is the way it is written, `packages/shared` already decodes it.
 * Everything in `chain/svm` passes keys around as `Uint8Array` and turns them into text only at
 * the edges: the database, the api responses, the logs.
 */
import {
  base58Decode,
  base58Encode,
  dropchadIdl,
  isPubkey,
  ED25519_PROGRAM_ID as ED25519_PROGRAM_ID_BASE58,
} from "@dropchad/shared";

export type Pubkey = Uint8Array;

export function pubkeyFromBase58(text: string): Pubkey {
  const bytes = base58Decode(text);
  if (bytes.length !== 32) throw new Error(`not a 32 byte public key: ${text}`);
  return bytes;
}

export function pubkeyToBase58(key: Pubkey): string {
  return base58Encode(key);
}

export function pubkeyEquals(a: Pubkey, b: Pubkey): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export { isPubkey };

/** `Pubkey::default`, all zero. The program's "native SOL" sentinel. */
export const DEFAULT_PUBKEY: Pubkey = new Uint8Array(32);
export const DEFAULT_PUBKEY_BASE58 = pubkeyToBase58(DEFAULT_PUBKEY);

/** The dropchad program. Read from the IDL, never typed twice. */
export const DROPCHAD_PROGRAM_ID: Pubkey = pubkeyFromBase58(dropchadIdl.address);

export const SYSTEM_PROGRAM_ID: Pubkey = pubkeyFromBase58("11111111111111111111111111111111");
export const COMPUTE_BUDGET_PROGRAM_ID: Pubkey = pubkeyFromBase58(
  "ComputeBudget111111111111111111111111111111",
);
/** The native Ed25519 signature check. Read from `packages/shared`, never typed twice. */
export const ED25519_PROGRAM_ID: Pubkey = pubkeyFromBase58(ED25519_PROGRAM_ID_BASE58);
/** The instructions sysvar `claim_handle` reads the Ed25519 instruction from. */
export const INSTRUCTIONS_SYSVAR_ID: Pubkey = pubkeyFromBase58(
  "Sysvar1nstructions1111111111111111111111111",
);
/**
 * The Clock sysvar and the owner of every sysvar account. Read from `solana-sdk-ids` 3.1.0,
 * `sysvar::clock::ID` and `sysvar::ID`. the design reads the chain's own time.
 */
export const CLOCK_SYSVAR_ID: Pubkey = pubkeyFromBase58(
  "SysvarC1ock11111111111111111111111111111111",
);
export const SYSVAR_OWNER_ID: Pubkey = pubkeyFromBase58(
  "Sysvar1111111111111111111111111111111111111",
);
/** The upgradeable loader. `ProgramData` accounts live under it. */
export const BPF_UPGRADEABLE_LOADER_ID: Pubkey = pubkeyFromBase58(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

/**
 * The one address lookup table for a token `claim_handle`.
 *
 * The table is made once, frozen, and holds exactly six read-only addresses in a fixed order.
 * The relayer reads it at start and uses it only when every check here passes; anything else
 * means a legacy transaction.
 *
 * The account layout of the address lookup table program, checked against a mainnet-beta table
 * read with `jsonParsed` and `solana address-lookup-table get`:
 *
 *   0   u32  type, 1 for a lookup table
 *   4   u64  deactivation slot, `u64::MAX` while active
 *   12  u64  last extended slot
 *   20  u8   start index of the last extension
 *   21  u8   authority option tag, then 32 bytes of key when it is 1
 *   56       the addresses, 32 bytes each
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  configPda,
} from "./pda.js";
import {
  INSTRUCTIONS_SYSVAR_ID,
  SYSTEM_PROGRAM_ID,
  pubkeyEquals,
  pubkeyFromBase58,
  type Pubkey,
} from "./pubkey.js";
import type { AccountInfo } from "./rpc.js";

export const ADDRESS_LOOKUP_TABLE_PROGRAM_ID: Pubkey = pubkeyFromBase58(
  "AddressLookupTab1e1111111111111111111111111",
);

/** In this order. */
export const TOKEN_CLAIM_TABLE_ADDRESSES: readonly Pubkey[] = [
  configPda().address,
  SYSTEM_PROGRAM_ID,
  INSTRUCTIONS_SYSVAR_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
];

/** A table that is off is read again after this long. */
export const LOOKUP_TABLE_RECHECK_MS = 600_000;

const META_BYTES = 56;
const ACTIVE = 0xffff_ffff_ffff_ffffn;

export interface ParsedLookupTable {
  readonly deactivationSlot: bigint;
  readonly lastExtendedSlot: bigint;
  readonly authority: Pubkey | null;
  readonly addresses: readonly Pubkey[];
}

export function parseLookupTable(data: Uint8Array): ParsedLookupTable {
  if (data.length < META_BYTES || (data.length - META_BYTES) % 32 !== 0) {
    throw new Error(`lookup table data has ${String(data.length)} bytes`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 1) throw new Error("not a lookup table");
  const tag = data[21];
  if (tag !== 0 && tag !== 1) throw new Error("bad authority option");
  return {
    deactivationSlot: view.getBigUint64(4, true),
    lastExtendedSlot: view.getBigUint64(12, true),
    authority: tag === 1 ? data.slice(22, 54) : null,
    addresses: Array.from({ length: (data.length - META_BYTES) / 32 }, (_, i) =>
      data.slice(META_BYTES + 32 * i, META_BYTES + 32 * (i + 1)),
    ),
  };
}

export type LookupTableCheck =
  | { readonly ok: true; readonly addresses: readonly Pubkey[] }
  | {
      readonly ok: false;
      readonly reason:
        "missing" | "owner" | "data" | "authority" | "deactivated" | "not active yet" | "addresses";
    };

/** `currentSlot` is the cluster's slot at the time of the read. */
export function checkLookupTable(
  account: AccountInfo | null,
  currentSlot: bigint,
): LookupTableCheck {
  if (account === null) return { ok: false, reason: "missing" };
  if (!pubkeyEquals(account.owner, ADDRESS_LOOKUP_TABLE_PROGRAM_ID)) {
    return { ok: false, reason: "owner" };
  }
  let table: ParsedLookupTable;
  try {
    table = parseLookupTable(account.data);
  } catch {
    return { ok: false, reason: "data" };
  }
  if (table.authority !== null) return { ok: false, reason: "authority" };
  if (table.deactivationSlot !== ACTIVE) return { ok: false, reason: "deactivated" };
  if (table.lastExtendedSlot >= currentSlot) return { ok: false, reason: "not active yet" };
  const same =
    table.addresses.length === TOKEN_CLAIM_TABLE_ADDRESSES.length &&
    table.addresses.every((a, i) => pubkeyEquals(a, TOKEN_CLAIM_TABLE_ADDRESSES[i] as Pubkey));
  if (!same) return { ok: false, reason: "addresses" };
  return { ok: true, addresses: TOKEN_CLAIM_TABLE_ADDRESSES };
}

/**
 * The copy of the live devnet `Config` for the proof. Read from the
 * Rust suite's `fee_model.rs`, where it was read only from devnet (slot 508327461,
 * checked unchanged at slot 508580299), so the Rust and the api proof use one copy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Pubkey } from "../src/chain/svm/pubkey.js";

const FEE_MODEL_RS = resolve(
  import.meta.dirname,
  "../../../contracts/solana/programs/dropchad/tests/fee_model.rs",
);

/** Admin, relayer and fee wallet: bytes 8 to 104 of the 253 byte `Config`. */
const KEYS_START = 8;
const KEYS_END = 104;

function constant(source: string, name: string): string {
  const match = new RegExp(`const ${name}: [^=]+= "?([^";]+)"?;`).exec(source);
  if (match?.[1] === undefined) throw new Error(`${name} not found in ${FEE_MODEL_RS}`);
  return match[1];
}

export function liveDevnetConfig(): {
  readonly bytes: Uint8Array;
  readonly address: string;
  readonly lamports: bigint;
} {
  const source = readFileSync(FEE_MODEL_RS, "utf8");
  return {
    bytes: new Uint8Array(Buffer.from(constant(source, "LIVE_CONFIG"), "base64")),
    address: constant(source, "LIVE_CONFIG_ADDRESS"),
    lamports: BigInt(constant(source, "LIVE_LAMPORTS").replaceAll("_", "")),
  };
}

/**
 * The live bytes with our key as admin, relayer and fee wallet, since the live keys are not in
 * the test. Every other byte stays live. The same swap as `load_live_config(.., true)` in Rust.
 */
export function withOurKeys(bytes: Uint8Array, key: Pubkey): Uint8Array {
  const out = Uint8Array.from(bytes);
  for (let at = KEYS_START; at < KEYS_END; at += 32) out.set(key, at);
  return out;
}

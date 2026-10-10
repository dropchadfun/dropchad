/**
 * The address a receiver pastes to be paid at.
 *
 * No wallet connect and no wallet signature: the X login is the only proof,
 * so the format check is the only thing between a typo and a lost payout, next to the confirm
 * screen. It is strict on purpose:
 *
 * - EVM: `0x` and 40 hex digits; mixed case must be the right EIP 55 checksum, so a mistyped
 *   letter in a checksummed paste is caught; never the zero address, which would burn the payout.
 * - Solana: base58 of exactly 32 bytes, **on the ed25519 curve**. A wallet key always is; a
 *   program derived address never is, and SOL sent to one can be stuck. Never the default key.
 */
import { base58Decode, base58Encode } from "@dropchad/shared";
import { getAddress, isAddress, zeroAddress } from "viem";

import type { ChainFamily } from "../chain/adapter.js";
import { isOnCurve } from "../chain/svm/pda.js";

export class BadRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRecipientError";
  }
}

/** The display form of a valid address for this family, or `BadRecipientError`. */
export function parseRecipient(family: ChainFamily, text: string): string {
  const trimmed = text.trim();
  return family === "evm" ? parseEvm(trimmed) : parseSvm(trimmed);
}

function parseEvm(text: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new BadRecipientError("not an EVM address: 0x and 40 hex characters");
  }
  if (!isAddress(text, { strict: true })) {
    throw new BadRecipientError("the address checksum is wrong, check every letter");
  }
  const address = getAddress(text);
  if (address === zeroAddress)
    throw new BadRecipientError("the zero address would burn the payout");
  return address;
}

function parseSvm(text: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) {
    throw new BadRecipientError("not a Solana address: base58, 32 to 44 characters");
  }
  let bytes: Uint8Array;
  try {
    bytes = base58Decode(text);
  } catch {
    throw new BadRecipientError("not a Solana address: base58 did not decode");
  }
  if (bytes.length !== 32) throw new BadRecipientError("not a Solana address: not 32 bytes");
  if (bytes.every((byte) => byte === 0)) {
    throw new BadRecipientError("the default key is not a wallet");
  }
  if (!isOnCurve(bytes)) {
    throw new BadRecipientError(
      "this address is off the ed25519 curve, a program address, not a wallet.",
    );
  }
  return base58Encode(bytes);
}

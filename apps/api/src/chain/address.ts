/**
 * How an address is stored and matched, for both families.
 *
 * An EVM address is case insensitive and is stored **lowercase**, as it always was. A Solana
 * public key is base58, which is case **sensitive**, so it is stored exactly as written. One
 * rule tells them apart: it starts with `0x` or it does not. Every place that used to call
 * `toLowerCase()` on a drop address goes through here instead, so a base58 key is never
 * mangled on its way into a query.
 */
import { isPubkey } from "@dropchad/shared";

export function canonicalAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Shape only, no checksum: the route guard that stops junk before it reaches a query. */
export function looksLikeDropAddress(text: string): boolean {
  return EVM_ADDRESS.test(text) || isPubkey(text);
}

export function isEvmAddressText(text: string): boolean {
  return EVM_ADDRESS.test(text);
}

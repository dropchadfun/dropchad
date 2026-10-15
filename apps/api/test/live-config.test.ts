/**
 * the copy of the live devnet `Config` that the LiteSVM proof runs on. It is read from
 * `contracts/solana/programs/dropchad/tests/fee_model.rs`, the one place the bytes live, so the
 * Rust proof and the api proof use the same copy. Runs everywhere, Windows too; the LiteSVM case
 * that uses it runs in WSL only, `litesvm.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { decodeConfig } from "../src/chain/svm/accounts.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { configPda } from "../src/chain/svm/pda.js";
import { DEFAULT_PUBKEY, DROPCHAD_PROGRAM_ID, pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { liveDevnetConfig, withOurKeys } from "./live-config.js";

const decode = (data: Uint8Array) =>
  decodeConfig({ lamports: 0n, owner: DROPCHAD_PROGRAM_ID, data, executable: false });

describe("the live devnet Config copy, from fee_model.rs", () => {
  it("is the Config PDA of this program, with the live lamports", () => {
    const live = liveDevnetConfig();
    expect(live.address).toBe(pubkeyToBase58(configPda().address));
    expect(live.lamports).toBe(1_935_480n);
    expect(live.bytes.length).toBe(253);
  });

  it("decodes to the live values: 1%, flat minimum 300000, the two new fields zero", () => {
    const c = decode(liveDevnetConfig().bytes);
    expect(c.defaultFeeBps).toBe(100);
    expect(c.paused).toBe(false);
    expect(c.chainId).toBe(103n);
    expect(pubkeyToBase58(c.relayer)).toBe("GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP");
    expect(c.handle).not.toBeNull();
    const h = c.handle!;
    expect(pubkeyToBase58(h.binder)).toBe("DhiQHDcochXLnLXhwMT3JVDcDe1pVfXjMG7pkPboowGq");
    expect(h.binderRevoked).toBe(false);
    expect(pubkeyToBase58(h.guardian)).toBe(pubkeyToBase58(DEFAULT_PUBKEY));
    expect(h.minFeeLamports).toBe(300_000n);
    expect(h.minFeePerReceiverLamports).toBe(0n);
    expect(h.maxFeeLamports).toBe(0n);
  });

  it("withOurKeys swaps admin, relayer and fee wallet, every other byte stays live", () => {
    const live = liveDevnetConfig().bytes;
    const before = Uint8Array.from(live);
    const key = randomSigner().publicKey;
    const ours = withOurKeys(live, key);

    const c = decode(ours);
    expect(pubkeyToBase58(c.admin)).toBe(pubkeyToBase58(key));
    expect(pubkeyToBase58(c.relayer)).toBe(pubkeyToBase58(key));
    expect(pubkeyToBase58(c.feeWallet)).toBe(pubkeyToBase58(key));
    expect(ours.slice(0, 8)).toEqual(live.slice(0, 8));
    expect(ours.slice(104)).toEqual(live.slice(104));
    // The copy is not changed in place.
    expect(live).toEqual(before);
  });
});

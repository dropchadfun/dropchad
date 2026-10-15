/**
 * the launchpad kept at create (migration `0019`) is on every token
 * object, `pump.fun` or `null`; a token drop made before `0019` has `null`. The create path and
 * the row are checked in `token-create.test.ts` and `db.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tokenInfoOf } from "../src/drops/token-info.js";

const MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const row = (tokenLaunchpad: string | null) => ({
  asset: MINT,
  tokenProgram: TOKEN_2022,
  tokenDecimals: 6,
  tokenName: "Doomed Rocket",
  tokenSymbol: "DOOROC",
  tokenLaunchpad,
});

describe("the token object carries the launchpad", () => {
  it("pump.fun when the check saw it at create", () => {
    expect(tokenInfoOf(row("pump.fun"))).toEqual({
      mint: MINT,
      symbol: "DOOROC",
      name: "Doomed Rocket",
      decimals: 6,
      tokenProgram: TOKEN_2022,
      logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
      launchpad: "pump.fun",
    });
  });

  it("null when there was no sign, or the drop is older than 0019", () => {
    expect(tokenInfoOf(row(null))?.launchpad).toBeNull();
  });

  it("anything else on the row is never passed on, only the on chain sign", () => {
    expect(tokenInfoOf(row("raydium"))?.launchpad).toBeNull();
  });

  it("a SOL drop still has no token object", () => {
    expect(
      tokenInfoOf({
        asset: "11111111111111111111111111111111",
        tokenProgram: null,
        tokenDecimals: null,
        tokenName: null,
        tokenSymbol: null,
        tokenLaunchpad: null,
      }),
    ).toBeNull();
  });
});

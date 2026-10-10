/**
 * for a quick token, by its chain and exact
 * address, the ticker, the name and the logo are ours, never the chain's and never `tokens`. The
 * token check, every drop and claim answer and the funding answer carry them. Any other address
 * keeps what its chain says. The create path is in `token-create.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { TokenCheck, TokenChecker } from "../src/chain/svm/token-check.js";
import { tokenInfoOf, unitOfDrop } from "../src/drops/token-info.js";
import { createHarness } from "./harness.js";

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const TUSDC = "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C";
const FAKE = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOL = { symbol: "SOL", decimals: 9 };

const row = (chainKey: string, asset: string, name: string | null, symbol: string | null) => ({
  chainKey,
  asset,
  tokenProgram: TOKEN_PROGRAM,
  tokenDecimals: 6,
  tokenName: name,
  tokenSymbol: symbol,
  tokenLaunchpad: null,
});

describe("every drop and claim answer, tokenInfoOf", () => {
  it("devnet USDC with no name or ticker on chain: ours, and our logo", () => {
    expect(tokenInfoOf(row("solana-devnet", DEVNET_USDC, null, null))).toMatchObject({
      mint: DEVNET_USDC,
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: "/tokens/usdc.png",
    });
    expect(unitOfDrop(row("solana-devnet", DEVNET_USDC, null, null), SOL)).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("mainnet USDT whose chain says USDT, USDT: our name wins", () => {
    expect(tokenInfoOf(row("solana", MAINNET_USDT, "USDT", "USDT"))).toMatchObject({
      symbol: "USDT",
      name: "Tether USD",
      logoUrl: "/tokens/usdt.png",
    });
  });

  it("tUSDC on Robinhood testnet: the USDC logo, its own ticker", () => {
    expect(tokenInfoOf(row("robinhood-testnet", TUSDC, "Test USDC", "tUSDC"))).toMatchObject({
      symbol: "tUSDC",
      name: "Test USDC",
      logoUrl: "/tokens/usdc.png",
    });
  });

  it("a look alike called USDC keeps what its chain says, and the logo route", () => {
    expect(tokenInfoOf(row("solana-devnet", FAKE, "USD Coin", "USDC"))).toMatchObject({
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: `/api/tokens/${FAKE}/logo?chain=solana`,
    });
  });

  it("the right address on the wrong chain gets nothing of ours", () => {
    const info = tokenInfoOf(row("solana", DEVNET_USDC, null, null));
    expect(info?.symbol).toBeNull();
    expect(info?.logoUrl).toBe(`/api/tokens/${DEVNET_USDC}/logo?chain=solana`);
  });
});

describe("GET /api/tokens/:mint, the token check", () => {
  const plain = (mint: string): TokenCheck => ({
    mint,
    tokenProgram: TOKEN_PROGRAM,
    name: null,
    symbol: null,
    decimals: 6,
    logoUrl: null,
    launchpad: null,
    ok: true,
    reason: null,
  });
  const checker: TokenChecker = {
    check: (mint: string) => Promise.resolve(plain(mint)),
    logo: () => Promise.resolve(null),
  };

  it("devnet USDC on this api's Solana chain: our ticker, name and logo", async () => {
    const harness = await createHarness({ tokenChecker: checker });
    const response = await harness.app.request(`/api/tokens/${DEVNET_USDC}?chain=solana`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mint: DEVNET_USDC,
      ok: true,
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: "/tokens/usdc.png",
    });
    await harness.close();
  });

  it("any other mint: exactly what the chain said", async () => {
    const harness = await createHarness({ tokenChecker: checker });
    const response = await harness.app.request(`/api/tokens/${FAKE}?chain=solana`);
    expect(await response.json()).toMatchObject({ symbol: null, name: null, logoUrl: null });
    await harness.close();
  });

  it("tUSDC on this api's Robinhood chain: the USDC logo", async () => {
    const harness = await createHarness({ evmTokenChecker: checker });
    const response = await harness.app.request(`/api/tokens/${TUSDC}?chain=robinhood`);
    expect(await response.json()).toMatchObject({
      symbol: "tUSDC",
      name: "Test USDC",
      logoUrl: "/tokens/usdc.png",
    });
    await harness.close();
  });
});

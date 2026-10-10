/**
 * fixtures. Real chain bytes and addresses where they exist, and one small builder
 * for a classic mint.
 *
 * - The pump.fun coin is the one of `test/token-check.test.ts`, read on mainnet.
 * - The two associated token accounts were read on chain, read only:
 *   - Token-2022, mainnet: the pump coin's bonding curve account
 *     `A8XWoUnK974nW8joknyPTfTmZ31GtexRRa6CWaQRvjGM`, 170 bytes, owned by Token-2022, mint the
 *     coin, owner the curve `8tAEFnTSzwWT8Zsn9NcHaxRdKCxNSZ6iw6wZGRNZFTbT`.
 *   - classic, devnet: `22iEVYcbMHr3hbEBeg9nZK2dRCcUDTSMWLxdW2tVyPCY`, devnet USDC
 *     `6BqoYPbqeNFaDDLBGMRV1564T4S6wKPfWEdTinV3mpi3`, seen in devnet tx `2JF4kVbw…R3ZZq`.
 */
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export const PUMP_MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";
export const PUMP_MINT_DATA =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACNSf0aBwAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFrScUnTqKp5hE9Fw/Tp7zpBV+hbmXI7gYkQb827l12vEwCmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWtJxSdOoqnmET0XD9OnvOkFX6FuZcjuBiRBvzbuXXa8NAAAARG9vbWVkIFJvY2tldAYAAABET09ST0NDAAAAaHR0cHM6Ly9pcGZzLmlvL2lwZnMvUW1ObnN3RTNtczdyTG1VeWcya25NWmNvd2tWdnhlTG5hUEU3TTdjR1JZUkJ0NQAAAAA=";
export const PUMP_CURVE = "8tAEFnTSzwWT8Zsn9NcHaxRdKCxNSZ6iw6wZGRNZFTbT";
export const PUMP_CURVE_ATA = "A8XWoUnK974nW8joknyPTfTmZ31GtexRRa6CWaQRvjGM";

/** Circle's devnet USDC, one of the allowlisted mints. No Metaplex account. */
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const DEVNET_USDC_HOLDER = "6BqoYPbqeNFaDDLBGMRV1564T4S6wKPfWEdTinV3mpi3";
export const DEVNET_USDC_HOLDER_ATA = "22iEVYcbMHr3hbEBeg9nZK2dRCcUDTSMWLxdW2tVyPCY";

export const fromB64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

/** The 82 byte classic mint: mint authority none, supply, decimals, initialised, freeze option. */
export function classicMintData(options: { decimals?: number; freeze?: boolean } = {}) {
  const data = new Uint8Array(82);
  data.fill(1, 36, 44); // supply, any non zero
  data[44] = options.decimals ?? 6;
  data[45] = 1; // initialised
  if (options.freeze === true) {
    data[46] = 1; // the option tag, then any key
    data.fill(7, 50, 82);
  }
  return data;
}

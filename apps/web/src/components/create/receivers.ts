/**
 * The pasted receiver list. One receiver per line: an address, then an amount in whole coins.
 * Separators are whitespace, a comma, a semicolon or an equals sign, so a paste from a sheet
 * or a chat both work. Duplicates are merged by the api, so they only get a note here.
 *
 * The address shape and the decimals follow the chain family: `0x` and 18 on an EVM chain,
 * base58 and 9 on Solana. `amountWei` is base units of that chain, the name is historical.
 */
import { isAddressFor, type ChainFamily } from "@/lib/chains";
import { parseAmount } from "@/lib/format";

export interface ParsedReceiver {
  readonly address: string;
  readonly amountWei: bigint;
}

export interface ParsedList {
  readonly receivers: ParsedReceiver[];
  /** Line number and what was wrong, for the lines that did not parse. */
  readonly errors: { line: number; message: string }[];
  readonly totalWei: bigint;
  readonly duplicates: number;
}

export interface ParseOptions {
  readonly family: ChainFamily;
  readonly decimals: number;
  readonly symbol: string;
}

const EVM: ParseOptions = { family: "evm", decimals: 18, symbol: "ETH" };

export function parseReceivers(text: string, options: ParseOptions = EVM): ParsedList {
  const receivers: ParsedReceiver[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let totalWei = 0n;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.length === 0) return;
    const parts = line.split(/[\s,;=]+/).filter((part) => part.length > 0);
    const [address, amount, ...rest] = parts;
    if (address === undefined || !isAddressFor(address, options.family)) {
      errors.push({ line: i + 1, message: "not an address" });
      return;
    }
    if (amount === undefined) {
      errors.push({ line: i + 1, message: "missing amount" });
      return;
    }
    if (rest.length > 0) {
      errors.push({ line: i + 1, message: "too many values on the line" });
      return;
    }
    const wei = parseAmount(amount, options.decimals);
    if (wei === null || wei <= 0n) {
      errors.push({
        line: i + 1,
        message: `amount must be a number above zero, in ${options.symbol}`,
      });
      return;
    }
    // A `0x` address is case insensitive, a base58 key is not.
    const key = options.family === "evm" ? address.toLowerCase() : address;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    receivers.push({ address, amountWei: wei });
    totalWei += wei;
  });

  return { receivers, errors, totalWei, duplicates };
}

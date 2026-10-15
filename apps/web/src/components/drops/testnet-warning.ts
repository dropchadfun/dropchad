import { familyOf } from "@/lib/chains";

/**
 * The funding card warning: the
 * text exactly, naming only the drop's own test network. A multisend is never called a drop.
 * While the site is testnet only, the only time the box shows, Solana is devnet and the one EVM
 * chain is Robinhood Chain testnet.
 */
export function testnetWarningLines(
  chainId: number,
  kind: "drop" | "multisend",
): readonly [string, string, string, string] {
  const network = familyOf(chainId) === "svm" ? "solana devnet" : "robinhood chain testnet";
  return [
    "almost there 🤌",
    `this is a testnet ${kind}, so fund it with test coins.`,
    `quick check: set your wallet to ${network} before you send.`,
    "real coins sent here can not come back, so keep those for mainnet.",
  ];
}

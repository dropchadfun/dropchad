/**
 * The warnings that go out with every created drop, for either chain.
 *
 * The funding instructions themselves — address, amount, EIP 681 or Solana Pay uri — come from
 * the chain adapter, `src/chain/adapter.ts` `FundingInstructions`. A drop is funded by a **plain
 * transfer** from any wallet. There is nothing to sign, no approval and no connect step. That is
 * the whole point of the design — the sender never connects a wallet to dropchad.
 *
 * The warnings are part of the response, not the frontend's job to remember.
 * the two ways a sender loses money here are sending to the wrong address and giving a refund
 * address that cannot receive a contract transfer.
 */
export function fundingWarnings(args: {
  readonly refundRecipient: string;
  /** Whole coins, for a human. `amountDisplay` from the funding instructions. */
  readonly amountDisplay: string;
  readonly symbol: string;
  readonly chainName: string;
  /** `address` is a multisend, never called a drop. */
  readonly mode: "address" | "handle";
}): string[] {
  const what = args.mode === "address" ? "multisend" : "drop";
  return [
    `Send ${args.amountDisplay} ${args.symbol} on ${args.chainName} to the address above. Less ` +
      `than this and the ${what} does not start. A plain transfer is enough. There is nothing to ` +
      `sign and no wallet to connect.`,
    `Check the address character by character before you send. If you send more, the extra ` +
      `goes back to your refund address at the end.`,
    `Your refund address is ${args.refundRecipient}. Unclaimed funds are sent there after the ` +
      `claim deadline. **Never use an exchange deposit address or any address you withdraw to ` +
      `from an exchange.** That refund arrives as a contract transfer and an exchange can lose ` +
      `it forever. Use a wallet whose keys you hold.`,
  ];
}

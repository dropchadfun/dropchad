import { quickTokenAt } from "@/lib/chains";

/**
 * A quick token's logo : only for the exact address
 * on its own chain in the quick token list, our own file under `/tokens/`. Anything else, a
 * pasted look alike called USDC included, gets nothing here.
 */
export function QuickTokenLogo({
  chainId,
  mint,
  size,
  className = "",
}: {
  chainId: number;
  mint: string;
  size: number;
  className?: string;
}) {
  const logo = quickTokenAt(chainId, mint)?.logo ?? null;
  if (logo === null) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- our own small file, a fixed size
    <img
      src={logo}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-full align-middle ${className}`}
    />
  );
}

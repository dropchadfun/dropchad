import { assetHalves } from "@/components/create/token";
import { LaunchpadBadge } from "@/components/drops/LaunchpadBadge";
import { CopyButton } from "@/components/site/CopyButton";
import { TokenLogo } from "@/components/site/TokenLogo";
import type { TokenInfo } from "@/lib/api";
import { TESTNET_ONLY } from "@/lib/chains";
import { DEXSCREENER_LOGO, dexscreenerUrl } from "@/lib/dexscreener";
import { tokenPageLink } from "@/lib/token";

/**
 * A token drop's small token row under `who got fed`
 * the logo (its letter when none), the name and the ticker, `CA` with the full mint in two even
 * halves and copy, the `launched on` badge when the api kept a launchpad we list, one
 * small text link to the explorer, and on mainnet the quiet `chart on dexscreener` button.
 * Never a price or a market cap.
 */
export function TokenRow({ token, chainId }: { token: TokenInfo; chainId: number }) {
  const link = tokenPageLink(token.mint, chainId, TESTNET_ONLY);
  const chart = dexscreenerUrl(chainId, token.mint);
  return (
    <section className="card mt-6 rounded-xl p-3">
      <div className="flex items-center gap-3">
        <TokenLogo token={token} size={24} />
        <p className="type-body flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="truncate font-medium text-chad-text">{token.name ?? "token"}</span>
          {token.symbol ? <span className="text-chad-text-dim">{token.symbol}</span> : null}
          <LaunchpadBadge token={token} chainId={chainId} className="self-center" />
        </p>
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="type-small shrink-0 text-chad-text-dim hover:text-chad-text"
        >
          {link.label}
        </a>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="type-label shrink-0">CA</span>
        <p className="type-small min-w-0 flex-1 font-mono text-chad-text-dim">
          {assetHalves(token.mint).map((half) => (
            <span key={half} className="inline-block whitespace-nowrap">
              {half}
            </span>
          ))}
        </p>
        <CopyButton value={token.mint} label="copy" compact />
      </div>
      {chart === null ? null : (
        <a
          href={chart}
          target="_blank"
          rel="noopener noreferrer"
          className="interactive type-small mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-chad-border px-3 text-chad-text-dim hover:text-chad-text md:min-h-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the file, used as it is */}
          <img src={DEXSCREENER_LOGO} width={14} height={14} alt="" className="size-3.5 shrink-0" />
          chart on dexscreener
        </a>
      )}
    </section>
  );
}

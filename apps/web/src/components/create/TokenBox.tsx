"use client";

import { useState } from "react";

import { Tabs } from "@/components/boards/BoardTabs";
import { tokenLine } from "@/components/create/token";
import { CopyButton } from "@/components/site/CopyButton";
import { Input } from "@/components/ui/input";
import type { TokenCheck } from "@/lib/api";
import type { ChainPill } from "@/lib/chains";
import { shortMint } from "@/lib/token";
import { cn } from "@/lib/utils";

import type { AssetChoice } from "@/components/create/form";

/**
 * The token box: drop mode on Solana, and on
 * Robinhood once V3 is deployed, at the top of step 1, right under the chain.
 * Three choices, the board tabs look: the chain's coin (`SOL` or `ETH`) first and the default,
 * then `stable` when the chain has quick tokens, then `token`. `stable` shows the quick
 * tokens as big buttons; `token` opens one box, `paste a token address`. Either way the page
 * checks the address with `GET /api/tokens/:mint` and shows the card below.
 */
export function TokenBox({
  coin,
  asset,
  mintText,
  check,
  error,
  quickTokens,
  onAsset,
  onMintText,
}: {
  /** The chain's coin, `SOL` or `ETH`: the first choice. */
  coin: string;
  asset: AssetChoice;
  mintText: string;
  check: TokenCheck | null;
  error: string | null;
  /** The chain's quick tokens. Empty: no `stable` tab. */
  quickTokens: ChainPill["quickTokens"];
  onAsset: (asset: AssetChoice) => void;
  onMintText: (text: string) => void;
}) {
  const stable = quickTokens.length > 0;
  return (
    <div className="mt-6">
      <p className="type-label mb-2">what you drop</p>
      <div className="md:inline-block">
        <Tabs label={stable ? `${coin}, stable or a token` : `${coin} or a token`}>
          <button
            type="button"
            aria-pressed={asset === "native"}
            onClick={() => onAsset("native")}
            className={segment(asset === "native")}
          >
            {coin}
          </button>
          {stable ? (
            <button
              type="button"
              aria-pressed={asset === "stable"}
              onClick={() => onAsset("stable")}
              className={segment(asset === "stable")}
            >
              stable
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={asset === "token"}
            onClick={() => onAsset("token")}
            className={segment(asset === "token")}
          >
            token
          </button>
        </Tabs>
      </div>
      {asset === "native" ? null : (
        <div className="mt-3">
          {asset === "stable" ? (
            <StableButtons tokens={quickTokens} mintText={mintText} onPick={onMintText} />
          ) : (
            <>
              <label htmlFor="mint" className="sr-only">
                paste a token address
              </label>
              <Input
                id="mint"
                value={mintText}
                onChange={(event) => onMintText(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="paste a token address"
                className="type-body h-10 rounded-lg border-chad-border bg-chad-surface font-mono"
              />
            </>
          )}
          {check ? <TokenCard check={check} fullAddress={asset === "stable"} /> : null}
          {error ? <p className="type-table mt-2 text-chad-error">{error}</p> : null}
        </div>
      )}
    </div>
  );
}

/**
 * The `stable` tab's buttons : one big button per quick
 * token, the ticker only, no address. A tap puts the exact address in the box, the same as a
 * paste, so the page runs the same check. The picked one is mint. Never a price.
 */
export function StableButtons({
  tokens,
  mintText,
  onPick,
}: {
  tokens: ChainPill["quickTokens"];
  mintText: string;
  onPick: (address: string) => void;
}) {
  const inBox = mintText.trim();
  return (
    <div className="flex gap-2" role="group" aria-label="stable">
      {tokens.map((token) => (
        <button
          key={token.address}
          type="button"
          aria-pressed={token.address === inBox}
          onClick={() => onPick(token.address)}
          className={stableButton(token.address === inBox)}
        >
          {token.logo !== null ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own small file
            <img
              src={token.logo}
              alt=""
              width={20}
              height={20}
              className="size-5 shrink-0 rounded-full"
            />
          ) : null}
          {token.symbol}
        </button>
      ))}
    </div>
  );
}

/**
 * What the check found: the logo (its first letter when there is none), the name, the ticker,
 * the launchpad when known, the short address with copy, then `ok to drop` in mint or the
 * reason in red. Never a price. Under `stable` the full address, which may wrap on a
 * phone.
 */
export function TokenCard({
  check,
  fullAddress = false,
}: {
  check: TokenCheck;
  fullAddress?: boolean;
}) {
  const line = tokenLine(check);
  const letter = (check.symbol ?? check.name ?? check.mint).slice(0, 1).toUpperCase();
  return (
    <div className="card mt-3 flex items-start gap-3 rounded-xl p-3">
      <TokenFace logoUrl={check.logoUrl} letter={letter} />
      <div className="min-w-0 flex-1">
        <p className="type-body flex flex-wrap items-baseline gap-x-2">
          {check.name ? (
            <span className="truncate font-medium text-chad-text">{check.name}</span>
          ) : null}
          {check.symbol ? <span className="text-chad-text-dim">{check.symbol}</span> : null}
          {check.launchpad ? (
            <span className="type-small text-chad-text-dim">{check.launchpad}</span>
          ) : null}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              "type-small font-mono text-chad-text-dim",
              fullAddress && "min-w-0 break-all",
            )}
          >
            {fullAddress ? check.mint : shortMint(check.mint)}
          </span>
          <CopyButton value={check.mint} label="copy" compact />
        </div>
        <p className={cn("type-table mt-2", line.ok ? "text-chad-accent" : "text-chad-error")}>
          {line.text}
        </p>
      </div>
    </div>
  );
}

/** The logo from our own route, or the letter on a grey disc when it has none or fails. */
function TokenFace({ logoUrl, letter }: { logoUrl: string | null; letter: string }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl !== null && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- our own route, bytes vary per mint
      <img
        src={logoUrl}
        alt=""
        width={40}
        height={40}
        onError={() => setFailed(true)}
        className="size-10 shrink-0 rounded-full bg-chad-surface-2 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="type-body inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-chad-surface-2 font-medium text-chad-text-dim"
    >
      {letter}
    </span>
  );
}

/** A `stable` button: a card, 48px tall, sharing the width; mint when picked. */
const stableButton = (picked: boolean) =>
  cn(
    "interactive type-body flex h-12 flex-1 items-center justify-center gap-2 rounded-lg border font-mono font-medium",
    picked
      ? "border-chad-accent bg-chad-accent text-chad-accent-ink hover:bg-chad-accent-hover"
      : "border-chad-border bg-chad-surface text-chad-text hover:bg-chad-surface-2",
  );

/** The board tab look, like the drop or multisend switch, a 44px target on the phone. */
const segment = (active: boolean) =>
  cn(
    "type-body flex h-11 flex-1 items-center justify-center rounded-md px-2.5 font-medium whitespace-nowrap md:h-8 md:flex-none",
    active
      ? "interactive bg-chad-surface-2 text-chad-text hover:bg-chad-surface-2"
      : "interactive text-chad-text-dim hover:text-chad-text",
  );

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ChainBadge } from "@/components/chains/ChainBadge";
import {
  CLAIM_RISK_LINE,
  claimAgainRecipient,
  claimLoginHref,
  confirmTitle,
  detailScreen,
  endedLine,
  freshLoginLeft,
  NO_SEED_LINE,
  pasteError,
  pasteHint,
  pausedLine,
  rowAction,
  SENDING_PREFIX,
  type ClaimItem,
  type ClaimStep,
} from "@/components/drops/claim";
import { ClaimAddress } from "@/components/drops/ClaimAddress";
import { readClaimWallet, saveClaimWallet } from "@/components/drops/kept-address";
import { DropGif } from "@/components/drops/DropGif";
import { Avatar } from "@/components/site/Avatar";
import { Empty } from "@/components/site/Empty";
import { DISPLAY_FIT_STEPS, FitNumber } from "@/components/site/FitNumber";
import { QuickTokenLogo } from "@/components/site/QuickTokenLogo";
import { Skeleton } from "@/components/site/Skeleton";
import { ROW_LOGO, RowAmount, Ticker } from "@/components/site/Ticker";
import { Input } from "@/components/ui/input";
import { openLive } from "@/lib/api";
import { familyOf, txUrl } from "@/lib/chains";
import { ExtraClaims } from "@/lib/extra-claims";
import { formatAmount, listAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What the confirm's `claim` hands back: done, or an api error code. */
export type BindResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * The claim page, `/claim`, screens A to K.
 * No wallet connect and no wallet library: sign in with X, paste an address, check it large,
 * claim. The api decides everything; this only shows it.
 */
export function ClaimView({
  session,
  claims,
  freshLoginSecondsLeft,
  selected,
  initialStep = "start",
  initialAddress = "",
  preview = false,
  partial = false,
  onBind,
  onRefresh,
}: {
  /** `null` signed out. */
  session: { readonly handle: string } | null;
  /** `null` while loading, or signed out. */
  claims: readonly ClaimItem[] | null;
  freshLoginSecondsLeft: number;
  /** The drop from `?drop=`. Not one of mine: the list. */
  selected: string | null;
  initialStep?: ClaimStep;
  initialAddress?: string;
  /** The dev only preview: sample data, and the confirm's `claim` calls nothing. */
  preview?: boolean;
  /** A chain could not be read: the drops it has, plus one grey note. */
  partial?: boolean;
  onBind?: (drop: string, recipient: string) => Promise<BindResult>;
  onRefresh?: () => void;
}) {
  const item =
    selected === null
      ? undefined
      : claims?.find((c) => c.drop.toLowerCase() === selected.toLowerCase());
  // Items from the extra lists around the drops: with any, "nothing to claim yet" is not true.
  const [extras, setExtras] = useState(0);
  // The extra lists wrap the drops list: some above it, some under it.
  const list =
    session === null || claims === null ? null : (
      <List claims={claims} handle={session.handle} partial={partial} extras={extras} />
    );

  return (
    <main className="mx-auto w-full max-w-(--container-content) px-4 py-4 md:py-8">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="type-h1">claim</h1>
        {preview ? <p className="type-small text-chad-text-dim">preview, sample data</p> : null}
      </div>
      <p className="type-small mt-1 text-chad-accent">{NO_SEED_LINE}</p>
      <p className="type-small mt-1 text-chad-accent">{CLAIM_RISK_LINE}</p>

      {session === null ? (
        <section className="mt-6 max-w-md">
          <p className="type-body text-chad-text-dim">
            sign in with X to see the drops made for you.
          </p>
          <a href={claimLoginHref(selected)} className="btn btn-x mt-4 h-11 px-5">
            sign in with X
          </a>
        </section>
      ) : claims === null ? (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : item !== undefined ? (
        <Detail
          key={item.drop}
          item={item}
          freshLoginSecondsLeft={freshLoginSecondsLeft}
          initialStep={initialStep}
          initialAddress={initialAddress}
          onBind={onBind}
          onRefresh={onRefresh}
        />
      ) : preview ? (
        list
      ) : (
        <ExtraClaims onCount={setExtras}>{list}</ExtraClaims>
      )}
    </main>
  );
}

function titleOf(item: ClaimItem): string {
  return item.title ?? `${item.symbol} drop`;
}

// --------------------------------------------------------------------------------------------
// B and C, the list
// --------------------------------------------------------------------------------------------

/** some drops could not load, never the full error. */
const PARTIAL_NOTE = "some drops could not load right now. try again in a minute.";

/** "nothing to claim yet" only with no drops, every drop loaded, and no extra items. */
export function nothingYetShown(input: {
  readonly drops: number;
  readonly extras: number;
  readonly partial: boolean;
}): boolean {
  return input.drops === 0 && input.extras === 0 && !input.partial;
}

function List({
  claims,
  handle,
  partial,
  extras,
}: {
  claims: readonly ClaimItem[];
  handle: string;
  partial: boolean;
  extras: number;
}) {
  // With none loaded, "nothing to claim yet" would not be true: only the note.
  if (claims.length === 0 && partial) {
    return <p className="type-small mt-6 text-chad-text-dim">{PARTIAL_NOTE}</p>;
  }
  if (claims.length === 0 && !nothingYetShown({ drops: 0, extras, partial })) return null;
  if (claims.length === 0) {
    return (
      <section className="mt-6 space-y-3">
        <Empty>{`nothing to claim yet. when someone drops on @${handle}, it shows up here.`}</Empty>
        <Link href="/#live" className="type-small text-chad-text-dim hover:text-chad-text">
          see what is live
        </Link>
      </section>
    );
  }
  return (
    <>
      <ul className="type-table mt-6">
        {claims.map((item) => {
          const action = rowAction(item);
          return (
            <li
              key={item.drop}
              data-state={item.state}
              className={cn(
                "row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 md:grid-cols-[minmax(0,1fr)_160px_120px]",
                action.kind === "word" && action.greyed === true && "text-chad-text-mute",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative shrink-0">
                  <Avatar
                    src={item.sender?.profileImageUrl ?? null}
                    name={item.sender?.handle ?? "?"}
                    size={32}
                    className="rounded-lg!"
                  />
                  <ChainBadge chainId={item.chainId} />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{titleOf(item)}</p>
                  <p className="type-small truncate text-chad-text-dim">
                    {item.sender ? `@${item.sender.handle}` : "unknown sender"}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 md:contents">
                <RowAmount
                  amount={listAmount(item.amount, item.decimals)}
                  symbol={item.symbol}
                  logo={
                    item.token ? (
                      <QuickTokenLogo
                        chainId={item.chainId}
                        mint={item.token.mint}
                        size={ROW_LOGO}
                      />
                    ) : null
                  }
                  className="num font-medium md:justify-end"
                  tickerClassName=""
                />
                <span className="md:text-right">
                  {action.kind === "button" ? (
                    <Link href={`/claim?drop=${item.drop}`} className="btn btn-primary h-9 px-4">
                      claim
                    </Link>
                  ) : (
                    <span className="type-small text-chad-text-dim">{action.label}</span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {partial ? <p className="type-small mt-3 text-chad-text-dim">{PARTIAL_NOTE}</p> : null}
    </>
  );
}

// --------------------------------------------------------------------------------------------
// D to K, one drop
// --------------------------------------------------------------------------------------------

function Detail({
  item,
  freshLoginSecondsLeft,
  initialStep,
  initialAddress,
  onBind,
  onRefresh,
}: {
  item: ClaimItem;
  freshLoginSecondsLeft: number;
  initialStep: ClaimStep;
  initialAddress: string;
  onBind: ((drop: string, recipient: string) => Promise<BindResult>) | undefined;
  onRefresh: (() => void) | undefined;
}) {
  const family = familyOf(item.chainId);
  const [step, setStep] = useState<ClaimStep>(initialStep);
  // The wallet kept in this browser for this chain family, free to change. One drop is
  // only ever drawn after the browser read the list, never in the server HTML.
  const [address, setAddress] = useState(() => initialAddress || readClaimWallet(family));
  const [freshLeft, setFreshLeft] = useState(freshLoginSecondsLeft);
  const [loadedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const screen = detailScreen(item, freshLeft, step);

  // The login time runs out while the page is open: count it down, so the page asks for a new
  // login before the paste or the confirm, never after `claim`. Never up again: a 401 set it to 0.
  const counting = screen === "paste" || screen === "confirm";
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => {
      const left = freshLoginLeft(freshLoginSecondsLeft, loadedAt, Date.now());
      setFreshLeft((current) => Math.min(current, left));
    }, 1000);
    return () => clearInterval(timer);
  }, [counting, freshLoginSecondsLeft, loadedAt]);

  // While it is on its way, the drop's own stream says when it landed; then the list is read again.
  useEffect(() => {
    if (screen !== "sending" || onRefresh === undefined) return;
    return openLive(item.drop, (event) => {
      if ((event.type === "claim_paid" && event.index === item.index) || event.type === "finished")
        onRefresh();
    });
  }, [screen, item.drop, item.index, onRefresh]);

  const shapeError = pasteError(family, address);

  const claim = async (recipient: string) => {
    if (onBind === undefined || busy) return;
    setBusy(true);
    setError(null);
    const result = await onBind(item.drop, recipient);
    setBusy(false);
    if (result.ok) {
      saveClaimWallet(family, recipient);
      onRefresh?.();
      return;
    }
    if (result.code === "fresh_login_required") {
      setFreshLeft(0);
      return;
    }
    if (result.code === "bad_address") {
      setStep("paste");
      setError("that address was refused. check it and paste it again.");
      return;
    }
    // Paused, ended, already bound: the list says what is true now.
    setError("that did not work. the page shows where this drop stands now.");
    onRefresh?.();
  };

  const txLink = item.claimTxHash === null ? null : txUrl(item.chainId, item.claimTxHash);

  return (
    <section className="mt-4">
      <Link href="/claim" className="type-small text-chad-text-dim hover:text-chad-text">
        ← your drops
      </Link>

      <div className="card mt-3 p-4 md:mx-auto md:max-w-xl md:p-6">
        <DropGif giphy={item.giphy} />
        <div className="flex items-center gap-3">
          <span className="relative shrink-0">
            <Avatar
              src={item.sender?.profileImageUrl ?? null}
              name={item.sender?.handle ?? "?"}
              size={40}
              className="rounded-lg!"
            />
            <ChainBadge chainId={item.chainId} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{titleOf(item)}</p>
            <p className="type-small truncate text-chad-text-dim">
              {item.sender ? `from @${item.sender.handle}` : "unknown sender"}
            </p>
          </div>
        </div>
        <FitNumber
          value={formatAmount(item.amount, item.decimals)}
          steps={DISPLAY_FIT_STEPS}
          className="num mt-5"
          logo={
            item.token ? (
              <QuickTokenLogo
                chainId={item.chainId}
                mint={item.token.mint}
                size={24}
                className="-mt-1 mr-2"
              />
            ) : null
          }
          unit={
            <Ticker symbol={item.symbol} className="type-body font-medium text-chad-text-dim" />
          }
        />

        <div className="mt-6">
          {screen === "fresh-login" ? (
            <>
              <p className="type-body text-chad-text-dim">
                you signed in more than 10 minutes ago. for safety, sign in with X once more before
                you pick a wallet. it takes a few seconds.
              </p>
              <a
                href={claimLoginHref(item.drop)}
                className="btn btn-x mt-4 h-11 w-full px-5 md:w-auto"
              >
                sign in again
              </a>
            </>
          ) : screen === "paste" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (address.trim() !== "" && shapeError === null) setStep("confirm");
              }}
            >
              <label htmlFor="claim-address" className="type-body font-medium">
                where should it land?
              </label>
              <Input
                id="claim-address"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setError(null);
                }}
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                className="type-body mt-2 h-11 rounded-lg border-chad-border bg-chad-surface font-mono"
                placeholder={family === "svm" ? "your Solana address" : "0x…"}
              />
              <p className="type-small mt-2 text-chad-text-dim">{pasteHint(family)}</p>
              {shapeError !== null || error !== null ? (
                <p className="type-small mt-2 text-chad-error">{shapeError ?? error}</p>
              ) : null}
              <button
                type="submit"
                disabled={address.trim() === "" || shapeError !== null}
                className="btn btn-primary mt-4 h-11 w-full px-6 md:w-auto"
              >
                next
              </button>
            </form>
          ) : screen === "confirm" ? (
            <>
              <p className="type-body text-chad-text-dim">{confirmTitle(item)}</p>
              <p className="type-body mt-2 font-mono break-all text-chad-text">{address.trim()}</p>
              <p className="type-small mt-4 text-chad-text-dim">
                check every character. after this it cannot be changed.
              </p>
              {error !== null ? <p className="type-small mt-2 text-chad-error">{error}</p> : null}
              <div className="mt-5 flex flex-col-reverse gap-2 md:flex-row">
                <button
                  type="button"
                  onClick={() => setStep("paste")}
                  className="btn btn-secondary h-11 w-full px-5 md:w-auto"
                >
                  change address
                </button>
                <button
                  type="button"
                  onClick={() => void claim(address.trim())}
                  disabled={busy}
                  className="btn btn-primary h-11 w-full px-6 md:w-auto"
                >
                  claim
                </button>
              </div>
            </>
          ) : screen === "sending" ? (
            <p className="type-body flex items-center gap-2">
              <span className="live-dot size-2 rounded-full bg-chad-accent" aria-hidden="true" />
              <ClaimAddress prefix={SENDING_PREFIX} address={item.recipient ?? ""} />
            </p>
          ) : screen === "paid" ? (
            <div className="flex flex-col gap-3">
              <span className="type-stat text-chad-accent">paid</span>
              {item.recipient || txLink ? (
                <div
                  data-paid-row="true"
                  className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4"
                >
                  {item.recipient ? (
                    <ClaimAddress
                      prefix="to "
                      address={item.recipient}
                      className="type-body font-mono"
                    />
                  ) : null}
                  {txLink ? (
                    <a
                      href={txLink}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary type-body h-11 w-full px-5 md:ml-auto md:w-auto md:shrink-0"
                    >
                      tx ↗
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : screen === "failed" ? (
            <>
              <p className="type-body text-chad-text-dim">
                the claim did not go through. your share is safe and still yours.
              </p>
              <button
                type="button"
                onClick={() => {
                  setAddress("");
                  setStep("paste");
                }}
                className="btn btn-secondary mt-4 h-11 w-full px-5 md:w-auto"
              >
                use another address
              </button>
            </>
          ) : screen === "retry" ? (
            <>
              <p className="type-body text-chad-text-dim">
                the claim did not go through. your share is safe and still yours.
              </p>
              {error !== null ? <p className="type-small mt-2 text-chad-error">{error}</p> : null}
              <button
                type="button"
                onClick={() => void claim(claimAgainRecipient(item))}
                disabled={busy}
                className="btn btn-primary mt-4 h-11 w-full px-6 md:w-auto"
              >
                claim again
              </button>
            </>
          ) : screen === "stuck" ? (
            <p className="type-body text-chad-text-dim">the wallet you gave cannot be paid.</p>
          ) : screen === "paused" ? (
            <p className="type-body text-chad-text-dim">{pausedLine(item)}</p>
          ) : screen === "ended" ? (
            <p className="type-body text-chad-text-dim">{endedLine(item)}</p>
          ) : (
            <p className="type-body text-chad-text-dim">
              the sender has not funded this drop yet. the claim button shows up once they do.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

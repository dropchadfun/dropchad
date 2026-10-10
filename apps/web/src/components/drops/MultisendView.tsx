"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { paymentUriFor } from "@/components/drops/DropPage";
import { FundingCard } from "@/components/drops/FundingCard";
import { StatusChip } from "@/components/drops/StatusChip";
import { chipForChain, chipForOwnState } from "@/components/drops/drop-card-data";
import {
  MULTISEND_PAGE,
  applyClaimPaid,
  isSender as isSenderOf,
  moreLabel,
  progressLine,
  receiverRows,
  summaryLine,
  type Receiver,
  type ReceiverRow,
} from "@/components/drops/multisend";
import { CopyButton } from "@/components/site/CopyButton";
import { Empty } from "@/components/site/Empty";
import { TestnetMark } from "@/components/site/Wordmark";
import { getDrop, openLive, type DropDetail } from "@/lib/api";
import { addressUrl, decimalsOf, nativeSymbol, txUrl } from "@/lib/chains";
import { formatAmount, percent, shortAddress, shortHash } from "@/lib/format";

/**
 * The multisend page, `/m/<address>`.
 * A tool's status page: who got paid, nothing else. No rain, no
 * share card, no picture, no replay, and never the sender's name; the api does not send it.
 *
 * `isSender` is what the server knew, always false: its read carries no cookie. The browser
 * reads the drop again on mount, with the cookie, and the api's `yours` decides.
 */
export function MultisendView({
  initial,
  receivers,
  isSender: initialSender,
  now,
}: {
  initial: DropDetail;
  /** From the manifest; `null` when it could not be read. */
  receivers: readonly Receiver[] | null;
  isSender: boolean;
  /** Fixed in tests; the clock otherwise. */
  now?: number;
}) {
  const [detail, setDetail] = useState(initial);
  const [sender, setSender] = useState(initialSender);
  const [shown, setShown] = useState(MULTISEND_PAGE);
  const [rows, setRows] = useState<ReceiverRow[]>(() => rowsOf(initial, receivers));
  const [paidCount, setPaidCount] = useState(() => countOf(initial));
  const [funding, setFunding] = useState(() => initial.ours.data?.state === "created");

  const ours = detail.ours.data;
  const chainDrop = detail.chain.data?.drop ?? null;
  const chainId = ours?.chainId ?? chainDrop?.chainId ?? 0;
  const leafCount = ours?.leafCount ?? chainDrop?.leafCount ?? rows.length;
  const decimals = decimalsOf(chainId);
  const symbol = nativeSymbol(chainId);
  const createdAt = ours
    ? Math.floor(new Date(ours.createdAt).getTime() / 1000)
    : Number(chainDrop?.createdAt ?? 0);

  // Every leaf paid on chain is DONE whatever our row says, as on the drop page.
  const chip = useMemo(() => {
    const chain = chainDrop ? chipForChain(chainDrop) : null;
    if (chain === "DONE") return "DONE";
    return ours ? chipForOwnState(ours.state) : (chain ?? "FUNDING");
  }, [ours, chainDrop]);

  // The browser's own read: the cookie goes with it, so `yours` can be true.
  useEffect(() => {
    let live = true;
    getDrop(initial.address).then(
      (fresh) => {
        if (!live) return;
        setDetail(fresh);
        setSender(isSenderOf(fresh));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [initial.address]);

  // The live stream, while something can still happen. No rain: the rows are the show.
  useEffect(() => {
    if (chip === "DONE" || chip === "EXPIRED") return;
    return openLive(initial.address, (event) => {
      switch (event.type) {
        case "snapshot":
          setPaidCount((n) => Math.max(n, event.paidCount));
          if (event.state !== "created") setFunding(false);
          break;
        case "funding_seen":
        case "activated":
          setFunding(false);
          break;
        case "claim_paid":
          setPaidCount((n) => Math.max(n, event.paidCount));
          setRows((list) => applyClaimPaid(list, { index: event.index, txHash: event.txHash }));
          break;
        case "finished":
          getDrop(initial.address).then(
            (fresh) => {
              setDetail(fresh);
              setSender(isSenderOf(fresh));
              setRows(rowsOf(fresh, receivers));
              setPaidCount((n) => Math.max(n, countOf(fresh)));
            },
            () => undefined,
          );
          break;
      }
    });
  }, [chip, initial.address, receivers]);

  const paid = Math.max(paidCount, rows.filter((row) => row.state === "paid").length);
  const more = moreLabel(rows.length, shown);
  const createTx = ours?.createTxHash ?? chainDrop?.transactionHash ?? null;
  const contractUrl = addressUrl(chainId, detail.address);

  return (
    <main className="mx-auto w-full max-w-(--container-content) px-4 py-4 md:py-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="type-h1">multisend</h1>
          <p className="type-small mt-1 text-chad-text-dim">
            {summaryLine(
              {
                amountWei: ours?.totalEntitlementsWei ?? chainDrop?.totalEntitlements ?? "0",
                chainId,
                receivers: leafCount,
                createdAt,
              },
              now,
            )}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <TestnetMark />
          <StatusChip chip={funding ? "FUNDING" : chip} />
        </span>
      </div>

      {sender ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="type-body text-chad-text-dim">you sent this</p>
          <CopyButton value={pageUrl(detail.address)} label="copy the link" />
        </div>
      ) : null}

      {funding && ours ? (
        <section className="mt-6">
          <p className="type-small mb-3 text-chad-text-dim">
            fund the address below and this page moves on by itself.
          </p>
          <FundingCard
            address={detail.address}
            chainId={ours.chainId}
            amountWei={ours.totalEntitlementsWei}
            feeWei={ours.feeAmountWei}
            grossWei={ours.grossRequiredWei}
            paymentUri={paymentUriFor(detail.address, ours.chainId, ours.grossRequiredWei)}
            kind="multisend"
            fundingDeadline={ours.fundingDeadline}
          />
        </section>
      ) : null}

      {/* progress, one number and one bar */}
      <section className="mt-6">
        <p className="type-body font-medium">{progressLine(paid, leafCount)}</p>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-chad-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={leafCount}
          aria-valuenow={paid}
        >
          <div className="h-full bg-chad-accent" style={{ width: percent(paid, leafCount) }} />
        </div>
      </section>

      {/* every receiver */}
      <section className="mt-6">
        {rows.length === 0 ? (
          <Empty>the list of receivers could not be read. try again in a minute.</Empty>
        ) : (
          <>
            <div className="type-label hidden grid-cols-[48px_minmax(0,1fr)_160px_80px_64px] gap-3 border-b border-chad-border px-3 pb-2 md:grid">
              <span>#</span>
              <span>address</span>
              <span className="text-right">amount</span>
              <span>state</span>
              <span className="text-right">tx</span>
            </div>
            <ul className="type-table">
              {rows.slice(0, shown).map((row) => {
                const link = row.txHash === null ? null : txUrl(chainId, row.txHash);
                return (
                  <li
                    key={row.index}
                    className="row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1 md:grid-cols-[48px_minmax(0,1fr)_160px_80px_64px] md:py-2"
                  >
                    <span className="num hidden text-chad-text-dim md:block">{row.index + 1}</span>
                    <AddressCopy address={row.recipient} />
                    {/* Phone: the state small under the amount, a paid row links its tx. */}
                    <span className="flex flex-col items-end text-right">
                      <span className="num font-medium">
                        {formatAmount(row.amount, decimals)} {symbol}
                      </span>
                      <span className="md:hidden">
                        <RowState state={row.state} link={link} />
                      </span>
                    </span>
                    <span className="hidden md:block">
                      <RowState state={row.state} link={null} />
                    </span>
                    <span className="hidden text-right md:block">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="type-small text-chad-text-dim hover:text-chad-text"
                        >
                          tx ↗
                        </a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {more ? (
              <button
                type="button"
                onClick={() => setShown((n) => n + MULTISEND_PAGE)}
                className="btn btn-secondary mt-4 h-11 w-full md:w-auto md:px-6"
              >
                {more}
              </button>
            ) : null}
          </>
        )}
      </section>

      {/* the proof, level two */}
      <section className="mt-8 border-t border-chad-border pt-4">
        <p className="type-label mb-3">proof</p>
        <dl className="type-small grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
          <dt className="text-chad-text-dim">contract</dt>
          <ProofValue
            value={detail.address}
            short={shortAddress(detail.address)}
            href={contractUrl}
          />
          {ours ? (
            <>
              <dt className="text-chad-text-dim">merkle root</dt>
              <ProofValue value={ours.merkleRoot} short={shortHash(ours.merkleRoot)} href={null} />
              <dt className="text-chad-text-dim">manifest</dt>
              <dd>
                <a
                  href={ours.manifestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-chad-accent hover:text-chad-accent-hover"
                >
                  every receiver and proof ↗
                </a>
              </dd>
            </>
          ) : null}
          {createTx ? (
            <>
              <dt className="text-chad-text-dim">created in</dt>
              <ProofValue
                value={createTx}
                short={shortHash(createTx)}
                href={txUrl(chainId, createTx)}
              />
            </>
          ) : null}
        </dl>
      </section>
    </main>
  );
}

/** A row's state word. `paid` with a link to its transaction when there is one, the phone's only tx link. */
function RowState({ state, link }: { state: ReceiverRow["state"]; link: string | null }) {
  if (state === "paid" && link !== null) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="type-small text-chad-text-dim hover:text-chad-text"
      >
        paid ↗
      </a>
    );
  }
  return (
    <span
      className={
        state === "failed" ? "type-small text-chad-error" : "type-small text-chad-text-dim"
      }
    >
      {state}
    </span>
  );
}

/**
 * One proof value in mono: short on the phone, whole on the desktop, a link when it has a page,
 * and a copy button for the whole value at every width.
 */
function ProofValue({ value, short, href }: { value: string; short: string; href: string | null }) {
  const text = (
    <>
      <span className="md:hidden">{short}</span>
      <span className="hidden break-all md:inline">{value}</span>
    </>
  );
  return (
    <dd className="flex min-w-0 items-center gap-1 font-mono">
      {href ? (
        <a
          href={href}
          title={value}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 hover:text-chad-text"
        >
          {text}
        </a>
      ) : (
        <span className="min-w-0" title={value}>
          {text}
        </span>
      )}
      <CopyIcon value={value} />
    </dd>
  );
}

/** A copy icon alone, 44px to tap on the phone. */
function CopyIcon({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`copy ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="flex size-11 shrink-0 items-center justify-center rounded-md hover:text-chad-text md:size-6"
    >
      {done ? (
        <Check className="size-3.5 text-chad-accent" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5 text-chad-text-mute" aria-hidden="true" />
      )}
    </button>
  );
}

/** The short address in mono; a tap copies the whole one. The full address is the title. */
function AddressCopy({ address }: { address: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={address}
      aria-label={`copy ${address}`}
      onClick={() => {
        void navigator.clipboard?.writeText(address).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="flex min-h-11 min-w-0 items-center gap-2 text-left font-mono hover:text-chad-text md:min-h-0"
    >
      <span className="truncate">{shortAddress(address)}</span>
      {done ? (
        <Check className="size-3.5 shrink-0 text-chad-accent" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5 shrink-0 text-chad-text-mute" aria-hidden="true" />
      )}
    </button>
  );
}

function rowsOf(detail: DropDetail, receivers: readonly Receiver[] | null): ReceiverRow[] {
  return receiverRows(
    receivers ?? [],
    detail.chain.data?.claims ?? [],
    detail.ours.data?.failedIndexes ?? [],
  );
}

function countOf(detail: DropDetail): number {
  return Math.max(detail.ours.data?.paidCount ?? 0, detail.chain.data?.drop.claimedCount ?? 0);
}

/** The page's own link, to keep. Read at the tap, so the server render never needs an origin. */
function pageUrl(address: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/m/${address}`;
}

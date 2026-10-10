"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AfterView } from "@/components/drops/AfterView";
import { chipForChain, chipForOwnState } from "@/components/drops/drop-card-data";
import { FundingCard, FundingCardFrom } from "@/components/drops/FundingCard";
import { Empty } from "@/components/site/Empty";
import { LiveView, type PaidEntry } from "@/components/drops/LiveView";
import { ShareCardSection } from "@/components/drops/ShareCard";
import { getDrop, openLive, type DropDetail, type LiveEvent } from "@/lib/api";
import { familyOf } from "@/lib/chains";
import { formatAmount } from "@/lib/format";

type Phase = "funding" | "live" | "after";

/**
 * The drop page for the whole life of a drop.
 *
 * - `funding`: created, not yet funded. The funding card above the live view, for the creator
 *   only; everyone else gets one line and no address.
 * - `live`: money is moving. `who got fed` grows from the SSE stream.
 * - `after`: finished or expired. The same clean layout, the proof at the bottom.
 *
 * No rain and no replay anywhere. Receivers show by `@handle` from the
 * api's `fed`, never by the address the money landed on.
 *
 * Under `live` and `after`: the sender's share card, `ShareCard.tsx`, for the sender only.
 *
 * The stream is a notification, never the truth: on `finished` the page re-reads the drop from
 * the api and the after view renders from that.
 */
export function DropPage({ initial }: { initial: DropDetail }) {
  const [detail, setDetail] = useState(initial);
  const [phase, setPhase] = useState<Phase>(() => phaseOf(initial));
  // What the server knew is always false: its read carries no cookie. The browser's own read
  // decides.
  const [mine, setMine] = useState(() => isMine(initial));
  const [paid, setPaid] = useState<PaidEntry[]>(() => paidFrom(initial));
  const [paidCount, setPaidCount] = useState(() => countOf(initial));
  const queue = useRef<LiveEvent[]>([]);
  const [tick, setTick] = useState(0);

  const leafCount =
    detail.ours.data?.leafCount ?? detail.chain.data?.drop.leafCount ?? Math.max(1, paid.length);

  const refresh = useCallback(async () => {
    try {
      const fresh = await getDrop(detail.address);
      setDetail(fresh);
      setMine(isMine(fresh));
      setPaid(paidFrom(fresh));
      setPaidCount(countOf(fresh));
      setPhase(phaseOf(fresh));
    } catch {
      // Keep what we have. The stream told us it finished; the numbers on screen are already right.
      setPhase("after");
    }
  }, [detail.address]);

  // The browser's own read: the cookie goes with it, so `yours` can be true, and only then does
  // the answer carry the funding the creator needs.
  useEffect(() => {
    let live = true;
    getDrop(initial.address).then(
      (fresh) => {
        if (!live) return;
        setDetail(fresh);
        setMine(isMine(fresh));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [initial.address]);

  // The stream, only while there is something to hear. A drop we did not create has no stream
  // (404), and `openLive` just closes on error.
  useEffect(() => {
    if (phase === "after" || !detail.ours.known) return;
    const close = openLive(detail.address, (event) => {
      queue.current.push(event);
      setTick((n) => n + 1);
    });
    return close;
  }, [phase, detail.address, detail.ours.known]);

  // Drain the queue in render order. Kept out of the SSE callback so React batches sanely.
  useEffect(() => {
    if (queue.current.length === 0) return;
    const events = queue.current.splice(0);
    let finished = false;
    for (const event of events) {
      switch (event.type) {
        case "snapshot":
          setPaidCount((n) => Math.max(n, event.paidCount));
          if (event.state !== "created" && phase === "funding") setPhase("live");
          break;
        case "funding_seen":
        case "activated":
          setPhase("live");
          break;
        case "claim_paid":
          setPaidCount(event.paidCount);
          setPaid((list) =>
            list.some((entry) => entry.index === event.index)
              ? list
              : [
                  ...list,
                  {
                    index: event.index,
                    recipient: event.recipient,
                    handle: event.handle ?? null,
                    profileImageUrl: event.profileImageUrl ?? null,
                    amountWei: event.amountWei,
                    txHash: event.txHash,
                    fresh: true,
                  },
                ],
          );
          break;
        case "finished":
          setPaidCount(event.paidCount);
          finished = true;
          break;
      }
    }
    if (finished) void refresh();
  }, [tick, phase, refresh]);

  const ours = detail.ours.data;
  const chainDrop = detail.chain.data?.drop ?? null;
  const chainId = ours?.chainId ?? chainDrop?.chainId ?? 0;
  const amountWei = ours?.totalEntitlementsWei ?? chainDrop?.totalEntitlements ?? "0";
  const title = ours?.title ?? null;
  const creator = ours?.creator ?? null;
  const createdAt = ours
    ? Math.floor(new Date(ours.createdAt).getTime() / 1000)
    : chainDrop
      ? Number(chainDrop.createdAt)
      : null;

  // Every leaf paid on chain is DONE whatever our row says, `chipForChain`; otherwise our
  // state is the finer one while it exists.
  const chip = useMemo(() => {
    const chain = chainDrop ? chipForChain(chainDrop) : null;
    if (chain === "DONE") return "DONE";
    return ours ? chipForOwnState(ours.state) : (chain ?? "FUNDING");
  }, [ours, chainDrop]);

  // The share card asks the api itself, from the browser, with the cookie. Never while funding.
  const share = phase === "funding" ? null : <ShareCardSection address={detail.address} live />;

  if (phase === "after") {
    return (
      <>
        <AfterView
          detail={detail}
          paid={paid}
          paidCount={paidCount}
          leafCount={leafCount}
          chainId={chainId}
          amountWei={amountWei}
          createdAt={createdAt}
          title={title}
          creator={creator}
          chip={chip}
        />
        {share}
      </>
    );
  }

  return (
    <>
      <main className="mx-auto w-full max-w-(--container-content) px-4 py-4 md:py-8">
        {phase === "funding" && ours && mine ? (
          // The same centred `max-w-xl` column as the rest of the drop page.
          <div className="mx-auto mb-6 w-full max-w-xl">
            <h1 className="type-h1">waiting for the money</h1>
            <p className="type-small mt-1 mb-4 text-chad-text-dim">
              fund the address below and this page moves on by itself.
            </p>
            <DropFunding address={detail.address} ours={ours} />
          </div>
        ) : phase === "funding" && ours ? (
          <p className="type-body mx-auto mb-6 w-full max-w-xl text-chad-text-dim">
            {waitingLine(creator?.handle ?? null)}
          </p>
        ) : null}
        <LiveView
          address={detail.address}
          chainId={chainId}
          token={ours?.token ?? null}
          title={title}
          creator={creator}
          amountWei={amountWei}
          createdAt={createdAt}
          leafCount={leafCount}
          paidCount={paidCount}
          paid={paid}
          waiting={phase === "funding"}
        />
      </main>
      {share}
    </>
  );
}

/**
 * The funding card while the drop waits for money: from `ours.funding`, the same
 * answer the create page had, for every drop. An api before 4f sends none: a SOL or ETH drop
 * then keeps the old card from `grossRequiredWei`, which is right for it; a token drop gets an
 * honest line, since its `grossRequiredWei` is the token total, never an amount of SOL.
 */
function DropFunding({
  address,
  ours,
}: {
  address: string;
  ours: NonNullable<DropDetail["ours"]["data"]>;
}) {
  if (ours.funding) {
    return (
      <FundingCardFrom
        funding={ours.funding}
        amountWei={ours.totalEntitlementsWei}
        feeWei={ours.feeAmountWei}
      />
    );
  }
  if (ours.token) {
    return <Empty>the funding details cannot load right now. reload in a minute.</Empty>;
  }
  return (
    <FundingCard
      address={address}
      chainId={ours.chainId}
      amountWei={ours.totalEntitlementsWei}
      feeWei={ours.feeAmountWei}
      grossWei={ours.grossRequiredWei}
      paymentUri={paymentUriFor(address, ours.chainId, ours.grossRequiredWei)}
      fundingDeadline={ours.fundingDeadline}
    />
  );
}

/** The api's word from the session cookie, never a profile comparison. */
function isMine(detail: DropDetail): boolean {
  return detail.ours.data?.yours === true;
}

/** What everyone but the creator sees while the drop waits for money. */
function waitingLine(handle: string | null): string {
  return handle === null
    ? "waiting for this drop to be funded"
    : `waiting for @${handle} to fund this drop`;
}

function phaseOf(detail: DropDetail): Phase {
  const ours = detail.ours.data;
  if (ours) {
    if (ours.state === "created") return "funding";
    if (ours.state === "funded" || ours.state === "active" || ours.state === "paying")
      return "live";
    return "after";
  }
  const status = detail.chain.data?.drop.status;
  if (status === "Created") return "funding";
  if (status === "Active") return "live";
  return "after";
}

/** The chain's claims, each named by the api's `fed` when it knows the X account. */
function paidFrom(detail: DropDetail): PaidEntry[] {
  const names = new Map((detail.ours.data?.fed ?? []).map((person) => [person.index, person]));
  return (detail.chain.data?.claims ?? []).map((claim) => ({
    index: claim.index,
    recipient: claim.recipient,
    handle: names.get(claim.index)?.handle ?? null,
    profileImageUrl: names.get(claim.index)?.profileImageUrl ?? null,
    amountWei: claim.amount,
    // `null` on Solana: the bitmap says paid, not which transaction paid it.
    txHash: claim.transactionHash,
    fresh: false,
  }));
}

function countOf(detail: DropDetail): number {
  return Math.max(detail.ours.data?.paidCount ?? 0, detail.chain.data?.drop.claimedCount ?? 0);
}

/** EIP 681 on an EVM chain, Solana Pay on Solana. The same two shapes the api hands out. */
export function paymentUriFor(address: string, chainId: number, grossBaseUnits: string): string {
  return familyOf(chainId) === "svm"
    ? `solana:${address}?amount=${formatAmount(grossBaseUnits, 9, 9)}`
    : `ethereum:${address}@${String(chainId)}?value=${grossBaseUnits}`;
}

"use client";

import Link from "next/link";
import { useCallback, useRef, useSyncExternalStore, type Ref, type SetStateAction } from "react";

import {
  BETA_CARD_HEAD,
  BETA_CARD_TAIL,
  BETA_CARD_TITLE,
  rememberBetaCard,
  shouldShowBetaCard,
} from "@/lib/beta-card";
import { TESTNET_ONLY } from "@/lib/chains";
import { useDismiss } from "@/lib/dismiss";

/** `localStorage`, or `null` when even reading the property throws. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Closed on this page, so it stays closed even when the storage write was blocked. */
let closedHere = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isOpen(): boolean {
  if (closedHere) return false;
  const storage = browserStorage();
  return storage !== null && shouldShowBetaCard(storage, TESTNET_ONLY);
}

function closeBetaCard(): void {
  const storage = browserStorage();
  if (storage !== null) rememberBetaCard(storage);
  closedHere = true;
  listeners.forEach((listener) => {
    listener();
  });
}

/**
 * The beta card: the welcome popup's box and
 * place, in the middle over a dimmed page. Drawn in the browser only: the server snapshot is
 * closed, so the server HTML, a link preview, the og image and the share card never carry it.
 * Escape and a click or tap outside close it through the shared dismiss hook; every way of
 * closing it is remembered. `caps` are the lines of the live chains, read by the layout on the
 * server from the api switch.
 */
export function BetaCard({ caps }: { caps: readonly string[] }) {
  const open = useSyncExternalStore(subscribe, isOpen, () => false);
  const box = useRef<HTMLDivElement>(null);
  // The dismiss hook only ever closes; closing that way is remembered too.
  const dismiss = useCallback((value: SetStateAction<boolean>) => {
    if (value === false) closeBetaCard();
  }, []);
  useDismiss(open, box, dismiss);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chad-bg/70 px-4">
      <BetaCardBox ref={box} caps={caps} onClose={closeBetaCard} />
    </div>
  );
}

/** The card itself: the title, the head, one cap per line, the tail and the two buttons. */
export function BetaCardBox({
  ref,
  caps,
  onClose,
}: {
  ref?: Ref<HTMLDivElement>;
  caps: readonly string[];
  onClose: () => void;
}) {
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-card-title"
      className="welcome-glow w-fit max-w-full rounded-xl border border-chad-accent bg-chad-surface p-4 md:p-6"
    >
      <h2 id="beta-card-title" className="type-body font-medium text-chad-text">
        {BETA_CARD_TITLE}
      </h2>
      <p className="type-small mt-2 text-chad-text-dim">{BETA_CARD_HEAD}</p>
      <ul className="type-body mt-1 text-chad-text">
        {caps.map((cap) => (
          <li key={cap}>{cap}</li>
        ))}
        <li>{BETA_CARD_TAIL[0]}</li>
      </ul>
      <div className="type-small mt-2 text-chad-text-dim">
        <p>{BETA_CARD_TAIL[1]}</p>
        <p>{BETA_CARD_TAIL[2]}</p>
      </div>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} autoFocus className="btn btn-primary h-11">
          got it
        </button>
        <Link href="/terms" onClick={onClose} className="btn btn-secondary h-11">
          terms
        </Link>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useRef, useSyncExternalStore, type Ref, type SetStateAction } from "react";

import { TESTNET_ONLY } from "@/lib/chains";
import { useDismiss } from "@/lib/dismiss";
import {
  WELCOME_LINES,
  WELCOME_SETUP_HREF,
  WELCOME_TITLE,
  rememberWelcome,
  shouldShowWelcome,
} from "@/lib/welcome";

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
  return storage !== null && shouldShowWelcome(storage, TESTNET_ONLY);
}

function closeWelcome(): void {
  const storage = browserStorage();
  if (storage !== null) rememberWelcome(storage);
  closedHere = true;
  listeners.forEach((listener) => {
    listener();
  });
}

/**
 * The welcome popup. Drawn in the browser
 * only: the server snapshot is closed, so the server HTML never carries it, and a link preview,
 * the og image and the share card never do. Escape and a click or tap outside close it through
 * the shared dismiss hook; every way of closing it is remembered.
 */
export function WelcomePopup() {
  const open = useSyncExternalStore(subscribe, isOpen, () => false);
  const box = useRef<HTMLDivElement>(null);
  // The dismiss hook only ever closes; closing that way is remembered too.
  const dismiss = useCallback((value: SetStateAction<boolean>) => {
    if (value === false) closeWelcome();
  }, []);
  useDismiss(open, box, dismiss);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chad-bg/70 px-4">
      <WelcomeBox ref={box} onClose={closeWelcome} onSetup={closeWelcome} />
    </div>
  );
}

/** The box itself: the title, the three lines and the two buttons. */
export function WelcomeBox({
  ref,
  onClose,
  onSetup,
}: {
  ref?: Ref<HTMLDivElement>;
  onClose: () => void;
  onSetup: () => void;
}) {
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="welcome-glow w-full max-w-120 rounded-xl border border-chad-accent bg-chad-surface p-4 md:p-6"
    >
      <h2 id="welcome-title" className="type-h2">
        {WELCOME_TITLE}
      </h2>
      <div className="type-body mt-3 space-y-2 text-chad-text">
        {WELCOME_LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-2 md:flex-row md:justify-end">
        <Link href={WELCOME_SETUP_HREF} onClick={onSetup} className="btn btn-secondary h-11">
          set up my test wallet
        </Link>
        <button type="button" onClick={onClose} autoFocus className="btn btn-primary h-11">
          lets go
        </button>
      </div>
    </div>
  );
}

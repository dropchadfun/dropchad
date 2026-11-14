"use client";

import { useEffect, useState } from "react";

import { openClaimCount } from "@/components/drops/claim";
import { getClaims } from "@/lib/api";

/**
 * The count to claim now, for `claim` in the phone bottom bar and the desktop top menu
 * one read of `GET /api/claims` per page load,
 * shared by both menus, and one more each time the visitor leaves `/claim`, so a claim made there
 * clears the number.
 */

/** The small mint number on `claim`, the same in both menus; each menu adds only its place. */
export const CLAIM_DOT =
  "type-small flex h-4 min-w-4 items-center justify-center rounded-full bg-chad-accent px-1 leading-none font-semibold text-chad-bg";

let generation = 0;
let lastOnClaim: boolean | null = null;
let shared: { readonly generation: number; readonly count: Promise<number | null> } | null = null;

/**
 * The read for this path: one more after leaving `/claim`. Both menus pass the same path, so a
 * second call with it changes nothing.
 */
export function routeGeneration(pathname: string): number {
  const onClaim = pathname.startsWith("/claim");
  if (lastOnClaim === true && !onClaim) generation += 1;
  lastOnClaim = onClaim;
  return generation;
}

/** The count of that read, asked once whoever asks; `null` when the read failed. */
export function claimCountRead(round: number): Promise<number | null> {
  if (shared === null || shared.generation !== round) {
    shared = {
      generation: round,
      count: getClaims().then(
        (answer) => openClaimCount(answer.claims),
        () => null,
      ),
    };
  }
  return shared.count;
}

/** `null` signed out, before the answer, or when the read failed. */
export function useClaimCount(signedIn: boolean, pathname: string): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // Every path change asks; only a new read round (after leaving `/claim`) calls the api.
    const round = routeGeneration(pathname);
    // Signed out the menus show no number whatever this holds, so there is nothing to clear.
    if (!signedIn) return;
    let live = true;
    void claimCountRead(round).then((value) => {
      if (live) setCount(value);
    });
    return () => {
      live = false;
    };
  }, [signedIn, pathname]);

  return count;
}

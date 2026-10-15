"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { ClaimView, type BindResult } from "@/components/drops/ClaimView";
import { NO_SEED_LINE, isPartial, type ClaimItem } from "@/components/drops/claim";
import {
  claimPreviewScreen,
  sampleClaims,
  type ClaimPreviewScreen,
} from "@/components/drops/claim-preview";
import { useSession } from "@/components/site/SessionProvider";
import { ApiError, bindDrop, getClaims } from "@/lib/api";
import { readCsrfToken } from "@/lib/csrf";

const noSubscribe = () => () => undefined;

/**
 * `/claim`, the state around `ClaimView`: who is signed in, the list from `GET /api/claims`, and
 * the bind. Or, in local development only, a preview of one screen with sample data.
 */
export function ClaimPage({ drop }: { drop: string | null }) {
  const preview = useSyncExternalStore(
    noSubscribe,
    // `NODE_ENV === "development"` first: a production build turns it into `false` and drops
    // the call, so the preview is not only off there but gone, as on `/create`.
    () =>
      process.env.NODE_ENV === "development"
        ? claimPreviewScreen(window.location.search, {
            nodeEnv: process.env.NODE_ENV,
            hostname: window.location.hostname,
          })
        : null,
    () => null,
  );
  // The constant first again: a production build folds this to `false` and drops the preview,
  // its sample data with it.
  if (process.env.NODE_ENV === "development" && preview !== null)
    return <ClaimPreview screen={preview} />;
  return <LiveClaimPage drop={drop} />;
}

function LiveClaimPage({ drop }: { drop: string | null }) {
  const { profile } = useSession();
  const [claims, setClaims] = useState<readonly ClaimItem[] | null>(null);
  const [freshLeft, setFreshLeft] = useState(0);
  const [partial, setPartial] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    getClaims().then(
      (answer) => {
        setClaims(answer.claims);
        setFreshLeft(answer.freshLoginSecondsLeft);
        setPartial(isPartial(answer));
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    if (profile) load();
  }, [profile, load]);

  const onBind = useCallback(async (address: string, recipient: string): Promise<BindResult> => {
    const token = readCsrfToken();
    if (token === null) return { ok: false, code: "unauthorized" };
    try {
      await bindDrop(address, recipient, token);
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error instanceof ApiError ? error.code : "request_failed" };
    }
  }, []);

  if (failed) {
    return (
      <main className="mx-auto w-full max-w-(--container-content) px-4 py-8">
        <h1 className="type-h1">claim</h1>
        <p className="type-small mt-1 text-chad-text-dim">{NO_SEED_LINE}</p>
        <p className="type-body mt-4 text-chad-text-dim">
          the list could not be read just now. try again in a minute.
        </p>
      </main>
    );
  }

  return (
    <ClaimView
      session={
        profile === null
          ? null
          : profile === undefined
            ? { handle: "" }
            : { handle: profile.handle }
      }
      claims={profile ? claims : null}
      freshLoginSecondsLeft={freshLeft}
      partial={partial}
      selected={drop}
      onBind={onBind}
      onRefresh={load}
    />
  );
}

const SAMPLE_WALLET = "0x1111111111111111111111111111111111110001";

/** One screen with sample data. Nothing here ever reaches the api. */
function ClaimPreview({ screen }: { screen: ClaimPreviewScreen }) {
  const samples = sampleClaims();
  const byState = (state: ClaimItem["state"]) =>
    samples.find((c) => c.state === state) as ClaimItem;
  const common = {
    session: { handle: "samplealice" },
    claims: samples,
    freshLoginSecondsLeft: 600,
    selected: null as string | null,
    preview: true,
  };
  const props = (() => {
    switch (screen) {
      case "signed-out":
        return { ...common, session: null, claims: null };
      case "list":
        return common;
      case "nothing":
        return { ...common, claims: [] };
      case "fresh-login":
        return { ...common, selected: byState("claimable").drop, freshLoginSecondsLeft: 0 };
      case "paste":
        return { ...common, selected: byState("claimable").drop };
      case "confirm":
        return {
          ...common,
          selected: byState("claimable").drop,
          initialStep: "confirm" as const,
          initialAddress: SAMPLE_WALLET,
        };
      case "sending":
        return { ...common, selected: byState("sending").drop };
      case "paid":
        return { ...common, selected: byState("paid").drop };
      case "failed":
        return { ...common, selected: byState("failed").drop };
      case "paused":
        return { ...common, selected: byState("paused").drop };
      case "ended":
        return { ...common, selected: byState("ended").drop };
      case "not-funded":
        return { ...common, selected: byState("not_funded").drop };
    }
  })();
  return <ClaimView {...props} />;
}

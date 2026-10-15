"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusChip } from "@/components/drops/StatusChip";
import { myMultisendRow } from "@/components/drops/multisend";
import { useSession } from "@/components/site/SessionProvider";
import { getMyMultisends, type MyMultisend } from "@/lib/api";

const FRAME = "mx-auto w-full max-w-(--container-content) px-4 py-8";

/**
 * `/multisends`: the signed in
 * sender's own multisends from `GET /api/me/multisends`. Signed out it asks to sign in, like
 * `/create`.
 */
export function MyMultisends() {
  const { profile } = useSession();
  const [rows, setRows] = useState<readonly MyMultisend[] | null>(null);
  // The time the list came, for the `3m ago` of each row.
  const [loadedAt, setLoadedAt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!profile) return;
    getMyMultisends().then(
      (answer) => {
        setRows(answer.multisends);
        setLoadedAt(Date.now());
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [profile]);

  if (profile === null) {
    return (
      <main className={FRAME}>
        <h1 className="type-h1">your multisends</h1>
        <p className="type-body mt-3 text-chad-text-dim">sign in with X first.</p>
        <a href="/api/auth/x/start" className="btn btn-x mt-6">
          sign in with X
        </a>
      </main>
    );
  }
  if (failed) {
    return (
      <main className={FRAME}>
        <h1 className="type-h1">your multisends</h1>
        <p className="type-body mt-4 text-chad-text-dim">
          the list could not be read just now. try again in a minute.
        </p>
      </main>
    );
  }
  return <MyMultisendList rows={rows} now={loadedAt} />;
}

/** The list itself, no state. `null` while it loads: the title and the grey line only. */
export function MyMultisendList({
  rows,
  now,
}: {
  rows: readonly MyMultisend[] | null;
  now: number;
}) {
  return (
    <main className={FRAME}>
      <h1 className="type-h1">your multisends</h1>
      <p className="type-small mt-1 text-chad-text-dim">only you see this list.</p>
      {rows === null ? null : rows.length === 0 ? (
        <p className="type-body mt-6 text-chad-text-dim">
          no multisends yet.{" "}
          <Link
            href="/create?mode=multisend"
            className="underline decoration-chad-text-mute underline-offset-2 hover:text-chad-text"
          >
            make a multisend
          </Link>
        </p>
      ) : (
        <ul className="type-table mt-6">
          {rows.map((row) => {
            const view = myMultisendRow(row, now);
            return (
              <li key={row.address}>
                <Link
                  href={view.href}
                  className="row grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{view.title}</p>
                    <p className="type-small text-pretty text-chad-text-dim">{view.line}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusChip chip={view.chip} />
                    <span className="type-small text-chad-text-dim">{view.progress}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

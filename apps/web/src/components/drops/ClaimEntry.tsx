"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { frontLine } from "@/components/drops/claim";
import { useSession } from "@/components/site/SessionProvider";
import { getClaims } from "@/lib/api";

/**
 * The ways in to `/claim` on the phone, where the bottom bar stays three items, handle mode step
 * 22. Both only for the signed in person; nothing shows while signed out.
 */

/** The front page: one line under `make a drop`, only when something can be claimed now. */
export function FrontClaimLine() {
  const { profile } = useSession();
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let live = true;
    getClaims().then(
      (answer) => live && setLine(frontLine(answer.claims)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [profile]);

  if (!profile || line === null) return null;
  return (
    <Link
      href="/claim"
      className="type-body mt-3 block text-chad-accent hover:text-chad-accent-hover"
    >
      {line}
    </Link>
  );
}

/** Your own profile: a quiet link to your drops. Someone else's profile shows nothing. */
export function ProfileClaimLink({ xUserId }: { xUserId: string }) {
  const { profile } = useSession();
  if (profile?.xUserId !== xUserId) return null;
  return (
    <Link
      href="/claim"
      className="type-small mt-3 inline-block text-chad-text-dim hover:text-chad-text"
    >
      your drops to claim →
    </Link>
  );
}

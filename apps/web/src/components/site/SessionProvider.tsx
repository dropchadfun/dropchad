"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { getMe, logout as apiLogout, type Me } from "@/lib/api";
import { readCsrfToken } from "@/lib/csrf";

interface SessionState {
  /** `undefined` while the first `/api/me` is in flight, `null` when nobody is signed in. */
  readonly profile: Me["profile"] | null | undefined;
  /** Which Kick and Twitch connects work. Both off until `/api/me` says otherwise. */
  readonly streamConnect: NonNullable<Me["streamConnect"]>;
  readonly refresh: () => Promise<void>;
  readonly logout: () => Promise<void>;
}

const STREAMS_OFF = { kick: false, twitch: false } as const;

const SessionContext = createContext<SessionState>({
  profile: undefined,
  streamConnect: STREAMS_OFF,
  refresh: () => Promise.resolve(),
  logout: () => Promise.resolve(),
});

/**
 * Who is signed in, read once from `/api/me` and shared. Client side on purpose: the session
 * cookie is httpOnly and scoped to this origin, so the browser is the only thing that can send
 * it, and a server component fetching the api directly would not carry it.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Me["profile"] | null | undefined>(undefined);
  const [streamConnect, setStreamConnect] = useState<NonNullable<Me["streamConnect"]>>(STREAMS_OFF);

  const refresh = useCallback(
    () =>
      getMe().then(
        (me) => {
          setProfile(me.profile);
          setStreamConnect(me.streamConnect ?? STREAMS_OFF);
        },
        // The api being down is not "logged out". Leave whatever we knew.
        () => setProfile((current) => current ?? null),
      ),
    [],
  );

  const logout = useCallback(async () => {
    const token = readCsrfToken();
    if (token !== null) {
      try {
        await apiLogout(token);
      } catch {
        // A failed logout call still ends the session locally; the cookie is gone either way
        // once the api answers, and a reload will tell the truth.
      }
    }
    setProfile(null);
  }, []);

  useEffect(() => {
    // Subscribing to the api on mount. The state changes in the callback, not in the effect.
    let live = true;
    getMe().then(
      (me) => {
        if (!live) return;
        setProfile(me.profile);
        setStreamConnect(me.streamConnect ?? STREAMS_OFF);
      },
      () => live && setProfile((current) => current ?? null),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <SessionContext.Provider value={{ profile, streamConnect, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

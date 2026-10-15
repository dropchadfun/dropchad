/**
 * Every cookie the api sets, in one file, so the flags cannot drift apart between routes.
 *
 * | cookie | httpOnly | why |
 * |---|---|---|
 * | `dc_session` | yes | the opaque session id. JavaScript must never read it, XSS must never steal it |
 * | `dc_oauth`   | yes | ten minute pre-session that binds a login to one browser |
 * | `dc_csrf`    | **no** | the double submit token. The frontend has to read it to echo it back |
 *
 * All three are `Secure`, `SameSite=Lax`, path `/`, and host scoped with no `Domain`, so they
 * never travel to a sibling subdomain.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { CSRF_COOKIE, OAUTH_COOKIE, SESSION_COOKIE } from "./session.js";

type CookieOptions = Parameters<typeof setCookie>[3];

function baseOptions(maxAgeSeconds: number, httpOnly: boolean): CookieOptions {
  return {
    httpOnly,
    // Always on. `http://localhost` counts as a secure context in every current browser, so this
    // works in dev and there is no "insecure in dev" branch that could reach production.
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookie(c: Context, sessionId: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, sessionId, baseOptions(maxAgeSeconds, true));
}

export function setCsrfCookie(c: Context, csrfToken: string, maxAgeSeconds: number): void {
  setCookie(c, CSRF_COOKIE, csrfToken, baseOptions(maxAgeSeconds, false));
}

export function setOauthCookie(c: Context, value: string, maxAgeSeconds: number): void {
  setCookie(c, OAUTH_COOKIE, value, baseOptions(maxAgeSeconds, true));
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function readOauthCookie(c: Context): string | undefined {
  return getCookie(c, OAUTH_COOKIE);
}

export function readCsrfCookie(c: Context): string | undefined {
  return getCookie(c, CSRF_COOKIE);
}

export function clearOauthCookie(c: Context): void {
  deleteCookie(c, OAUTH_COOKIE, { path: "/", secure: true, sameSite: "Lax" });
}

/** Logout clears both halves. The CSRF cookie alone is useless, but leaving it is untidy. */
export function clearSessionCookies(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, sameSite: "Lax" });
  deleteCookie(c, CSRF_COOKIE, { path: "/", secure: true, sameSite: "Lax" });
}

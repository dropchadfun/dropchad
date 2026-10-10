/**
 * The double submit token. `dc_csrf` is the one cookie the api leaves readable on purpose, so
 * the browser can echo it back in `x-dropchad-csrf`. `apps/api/src/auth/cookies.ts`.
 * The session cookie is httpOnly and is never touched here.
 */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = /(?:^|;\s*)dc_csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/**
 * The logo and `home` always land on plain `/` on `latest`, page 1 (
 * ). From another page the link does that by itself. Already on `/`, the link changes
 * nothing, so it sends this signal and the front page goes back to `latest`, page 1.
 */
export const HOME_EVENT = "dropchad:home";

/** On a tap of the logo or `home`: signal the front page when already on it. */
export function homeTap(pathname: string, target: EventTarget = window): void {
  if (pathname === "/") target.dispatchEvent(new Event(HOME_EVENT));
}

/**
 * The dev only switch `/create?handleMode=on` with.
 *
 * On a laptop handle mode is off (no V2 contracts in the registry, no binder key), so `drop` is
 * greyed and its screens cannot be seen. With this switch, in local development only, `drop`
 * can be picked and the lookup on `next` answers with sample names from this file, so step 2
 * and its "who gets it" list can be checked by eye.
 *
 * Three walls keep it out of anything real:
 * - `nodeEnv` must be `development`. The page passes `process.env.NODE_ENV`, which Next writes
 *   in as a constant at build time, `production` in every production build.
 * - the host must be the laptop itself, never the live site or a phone on the wifi.
 * - in preview a drop is never sent, `submitAllowed`; the sample names never leave the browser.
 */
import type { CreateMode, HandlePreview } from "@/components/create/form";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function devPreviewEnabled(
  search: string,
  env: { readonly nodeEnv: string | undefined; readonly hostname: string | undefined },
): boolean {
  if (env.nodeEnv !== "development") return false;
  if (env.hostname === undefined || !LOCAL_HOSTS.has(env.hostname)) return false;
  return new URLSearchParams(search).get("handleMode") === "on";
}

/**
 * The lookup's answer, made up here, never from the api. Every handle is found with the name
 * `sample <handle>` and no picture, so the avatar is the first letter and nothing is fetched;
 * a handle starting with `ghost` is missing, to show the miss line.
 */
export function samplePreview(handles: readonly string[], forText: string): HandlePreview {
  const missing = handles.filter((handle) => handle.toLowerCase().startsWith("ghost"));
  const found = handles
    .filter((handle) => !handle.toLowerCase().startsWith("ghost"))
    .map((handle, i) => ({
      handle,
      xUserId: `sample-${String(i)}`,
      displayName: `sample ${handle}`,
      profileImageUrl: null,
    }));
  return { forText, found, missing };
}

/** A drop from the preview would carry sample handles to the api: never. */
export function submitAllowed(args: {
  readonly devPreview: boolean;
  readonly mode: CreateMode;
}): boolean {
  return !(args.devPreview && args.mode === "drop");
}

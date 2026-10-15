/**
 * The launchpads a token drop can show as `launched on <name>`. A list,
 * a later one (bonk, raydium launchlab, Pons, stonkfun) is one entry here plus
 * its own on chain check in the api, which sets the token's `launchpad` to the same `id`. Each
 * entry has its own switch. **None is on**: pump.fun stays in the
 * list, turned off, so no drop shows a badge. An id that is not here, or is off, shows nothing.
 */
export interface Launchpad {
  /** What the api's token says in `launchpad`. */
  readonly id: string;
  /** The words on the badge. */
  readonly name: string;
  /**
   * The official logo as given, byte for byte, in `public/launchpads/`; `null`
   * until the file is in the repo, and the badge is words only.
   */
  readonly logo: string | null;
  /** Shown only when on. */
  readonly on: boolean;
}

export const LAUNCHPADS: readonly Launchpad[] = [
  { id: "pump.fun", name: "pump.fun", logo: null, on: false },
];

/** The launchpad with this id that is turned on, or `undefined`. `list` is for tests. */
export function launchpadOf(
  id: string | null | undefined,
  list: readonly Launchpad[] = LAUNCHPADS,
): Launchpad | undefined {
  if (id === null || id === undefined) return undefined;
  return list.find((pad) => pad.id === id && pad.on);
}

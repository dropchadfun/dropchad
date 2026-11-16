import type { ChainPill } from "@/lib/chains";

/** The words, by the chain's key. */
export function pausedText(key: string): string {
  return `new ${key} drops are paused. claims still work.`;
}

/**
 * The grey line under the `/create` pills for each pill the api lists with new drops off,
 * Nothing when no pill is paused.
 */
export function PausedLines({ pills }: { pills: readonly ChainPill[] }) {
  const paused = pills.filter((pill) => pill.paused === true);
  if (paused.length === 0) return null;
  return (
    <div className="type-small mt-2 text-chad-text-dim">
      {paused.map((pill) => (
        <p key={pill.key}>{pausedText(pill.key)}</p>
      ))}
    </div>
  );
}

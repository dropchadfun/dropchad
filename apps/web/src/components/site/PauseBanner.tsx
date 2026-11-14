/**
 * The pause banner: one calm line on
 * top of every page while new drops are off on a chain. Claims still work, so never mint, never
 * red, no close button. The text comes from `readPauseText` in the root layout.
 */
export function PauseBanner({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <div role="status" className="border-b border-chad-border bg-chad-surface-2">
      <p className="type-small mx-auto w-full max-w-(--container-content) px-4 py-2 text-center whitespace-pre-line text-chad-text">
        {text}
      </p>
    </div>
  );
}

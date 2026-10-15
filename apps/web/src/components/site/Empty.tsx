/** Nothing here yet. Plain words, one sentence. Never an error colour. */
export function Empty({ children }: { children: string }) {
  return (
    <p className="type-body rounded-xl border border-dashed border-chad-border px-4 py-6 text-center text-chad-text-dim">
      {children}
    </p>
  );
}

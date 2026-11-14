/** A loading block. It pulses until real data lands, static under reduced motion. */
export function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** The shape of one drop card while it loads. Same size as the real one, so nothing jumps. */
export function CardSkeleton() {
  return (
    <div className="card p-4 md:p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-xl md:size-12" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One board row while it loads. */
export function RowSkeleton() {
  return (
    <div className="row flex min-h-12 items-center gap-3 px-2 py-1.5 md:px-3">
      <Skeleton className="h-4 w-5" />
      <Skeleton className="size-8 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-5 w-20" />
    </div>
  );
}

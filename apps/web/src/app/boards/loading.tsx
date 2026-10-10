import { RowSkeleton, Skeleton } from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <>
      <div className="border-b border-chad-border md:hidden">
        <div className="flex h-12 items-center gap-1 px-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="size-7 rounded-lg" />
          ))}
        </div>
      </div>
      <main className="mx-auto w-full max-w-(--container-content) px-4 md:grid md:grid-cols-[44px_minmax(0,1fr)] md:gap-6">
        <aside className="hidden md:block">
          <div className="flex flex-col gap-1 pt-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="size-11 rounded-lg" />
            ))}
          </div>
        </aside>
        <div className="min-w-0 pt-4 md:pt-6">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Skeleton className="h-9 w-40 rounded-lg" />
            <Skeleton className="h-9 w-64 max-w-full rounded-lg" />
          </div>
          <div className="mt-4">
            {Array.from({ length: 7 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

import { RowSkeleton, Skeleton } from "@/components/site/Skeleton";

/** The front page while the server fetches. Same blocks, same order, nothing jumps. */
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
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="card p-3 md:p-4">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="mt-2 h-6 w-16 md:h-7 md:w-24" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-11 w-full md:mt-6 md:w-32" />
          {Array.from({ length: 3 }, (_, i) => (
            <section key={i} className="mt-6 md:mt-8">
              <Skeleton className="mb-2 h-5 w-32" />
              <div className="flex flex-col gap-2 md:gap-0">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

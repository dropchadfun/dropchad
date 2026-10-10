import { RowSkeleton, Skeleton } from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-(--container-content) px-4 pt-4 md:pt-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 md:gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="card p-3 md:p-4">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="mt-2 h-6 w-16 md:h-7 md:w-24" />
          </div>
        ))}
      </div>
      <section className="mt-6 md:mt-8">
        <Skeleton className="mb-2 h-5 w-16" />
        <RowSkeleton />
        <RowSkeleton />
      </section>
    </main>
  );
}

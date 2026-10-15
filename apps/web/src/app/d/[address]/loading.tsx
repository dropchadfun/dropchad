import { Skeleton } from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-(--container-content) px-4 py-4 md:py-8">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <div className="mt-4 md:grid md:grid-cols-[1fr_320px] md:gap-6">
        <div>
          <Skeleton className="aspect-[1/0.62] max-h-[420px] w-full rounded-xl" />
          <div className="mt-4 flex items-end justify-between">
            <Skeleton className="h-12 w-28" />
            <Skeleton className="h-8 w-32" />
          </div>
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
        </div>
        <div className="mt-6 space-y-2 md:mt-0">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      </div>
    </main>
  );
}

import { POWERED_BY_GIPHY_SRC, POWERED_BY_GIPHY_WIDTH } from "@/lib/giphy";
import { cn } from "@/lib/utils";

/**
 * GIPHY's own "Powered By GIPHY" mark, unchanged: centred on its
 * own line, 120px wide, the height from the file. Under the drop GIF and under the picker grid.
 */
export function PoweredByGiphy({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- GIPHY's own mark, as it is
    <img
      src={POWERED_BY_GIPHY_SRC}
      alt="Powered By GIPHY"
      width={POWERED_BY_GIPHY_WIDTH}
      className={cn("mx-auto block h-auto", className)}
    />
  );
}

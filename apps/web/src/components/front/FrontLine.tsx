import Link from "next/link";

import {
  FRONT_LINE_FIRST,
  FRONT_LINE_MULTISEND,
  FRONT_LINE_REST,
} from "@/components/front/front-line";

/**
 * The line under `make a drop`: all one step over body, the `h2` size,
 * normal weight, wrapped `pretty` in a wide box so no word is left alone on the last line. The
 * first sentence white in Space Grotesk; the rest soft grey, Inter, ending with a quiet
 * `multisend` link to `/create?mode=multisend`. Nothing in it moves. X is always a capital here.
 */
export function FrontLine() {
  return (
    <p className="type-h2 front-line mt-3 text-pretty md:max-w-3xl lg:mt-0 lg:max-w-none">
      <span className="font-title text-chad-text">{FRONT_LINE_FIRST}</span>{" "}
      <span className="text-chad-text-dim">
        {FRONT_LINE_REST} {FRONT_LINE_MULTISEND}{" "}
        <Link
          className="underline decoration-chad-text-mute underline-offset-2 hover:text-chad-text"
          href="/create?mode=multisend"
        >
          multisend
        </Link>
        .
      </span>
    </p>
  );
}

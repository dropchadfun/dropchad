"use client";

import { useEffect, useRef, useState } from "react";

import type { TokenInfo } from "@/lib/api";
import { logoFailedEarly, tokenLetter } from "@/lib/token";

/**
 * A token's logo. Always from our own route: the browser
 * never loads a stranger's link. The route answers `404 no_logo` when the token has none; then,
 * like `Avatar`, the first letter on a round grey tile. Round, the same size either way. A 404
 * that came back before the page was ready is caught after mount too, `logoFailedEarly`.
 */
export function TokenLogo({
  token,
  size,
  className = "",
}: {
  token: TokenInfo;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // The server rendered `<img>` may have failed before `onError` was attached.
    if (image.current !== null && logoFailedEarly(image.current)) setFailed(true);
  }, []);
  const style = { width: size, height: size };
  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- our own route, bytes vary per mint
      <img
        ref={image}
        src={token.logoUrl}
        alt=""
        width={size}
        height={size}
        style={style}
        onError={() => setFailed(true)}
        className={`inline-block shrink-0 rounded-full bg-chad-surface-2 object-cover align-middle ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.55)) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-chad-surface-2 align-middle leading-none font-medium text-chad-text-dim ${className}`}
    >
      {tokenLetter(token)}
    </span>
  );
}

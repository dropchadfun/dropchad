"use client";

import { useEffect, useRef, useState, type Ref } from "react";

/**
 * A chad's face. The X profile image when there is one, the first letter of the handle when
 * there is not, or when the image fails to load. Round. A plain
 * `img`: the host is X's CDN and changes per user, which `next/image` would want listed one by one.
 *
 * A picture can fail before React hydrates, when `onError` has not run yet, so on mount the image
 * is checked once with `imageBroken`.
 */
export function Avatar({
  src,
  name,
  size = 40,
  className = "",
}: {
  src: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  // The url that failed, so a new `src` gets its own try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (src && image.current && imageBroken(image.current)) setFailedSrc(src);
  }, [src]);

  return (
    <AvatarFace
      src={src}
      name={name}
      size={size}
      className={className}
      failed={src !== null && failedSrc === src}
      onFail={() => {
        setFailedSrc(src);
      }}
      imageRef={image}
    />
  );
}

/** The markup with the state passed in: the picture, or the letter when there is none or it failed. */
export function AvatarFace({
  src,
  name,
  size,
  className = "",
  failed,
  onFail,
  imageRef,
}: {
  src: string | null;
  name: string;
  size: number;
  className?: string;
  failed: boolean;
  onFail: () => void;
  imageRef?: Ref<HTMLImageElement>;
}) {
  const style = { width: size, height: size };
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote host varies per user
      <img
        ref={imageRef}
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        onError={onFail}
        className={`shrink-0 rounded-full bg-chad-surface-2 object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`type-body inline-flex shrink-0 items-center justify-center rounded-full bg-chad-surface-2 font-medium text-chad-text-dim uppercase ${className}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** A finished image with no width failed to load; one still loading has not. */
export function imageBroken(image: { complete: boolean; naturalWidth: number }): boolean {
  return image.complete && image.naturalWidth === 0;
}

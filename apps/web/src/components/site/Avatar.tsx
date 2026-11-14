"use client";

import { useEffect, useRef, useState, type Ref } from "react";

import { xPictureAt } from "@/lib/picture";

/**
 * A chad's face. The X profile image when there is one, the first letter of the handle when
 * there is not, or when the image fails to load. Round. A plain
 * `img`: the host is X's CDN and changes per user, which `next/image` would want listed one by one.
 *
 * A picture can fail before React hydrates, when `onError` has not run yet, so after each render
 * the image is checked with `imageBroken`. From 48px up it draws X's `_400x400` file, `xPictureAt`,
 * and when that fails the stored link. No referrer: X refuses ours.
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
  // The urls that failed, so each gets one try and a new `src` gets its own.
  const [failed, setFailed] = useState<readonly string[]>([]);
  const shown = nextPicture(pictureTries(src, size), failed);
  const image = useRef<HTMLImageElement>(null);
  const fail = () => {
    if (shown !== null)
      setFailed((before) => (before.includes(shown) ? before : [...before, shown]));
  };

  useEffect(() => {
    if (shown && image.current && imageBroken(image.current)) fail();
  });

  return (
    <AvatarFace
      key={shown}
      src={shown}
      name={name}
      size={size}
      className={className}
      failed={false}
      onFail={fail}
      imageRef={image}
    />
  );
}

/** The links to try, in order: the `_400x400` file from 48px up, then the stored link. */
export function pictureTries(src: string | null, size: number): string[] {
  if (src === null) return [];
  const big = xPictureAt(src, size);
  return big === null || big === src ? [src] : [big, src];
}

/** The first link that has not failed; `null` when every one has, so the letter shows. */
export function nextPicture(tries: readonly string[], failed: readonly string[]): string | null {
  return tries.find((url) => !failed.includes(url)) ?? null;
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
        referrerPolicy="no-referrer"
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

"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";

import { ChainBadge } from "@/components/chains/ChainBadge";
import { LaunchpadBadge } from "@/components/drops/LaunchpadBadge";
import {
  cardHref,
  chadLines,
  coinLines,
  newestCoinLines,
  dropLines,
  swipeStep,
  tickerText,
  turnReducer,
  TURN_MS,
  type TrendingKind,
  type TrendingLines,
} from "@/components/front/trending-lines";
import { Avatar } from "@/components/site/Avatar";
import { SocialMark } from "@/components/site/SocialIcons";
import { StreamLinks } from "@/components/site/StreamLinks";
import { Ticker } from "@/components/site/Ticker";
import { TokenLogo } from "@/components/site/TokenLogo";
import { XLink } from "@/components/site/XLink";
import {
  ApiError,
  getTrending,
  type Profile,
  type Trending,
  type TrendingChad,
  type TrendingCoin,
  type TrendingDrop,
} from "@/lib/api";
import { chainIdForKey } from "@/lib/chains";
import { DEXSCREENER_ICON_PX, DEXSCREENER_LOGO, dexscreenerUrl } from "@/lib/dexscreener";
import { NO_TICKER } from "@/lib/token";
import { cn } from "@/lib/utils";

/**
 * The trending block: chad of the day, top coin and
 * just dropped, three cards in one row on phone and desktop. Each card is one link: its name or
 * ticker is stretched over the card with `after:absolute`, and the X, stream and Dexscreener
 * links and the dots sit above it (`relative z-10`), so there is never a link or a button inside
 * a link, as on the board rows. Desktop is the compact row, the phone the centred column, no tag
 * pill on either. Each card turns through its top 3 every 8 seconds
 * mouse over, focus or a hidden tab stops it; a dot tap (desktop) or a swipe (phone) turns it
 * and starts its 8 seconds again. The server page hands in `chain=all`; any other rail choice
 * reads again, the old cards kept while the new ones load.
 */
export function TrendingBlock({ initial, chain }: { initial: Trending | null; chain: string }) {
  // The last answer read for a rail choice; until the next one lands, the old cards stay.
  const [fetched, setFetched] = useState<{ readonly data: Trending | null } | null>(null);

  useEffect(() => {
    if (chain === "all") return;
    let current = true;
    getTrending(chain)
      .then((next) => {
        if (current) setFetched({ data: next });
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
        if (current) setFetched({ data: null });
      });
    return () => {
      current = false;
    };
  }, [chain]);

  const data = chain === "all" || fetched === null ? initial : fetched.data;

  if (data === null || !data.available) {
    return (
      <section aria-label="trending" className="mt-6">
        <p className="type-small text-chad-text-dim">trending cannot load right now.</p>
      </section>
    );
  }
  return (
    <section aria-label="trending" className="mt-6 grid grid-cols-3 gap-2 md:gap-[10px]">
      <TurningCard
        kind="chad"
        label="chad of the day"
        empty="no SOL or ETH drops today."
        card={data.chad}
        face={chadFace}
      />
      <TurningCard
        kind="coin"
        label="top coin"
        empty="no coin drops today."
        {...coinCard(data.coin)}
      />
      <TurningCard
        kind="drop"
        label="just dropped"
        empty="no drops yet."
        card={data.drop}
        face={dropFace}
      />
    </section>
  );
}

/** What one item shows, on the phone and on desktop. */
interface Face {
  readonly chainKey: string;
  /** The picture at a size, round; the ring is the wrapper's. */
  readonly picture: (size: number) => ReactNode;
  /** The phone's text above the lines, with the card's link. */
  readonly phoneTop: ReactNode;
  /** Desktop: the name or the ticker, the card's link. */
  readonly href: string;
  readonly name: string;
  /** The icons, the profile page's size, on the phone and on desktop. */
  readonly icons: ReactNode;
  readonly lines: TrendingLines;
}

function TurningCard<T>({
  kind,
  label,
  empty,
  card,
  face,
}: {
  kind: TrendingKind;
  label: string;
  /** The grey line when the card has no items. */
  empty: string;
  card: { readonly items: readonly T[] };
  face: (item: T) => Face;
}) {
  // `turned`: no flip on the first paint, only on a turn. `epoch`: a tap or a swipe restarts it.
  const [turn, dispatch] = useReducer(turnReducer, { index: 0, turned: false, epoch: 0 });
  const [held, setHeld] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const count = card.items.length;
  const shown = turn.index < count ? turn.index : 0;

  useEffect(() => {
    if (count <= 1 || held) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      dispatch({ type: "tick", count });
    }, TURN_MS);
    return () => window.clearInterval(timer);
  }, [count, held, turn.epoch]);

  const item = card.items[shown];
  return (
    <div
      className="relative flex min-w-0 touch-pan-y flex-col items-center rounded-2xl border border-chad-border bg-chad-surface p-2.5 text-center md:items-stretch md:rounded-[14px] md:px-3.5 md:py-3 md:text-left"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onTouchStart={(event) => {
        const point = event.touches[0];
        touch.current = point === undefined ? null : { x: point.clientX, y: point.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        const point = event.changedTouches[0];
        touch.current = null;
        if (start === null || point === undefined) return;
        const by = swipeStep(point.clientX - start.x, point.clientY - start.y);
        if (by !== 0) dispatch({ type: "step", by, count });
      }}
    >
      {/* The label: centred on the phone, left on desktop with the dots right. */}
      <div className="flex w-full items-center justify-center gap-1 md:justify-between">
        <span className="truncate text-[9px] font-medium tracking-wide text-chad-text-dim uppercase md:text-[10px]">
          {label}
        </span>
        {count > 1 ? (
          <Dots count={count} active={shown} pick={(to) => dispatch({ type: "pick", to, count })} />
        ) : null}
      </div>
      {item === undefined ? (
        <p className="mt-3 w-full text-[10px] text-chad-text-dim md:text-[11px]">{empty}</p>
      ) : (
        <Item key={shown} kind={kind} face={face(item)} flip={turn.turned} />
      )}
    </div>
  );
}

/** Desktop only: one round 6px dot per item, 5 apart, each a real button above the card link. */
function Dots({
  count,
  active,
  pick,
}: {
  count: number;
  active: number;
  pick: (to: number) => void;
}) {
  return (
    <div data-trend-dots className="hidden shrink-0 items-center md:flex">
      {Array.from({ length: count }, (_, at) => (
        <button
          key={at}
          type="button"
          aria-label={`show ${String(at + 1)} of ${String(count)}`}
          aria-current={at === active ? "true" : undefined}
          data-trend-dot
          onClick={(event) => {
            pick(at);
            // A mouse tap lets go of the focus, so the 8 seconds really run again.
            if (event.detail > 0) event.currentTarget.blur();
          }}
          className="relative z-10 flex h-4 w-[11px] items-center justify-center"
        >
          <span
            className={cn(
              "block size-1.5 rounded-full",
              at === active ? "bg-chad-accent" : "bg-chad-text-mute",
            )}
          />
        </button>
      ))}
    </div>
  );
}

function Item({ kind, face, flip }: { kind: TrendingKind; face: Face; flip: boolean }) {
  const chainId = chainIdForKey(face.chainKey);
  const { lines } = face;
  const badge =
    chainId === null ? null : (
      <ChainBadge chainId={chainId} className="right-0 bottom-0 size-[18px]" />
    );
  return (
    <div className={cn("w-full min-w-0", flip && "trend-flip")}>
      {/* The phone: the centred column, as before, without the tag pill and the dots. */}
      <div className="flex w-full min-w-0 flex-col items-center md:hidden">
        <div
          className={cn(
            "trend-ring relative mt-2 size-[52px] shrink-0 rounded-full",
            `trend-ring-${kind}`,
          )}
        >
          {face.picture(52)}
          {badge}
        </div>
        <div className="mt-1.5 flex w-full min-w-0 flex-col items-center">{face.phoneTop}</div>
        {/* The mint line 5px lower: measured on the rendered page, the white space above it was
            about 5px less than above the second line. */}
        <div className="mt-1.5 flex w-full min-w-0 flex-col items-center gap-0.5">
          <BigLine lines={lines} className="justify-center text-[11px]" />
          <span className="max-w-full truncate text-[10px] leading-tight text-chad-text-dim">
            {lines.middle}
          </span>
          <span className="mt-[5px] max-w-full truncate text-[10px] leading-tight text-chad-accent">
            {lines.short}
          </span>
        </div>
      </div>

      {/* Desktop: the picture, then three rows in two columns, each pair on one line: the name
          and the big line, the handle and the grey line, the icons and the mint line.
          The right column takes at most half. */}
      <div className="mt-2.5 hidden w-full min-w-0 items-center gap-[10px] md:flex">
        <div
          className={cn(
            "trend-ring-compact relative size-14 shrink-0 rounded-full",
            `trend-ring-${kind}`,
          )}
        >
          {face.picture(56)}
          {badge}
        </div>
        <div
          data-trend-rows
          className="grid grid-cols-[minmax(0,1fr)_fit-content(50%)] min-w-0 flex-1 items-center gap-x-[10px]"
        >
          <CardLink
            href={face.href}
            text={face.name}
            full={kind === "coin"}
            className="text-[12px] font-semibold text-chad-text"
          />
          <BigLine lines={lines} className="justify-end justify-self-end text-[12px]" />
          <span className="min-w-0 truncate text-[11px] leading-tight text-chad-text-dim">
            {lines.handle}
          </span>
          <span className="min-w-0 truncate justify-self-end text-right text-[11px] leading-tight text-chad-text-dim">
            {lines.people}
          </span>
          <IconRow className="mt-1 min-w-0">{face.icons}</IconRow>
          <span className="mt-1 min-w-0 truncate justify-self-end text-right text-[11px] leading-tight text-chad-accent">
            {lines.accent}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The big line, one size with the name: the number whole, the unit after it cut with `…` when
 * long, so a long ticker never makes the card wider or wraps.
 */
function BigLine({ lines, className }: { lines: TrendingLines; className: string }) {
  return (
    <span
      data-trend-big
      className={cn(
        "flex max-w-full min-w-0 gap-[0.25em] leading-tight font-bold text-chad-text",
        className,
      )}
    >
      <span className="shrink-0">{lines.amount}</span>
      {lines.unit === "" ? null : <Ticker symbol={lines.unit} edge />}
    </span>
  );
}

/**
 * The profile page's X, Kick and Twitch about 15 percent smaller, each in its 44px target,
 * Dexscreener keeps its size.
 */
const X_MARK = "size-[18px]";
const STREAM_BOXES = { kick: 13, twitch: 21 } as const;

/**
 * The name or the ticker as the card's one link, stretched over the whole card. `full`: the
 * whole text as `title` and `aria-label`, for a ticker cut with `…`.
 */
function CardLink({
  href,
  text,
  className,
  full = false,
}: {
  href: string;
  text: string;
  className: string;
  full?: boolean;
}) {
  return (
    <Link
      href={href}
      title={full ? text : undefined}
      aria-label={full ? text : undefined}
      className={cn(
        "w-full truncate leading-tight after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-chad-accent md:after:rounded-[14px]",
        className,
      )}
    >
      {text}
    </Link>
  );
}

/** The X picture, the letter when it fails; `_400x400` from 48px, `Avatar`. */
function personPicture(profile: Profile): (size: number) => ReactNode {
  return function personPictureAt(size) {
    return (
      <Avatar
        src={profile.profileImageUrl}
        name={profile.handle}
        size={size}
        className="text-[18px]!"
      />
    );
  };
}

/** The phone: name, `@handle`, the icons on the line under them. No tag pill. */
function personTop(profile: Profile, href: string, icons: ReactNode): ReactNode {
  return (
    <>
      <CardLink
        href={href}
        text={profile.displayName}
        className="text-[11px] font-semibold text-chad-text"
      />
      <span className="w-full truncate text-[10px] leading-tight text-chad-text-dim">
        {`@${profile.handle}`}
      </span>
      <IconRow className="mt-1 justify-center">{icons}</IconRow>
    </>
  );
}

/**
 * The icons as on the profile page: X 21px, Kick 15px, Twitch 25px, each
 * in its 44px target, 8 apart, in one row, above the card link.
 */
function IconRow({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      data-trend-icons
      className={cn("relative z-10 flex h-6 flex-nowrap items-center gap-2", className)}
    >
      {children}
    </span>
  );
}

/** X, then Kick and Twitch when connected: the profile page's own links. */
function personIcons(profile: Profile): ReactNode {
  return (
    <>
      <XLink handle={profile.handle} markClass={X_MARK} />
      <StreamLinks streams={profile.streams} boxes={STREAM_BOXES} />
    </>
  );
}

function chadFace(item: TrendingChad): Face {
  const href = cardHref("chad", item);
  return {
    chainKey: item.chainKey,
    picture: personPicture(item.profile),
    phoneTop: personTop(item.profile, href, personIcons(item.profile)),
    href,
    name: item.profile.displayName,
    icons: personIcons(item.profile),
    lines: chadLines(item),
  };
}

/**
 * The coin's X link (Solana only), as big as `XLink`, and Dexscreener always, sized to look as
 * big as the X: a link on mainnet, else dimmed.
 */
function coinIcons(item: TrendingCoin, ticker: string): ReactNode {
  const chainId = chainIdForKey(item.chainKey) ?? 0;
  // A link on mainnet, never for a stablecoin; else the icon dimmed.
  const chart = dexscreenerUrl(chainId, item.token.mint);
  const box = "-m-3.5 size-11";
  const xUrl = item.token.xUrl;
  return (
    <>
      {xUrl === undefined || xUrl === null ? null : (
        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${ticker} on X`}
          className={cn(
            "inline-flex shrink-0 items-center justify-center text-chad-text-dim transition-colors hover:text-chad-accent",
            box,
          )}
        >
          <SocialMark mark="x" className={X_MARK} />
        </a>
      )}
      {chart === null ? (
        <span
          data-dexscreener="off"
          aria-hidden="true"
          className={cn("inline-flex shrink-0 items-center justify-center opacity-40", box)}
        >
          <DexscreenerMark />
        </span>
      ) : (
        <a
          data-dexscreener="on"
          href={chart}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${ticker} on dexscreener`}
          className={cn("inline-flex shrink-0 items-center justify-center", box)}
        >
          <DexscreenerMark />
        </a>
      )}
    </>
  );
}

/**
 * The top coin card: its items, or with none the newest coin drop as its one item.
 */
function coinCard(coin: Trending["coin"]): {
  card: { readonly items: readonly TrendingCoin[] };
  face: (item: TrendingCoin) => Face;
} {
  const newest = coin.newest;
  if (coin.items.length > 0 || newest === undefined || newest === null) {
    return { card: coin, face: coinFace };
  }
  return {
    card: { items: [newest] },
    face: (item) => ({ ...coinFace(item), lines: newestCoinLines(newest) }),
  };
}

function coinFace(item: TrendingCoin): Face {
  const chainId = chainIdForKey(item.chainKey) ?? 0;
  const ticker = item.token.symbol ?? NO_TICKER;
  // The name spot: `$BONK`, the full text in `title` and `aria-label`.
  const name = tickerText(item.token.symbol);
  const href = cardHref("coin", item);
  return {
    chainKey: item.chainKey,
    picture: (size) => <TokenLogo token={item.token} size={size} />,
    phoneTop: (
      <>
        <CardLink
          href={href}
          text={name}
          full
          className="text-[11px] font-semibold text-chad-text"
        />
        {item.token.name === null ? null : (
          <span className="w-full truncate text-[10px] leading-tight text-chad-text-dim">
            {item.token.name}
          </span>
        )}
        <span className="relative z-10 mt-1 flex max-w-full justify-center empty:hidden">
          <LaunchpadBadge token={item.token} chainId={chainId} compact />
        </span>
        <IconRow className="mt-1 justify-center">{coinIcons(item, ticker)}</IconRow>
      </>
    ),
    href,
    name,
    icons: coinIcons(item, ticker),
    lines: coinLines(item),
  };
}

/** The Dexscreener logo file, byte for byte. */
function DexscreenerMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local file, fixed size
    <img src={DEXSCREENER_LOGO} alt="" width={DEXSCREENER_ICON_PX} height={DEXSCREENER_ICON_PX} />
  );
}

function dropFace(item: TrendingDrop): Face {
  const href = cardHref("drop", item);
  return {
    chainKey: item.chainKey,
    picture: personPicture(item.sender),
    // The sender's X, Kick and Twitch, as on chad of the day.
    phoneTop: personTop(item.sender, href, personIcons(item.sender)),
    href,
    name: item.sender.displayName,
    icons: personIcons(item.sender),
    lines: dropLines(item),
  };
}

/**
 * The share card, the logic only. No React and no canvas
 * here: `ShareCard.tsx` draws it. The api sends the facts; the text is built here.
 */
import type { TokenInfo } from "@/lib/api";
import { chainPills } from "@/lib/chains";
import { exactAmount, formatAmount } from "@/lib/format";
import { tickerShow, tokenLetter } from "@/lib/token";

/** `GET /api/drops/:address/share`. */
export interface ShareCardPerson {
  readonly handle: string;
  readonly profileImageUrl: string | null;
}

export interface ShareCardData {
  readonly chainKey: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Base units: what was dropped, never what was claimed. */
  readonly amount: string;
  /** Every person in the drop. */
  readonly people: number;
  readonly sender: ShareCardPerson;
  /** Every receiver, biggest share first, ties by list order; pictures on the first 3 only. */
  readonly receivers: readonly ShareCardPerson[];
  readonly rest: number;
  /** The stamp on the fun design; the usd number itself never reaches the browser. */
  readonly rank: "chad" | "gigachad" | "whale" | null;
  /**
   * A token drop's token; `null` on a SOL or ETH drop, absent from an older api.
   * `symbol` and `decimals` above are already the token's.
   */
  readonly token?: TokenInfo | null;
}

/** The api's states in which a drop is funded and live. */
const LIVE_STATES = new Set(["active", "paying", "finished", "claims_expired"]);

/** The card and its buttons: the sender of a live handle drop, nobody else, never a multisend. */
export function showShareCard(drop: {
  readonly mode: string;
  readonly yours: boolean;
  readonly state: string;
}): boolean {
  return drop.mode === "handle" && drop.yours && LIVE_STATES.has(drop.state);
}

/** At most 3 names in the post. */
const MENTIONS = 1;

function people(count: number): string {
  return count === 1 ? "1 person" : `${String(count)} people`;
}

/**
 * The unit on the card: the coin, the token's ticker, or `tokens` when it has none, even from an
 * api that still sends the short mint.
 */
export function cardSymbol(card: ShareCardData): string {
  const token = card.token ?? null;
  if (token === null) return card.symbol;
  return token.symbol ?? "tokens";
}

/** `0.5 SOL`, exact like `send this amount`: every decimal, no comma. A token's ticker as `$TEST`. */
export function cardAmount(card: ShareCardData): string {
  const ticker = card.token?.symbol ?? null;
  const unit = ticker === null ? cardSymbol(card) : `$${ticker}`;
  return `${exactAmount(card.amount, card.decimals)} ${unit}`;
}

/**
 * The ready post: `sent 0.5 SOL to @a and 11 more on dropchad. sign in with X to claim, no wallet
 * needed.`. At most 1 mention, the
 * biggest receiver, no link, never starting with an `@`, always under 280. The sender can edit it
 * before it goes out.
 */
export function postText(card: ShareCardData): string {
  const named = card.receivers.slice(0, MENTIONS);
  const more = card.people - named.length;
  const whom =
    named.length === 0
      ? people(card.people)
      : `${named.map((person) => `@${person.handle}`).join(" ")}${more > 0 ? ` and ${String(more)} more` : ""}`;
  return `sent ${cardAmount(card)} to ${whom} on dropchad. sign in with X to claim, no wallet needed.`;
}

/** X's post page with the text only. No `url` parameter: the post carries no link. */
export function postIntentUrl(text: string): string {
  return `https://x.com/intent/post?${new URLSearchParams({ text }).toString()}`;
}

export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 900;

export type CardDesignId = "clean" | "center" | "fun";

/** Three designs, all with the green bar and the names. */
export const CARD_DESIGNS: readonly { readonly id: CardDesignId; readonly label: string }[] = [
  { id: "clean", label: "clean" },
  { id: "center", label: "center" },
  { id: "fun", label: "fun" },
];

/**
 * `sent to 12 chads on Solana`, never `airdropped` or `dropped on` (
 * ). A no-break space so
 * the number and the word never split; the chain's short name when it is known.
 */
export function chadsLine(count: number, chain: string | null): string {
  const chads = `sent to ${String(count)}\u00a0${count === 1 ? "chad" : "chads"}`;
  return chain === null ? chads : `${chads} on ${chain}`;
}

/** The small line at the bottom of every card, under the names. */
export const CARD_CLAIM_LINE = "claim with X, no wallet connection needed";

/**
 * The chain behind the drop, for the bar's logo and the line under it: its pill key (the tile
 * colour is `--brand-<key>`), its short name without "Chain", and its brand kit mark. A
 * Robinhood drop shows the Robinhood mark, never the Ethereum one.
 */
export function cardChain(
  chainKey: string,
): { readonly key: string; readonly name: string; readonly logo: string } | null {
  const pill = chainPills().find((p) => p.chainKey === chainKey);
  if (pill === undefined) return null;
  return { key: pill.key, name: pill.name.replace(/ Chain$/, ""), logo: pill.logo };
}

/**
 * The card's amount, short and readable: `25.12 SOL`, never every decimal. A small amount keeps
 * digits until the first one that is not 0, so it never reads 0. The post keeps the exact one.
 */
export function cardShortAmount(card: ShareCardData): string {
  return `${formatAmount(card.amount, card.decimals, 2)} ${cardSymbol(card)}`;
}

const RANK_LABELS = { chad: "chad drop", gigachad: "gigachad drop", whale: "whale drop" } as const;

/** The rank word, kept for a later design; no card draws it now. `null` without a price. */
export function rankLabel(rank: ShareCardData["rank"]): string | null {
  return rank === null ? null : RANK_LABELS[rank];
}

/** Up to this many receivers the names are a readable list; above it, a name wall. */
export const NAME_LIST_MAX = 30;

export function nameMode(count: number): "none" | "list" | "wall" {
  if (count === 0) return "none";
  return count <= NAME_LIST_MAX ? "list" : "wall";
}

/** Two spaces between names on a line. */
export const NAME_GAP = "  ";
/** Line height as a share of the font size. */
export const NAME_LINE_HEIGHT = 1.35;

/**
 * The biggest font size, from `max` down to `min`, at which every name fits `box`, flowed into
 * lines. Never drops a name: at `min` it returns every line with `fits: false`, and the caller
 * draws them all anyway. `measure` is the canvas's width at a size, a stub in the tests.
 */
export function fitNames(
  names: readonly string[],
  box: { readonly width: number; readonly height: number },
  measure: (text: string, px: number) => number,
  size: { readonly max: number; readonly min: number },
): { px: number; lines: string[][]; fits: boolean } {
  let last: string[][] = [];
  for (let px = size.max; px >= size.min; px -= 1) {
    const lines: string[][] = [];
    let line: string[] = [];
    for (const name of names) {
      const next = [...line, name];
      if (line.length > 0 && measure(next.join(NAME_GAP), px) > box.width) {
        lines.push(line);
        line = [name];
      } else {
        line = next;
      }
    }
    if (line.length > 0) lines.push(line);
    last = lines;
    if (lines.length * px * NAME_LINE_HEIGHT <= box.height) return { px, lines, fits: true };
  }
  return { px: size.min, lines: last, fits: false };
}

/**
 * The amount's sizes in the bar, biggest first. 96 is the size on the fun design with 500
 * receivers: the bar is never bigger than that, smaller only to fit.
 */
export const CARD_AMOUNT_SIZES = [96, 80, 64] as const;

/** The biggest size at which the amount and coin fit `maxWidth`; the smallest when none does. */
export function cardAmountSize(
  text: string,
  maxWidth: number,
  measure: (text: string, px: number) => number,
): number {
  for (const px of CARD_AMOUNT_SIZES) if (measure(text, px) <= maxWidth) return px;
  return CARD_AMOUNT_SIZES.at(-1) ?? 64;
}

/** The fun design's pictures. `chad` is the default. */
export type FunArtId = "chad" | "laugh" | "bowl";

/**
 * Each picture, and how far right the card's text may reach on it: 32px clear of where the
 * man's hand, arm or face starts in the rows the text uses, measured on the files
 * (chad 767, laugh 742, bowl 808, card x at 1600 wide). `test/share-card-art.test.tsx` pins it.
 */
export const FUN_ARTS: readonly {
  readonly id: FunArtId;
  readonly label: string;
  readonly src: string;
  readonly textRight: number;
}[] = [
  { id: "chad", label: "chad", src: "/share/bg-chad.png", textRight: 735 },
  { id: "laugh", label: "laugh", src: "/share/bg-laugh.png", textRight: 710 },
  { id: "bowl", label: "bowl", src: "/share/bg-bowl.png", textRight: 776 },
];

export const DEFAULT_FUN_ART: FunArtId = "chad";

/** The left margin of the card's text, `PAD` in the drawing. */
const TEXT_LEFT = 80;

/**
 * Where the text may go on the fun design with picture `art`; `null` is the clean and center
 * designs, which keep the whole card. The names list, the name wall, the green bar, the
 * `sent to` line and the wall's dark panel all end at `right` or before.
 */
export function funTextBoxes(art: FunArtId | null): {
  right: number;
  list: { x: number; width: number };
  wall: { x: number; width: number };
  barMax: number;
  lineMax: number;
  panelRight: number;
} {
  const right =
    art === null ? CARD_WIDTH : (FUN_ARTS.find((a) => a.id === art)?.textRight ?? CARD_WIDTH);
  return {
    right,
    list: { x: TEXT_LEFT, width: Math.min(680, right - TEXT_LEFT) },
    wall: { x: 40, width: right - 40 },
    barMax: right - TEXT_LEFT,
    lineMax: right - TEXT_LEFT,
    panelRight: right,
  };
}

/** The biggest size from `max` down to `min` at which `text` fits `maxWidth`; `min` when none does. */
export function fitTextPx(
  text: string,
  maxWidth: number,
  measure: (text: string, px: number) => number,
  size: { readonly max: number; readonly min: number },
): number {
  for (let px = size.max; px > size.min; px -= 1) if (measure(text, px) <= maxWidth) return px;
  return size.min;
}

/**
 * Where the sender's picture sits: `dx` and `dy` move its
 * middle away from the card's middle, in card pixels; `zoom` 1x fills the card, up to 3x.
 */
export interface PicturePlace {
  readonly dx: number;
  readonly dy: number;
  readonly zoom: number;
}

export const PICTURE_ZOOM_MIN = 1;
export const PICTURE_ZOOM_MAX = 3;
/** In the middle at 1x: where a new picture starts and where `reset` puts it. */
export const PICTURE_START: PicturePlace = { dx: 0, dy: 0, zoom: 1 };

interface Size {
  readonly w: number;
  readonly h: number;
}

/** `value` held inside `-room..room`; `+ 0` so a clamp never gives `-0`. */
const within = (value: number, room: number) => Math.min(room, Math.max(-room, value)) + 0;

/** The picture's size on the card at `zoom`: it fills the card at 1x, never stretched. */
function drawnSize(image: Size, zoom: number): Size {
  const scale = Math.max(CARD_WIDTH / image.w, CARD_HEIGHT / image.h) * zoom;
  return { w: image.w * scale, h: image.h * scale };
}

/** `place` with the zoom in 1x..3x and the picture pulled back so no edge of the card is empty. */
function clampPlace(image: Size, place: PicturePlace): PicturePlace {
  const zoom = Math.min(PICTURE_ZOOM_MAX, Math.max(PICTURE_ZOOM_MIN, place.zoom));
  const size = drawnSize(image, zoom);
  return {
    dx: within(place.dx, (size.w - CARD_WIDTH) / 2),
    dy: within(place.dy, (size.h - CARD_HEIGHT) / 2),
    zoom,
  };
}

/** Where the picture is drawn on the card: always covering all of it. */
export function pictureRect(
  image: Size,
  place: PicturePlace,
): { x: number; y: number; w: number; h: number } {
  const p = clampPlace(image, place);
  const size = drawnSize(image, p.zoom);
  return {
    x: (CARD_WIDTH - size.w) / 2 + p.dx,
    y: (CARD_HEIGHT - size.h) / 2 + p.dy,
    w: size.w,
    h: size.h,
  };
}

/** A drag of `ddx`, `ddy` card pixels; it stops at the edge. */
export function movePicture(
  image: Size,
  place: PicturePlace,
  ddx: number,
  ddy: number,
): PicturePlace {
  return clampPlace(image, { ...place, dx: place.dx + ddx, dy: place.dy + ddy });
}

/** The `zoom` slider: the same middle, pulled back inside when it zooms out. */
export function zoomPicture(image: Size, place: PicturePlace, zoom: number): PicturePlace {
  return clampPlace(image, { ...place, zoom });
}

/** A move on the preview, in CSS pixels, as card pixels; `0` before the preview has a width. */
export function cardPixels(cssPixels: number, previewWidth: number): number {
  return previewWidth > 0 ? (cssPixels * CARD_WIDTH) / previewWidth : 0;
}

/**
 * The dark fade over the sender's picture. `clean` and `fun`: on the left, under the text,
 * darkest at the edge and gone before the right third, `[at, alpha]` along the width. `center`:
 * the text is in the middle, so the whole picture evenly darker. The fade up from the bottom
 * comes on top of both.
 */
export function pictureFade(
  design: CardDesignId,
):
  | { readonly kind: "left"; readonly stops: readonly (readonly [number, number])[] }
  | { readonly kind: "even"; readonly alpha: number } {
  if (design === "center") return { kind: "even", alpha: 0.62 };
  return {
    kind: "left",
    stops: [
      [0, 0.9],
      [0.35, 0.72],
      [0.55, 0.3],
      [0.65, 0],
    ],
  };
}

/** 10 MB. The picture is drawn in the browser and never uploaded; this only keeps it sane. */
const MAX_UPLOAD = 10 * 1024 * 1024;

/** Any image, a GIF too: the card draws a GIF's first frame. */
export function acceptUpload(file: { readonly type: string; readonly size: number }): boolean {
  return file.type.startsWith("image/") && file.size <= MAX_UPLOAD;
}

/**
 * `post on X`: the share sheet with the picture and the text when the phone can share a file.
 * Otherwise the PNG downloads and X opens with the text.
 */
export function sharePath(env: {
  readonly canShareFiles: boolean;
}): "share-sheet" | "download-and-intent" {
  return env.canShareFiles ? "share-sheet" : "download-and-intent";
}

/**
 * What sits before the amount in the mint bar. A SOL or ETH
 * drop: the chain's mark on its tile, as before. A token drop: the token's logo from our own
 * route, its first letter when there is none, and the chain's mark small on its corner.
 */
export type BarMark =
  | { readonly kind: "chain" }
  | {
      readonly kind: "token";
      readonly logoUrl: string;
      readonly letter: string;
      readonly chainBadge: true;
    };

export function barMark(card: ShareCardData): BarMark {
  const token = card.token ?? null;
  if (token === null) return { kind: "chain" };
  return { kind: "token", logoUrl: token.logoUrl, letter: tokenLetter(token), chainBadge: true };
}

/** The unit in the bar: the ticker cut and sized like the drop page. */
export function barSymbol(card: ShareCardData): { text: string; small: boolean } {
  const ticker = card.token?.symbol ?? null;
  return ticker === null ? { text: cardSymbol(card), small: false } : tickerShow(ticker);
}

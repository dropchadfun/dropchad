"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

import {
  CARD_DESIGNS,
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_FUN_ART,
  FUN_ARTS,
  NAME_GAP,
  NAME_LINE_HEIGHT,
  PICTURE_START,
  PICTURE_ZOOM_MAX,
  PICTURE_ZOOM_MIN,
  acceptUpload,
  barMark,
  cardAmountSize,
  cardChain,
  cardPixels,
  cardShortAmount,
  barSymbol,
  CARD_CLAIM_LINE,
  chadsLine,
  fitNames,
  fitTextPx,
  funTextBoxes,
  movePicture,
  nameMode,
  pictureFade,
  pictureRect,
  postIntentUrl,
  postText,
  sharePath,
  showShareCard,
  zoomPicture,
  type BarMark,
  type CardDesignId,
  type FunArtId,
  type PicturePlace,
  type ShareCardData,
} from "@/components/drops/share-card";
import { Textarea } from "@/components/ui/textarea";
import { getDrop, getShareCard } from "@/lib/api";
import { TESTNET_ONLY } from "@/lib/chains";
import { cn } from "@/lib/utils";

/**
 * The sender's share card. Redesigned: the
 * amount in a mint bar, `sent to N chads`, every name (a list up to 30, a wall up to 500),
 * three designs, the sender's own picture on any of them.
 *
 * Only for the sender of a live handle drop. The server render carries no cookie, so this reads
 * the drop again in the browser and asks the api for the card; anyone else gets nothing and the
 * section renders nothing. The card is drawn here on a canvas. A picture the sender picks stays
 * in this browser: it is decoded here and never sent anywhere.
 */
export function ShareCardSection({ address, live }: { address: string; live: boolean }) {
  const card = useShareCard(address, live);
  if (card === null) return null;
  return (
    <section className="mx-auto w-full max-w-(--container-content) px-4 pb-10">
      <ShareCardEditor card={card} />
    </section>
  );
}

/** The card facts once the api says this viewer is the sender and the drop is live. */
function useShareCard(address: string, live: boolean): ShareCardData | null {
  const [card, setCard] = useState<ShareCardData | null>(null);

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let timer: number | null = null;
    let tries = 0;
    // The api's own state can trail the chain by a moment after activation: ask again for a
    // few minutes while the page is live, then stop.
    const attempt = async () => {
      tries += 1;
      try {
        const fresh = await getDrop(address);
        const ours = fresh.ours.data;
        // Not ours, not a handle drop, or not this sender: nothing to show, nothing to wait for.
        if (ours === null || ours === undefined || ours.mode !== "handle" || ours.yours !== true)
          return;
        if (showShareCard({ mode: ours.mode, yours: true, state: ours.state })) {
          const facts = await getShareCard(address);
          if (!stopped) setCard(facts);
          return;
        }
        // Only a drop still on its way to live is worth asking again about.
        if (ours.state !== "created" && ours.state !== "funded") return;
      } catch {
        // Not the sender, or not ready yet; try again below while tries are left.
      }
      if (!stopped && tries < 30) timer = window.setTimeout(() => void attempt(), 10_000);
    };
    void attempt();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [address, live]);

  return card;
}

/** Anything the canvas can draw with a size: a picture, or the first frame of an upload. */
type Drawable = HTMLImageElement | ImageBitmap;

interface Assets {
  readonly hand: Drawable | null;
  /** The chain's mark for the bar, on its own tile colour. */
  readonly chain: Drawable | null;
  readonly chainTile: string;
  /** Before the amount: the chain's mark, or a token's logo with the chain's mark small, 5a. */
  readonly mark: BarMark;
  /** The token's logo from our own route; `null` when it has none, then its letter. */
  readonly token: Drawable | null;
  /** The fun design's pictures, `public/share/bg-*.png`, `FUN_ARTS`. */
  readonly arts: Readonly<Record<FunArtId, Drawable | null>>;
  readonly sender: Drawable | null;
}

export function ShareCardEditor({ card }: { card: ShareCardData }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [design, setDesign] = useState<CardDesignId>("clean");
  const [funArt, setFunArt] = useState<FunArtId>(DEFAULT_FUN_ART);
  const [picture, setPicture] = useState<ImageBitmap | null>(null);
  // Where the picture sits, moved by a drag on the preview and the zoom slider.
  const [place, setPlace] = useState<PicturePlace>(PICTURE_START);
  const drag = useRef<{ readonly id: number; readonly x: number; readonly y: number } | null>(null);
  const [text, setText] = useState(() => postText(card));
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Everything the card draws, loaded once. The X picture with CORS, so the canvas stays
  // exportable; a picture that does not load is drawn as its letter instead.
  useEffect(() => {
    let cancelled = false;
    const chainInfo = cardChain(card.chainKey);
    const mark = barMark(card);
    void (async () => {
      const [logo, chain, token, sender, ...artImages] = await Promise.all([
        loadImage(HAND_SRC, false),
        chainInfo === null ? Promise.resolve(null) : loadImage(chainInfo.logo, false),
        // Our own origin, so the canvas stays exportable without CORS.
        mark.kind === "token" ? loadImage(mark.logoUrl, false) : Promise.resolve(null),
        loadImage(card.sender.profileImageUrl, true),
        ...FUN_ARTS.map((art) => loadImage(art.src, false)),
      ]);
      const arts = Object.fromEntries(
        FUN_ARTS.map((art, i) => [art.id, artImages[i] ?? null]),
      ) as Record<FunArtId, Drawable | null>;
      const chainTile = (chainInfo === null ? "" : cssVar(`--brand-${chainInfo.key}`)) || "#000000";
      const hand = await mintHand(logo, cssVar("--chad-brand-mint") || "#7cf2b0");
      const family = getComputedStyle(document.body).fontFamily;
      await Promise.all([
        document.fonts.load(`400 40px ${family}`),
        document.fonts.load(`500 40px ${family}`),
        document.fonts.load(`600 40px ${family}`),
      ]).catch(() => undefined);
      if (!cancelled) setAssets({ hand, chain, chainTile, mark, token, arts, sender });
    })();
    return () => {
      cancelled = true;
    };
  }, [card]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || assets === null) return;
    drawCard(ctx, card, assets, design, funArt, picture, place);
  }, [card, assets, design, funArt, picture, place]);

  // The decoded picture is freed when a new one replaces it and when the page goes.
  useEffect(() => () => picture?.close(), [picture]);

  const pickPicture = async (file: File | undefined) => {
    setUploadError(null);
    if (file === undefined) return;
    if (!acceptUpload(file)) {
      setUploadError("pick an image up to 10 MB.");
      return;
    }
    try {
      // A GIF decodes to its first frame here; moving cards come later.
      setPicture(await createImageBitmap(file));
      setPlace(PICTURE_START);
    } catch {
      setUploadError("that picture could not be read. try another one.");
    }
  };

  // A drag on the preview moves the picture, finger or mouse; the first pointer only.
  const startDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    if (picture === null || drag.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const moveDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    const from = drag.current;
    if (picture === null || from === null || from.id !== event.pointerId) return;
    const width = event.currentTarget.clientWidth;
    const ddx = cardPixels(event.clientX - from.x, width);
    const ddy = cardPixels(event.clientY - from.y, width);
    drag.current = { id: from.id, x: event.clientX, y: event.clientY };
    setPlace((now) => movePicture(sizeOf(picture), now, ddx, ddy));
  };
  const endDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  const blob = useCallback(
    () =>
      new Promise<Blob>((resolve, reject) => {
        const el = canvas.current;
        if (!el) return reject(new Error("no card"));
        el.toBlob((b) => (b ? resolve(b) : reject(new Error("no card"))), "image/png");
      }),
    [],
  );

  const download = async () => {
    const url = URL.createObjectURL(await blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "dropchad-card.png";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const post = async () => {
    setNote(null);
    const file = new File([await blob()], "dropchad-card.png", { type: "image/png" });
    const phone = window.matchMedia("(pointer: coarse)").matches;
    const canShareFiles =
      phone && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
    if (sharePath({ canShareFiles }) === "share-sheet") {
      try {
        await navigator.share({ files: [file], text });
      } catch {
        // Closed by the sender, nothing to do.
      }
      return;
    }
    await download();
    window.open(postIntentUrl(text), "_blank", "noopener,noreferrer");
    setNote("the card is saved. attach it to your post on X.");
  };

  return (
    <div className="border-t border-chad-border pt-6">
      <h2 className="type-h2">your card</h2>
      <p className="type-small mt-1 text-chad-text-dim">
        only you can see this card. share it on X.
      </p>

      {/* Phone: the card on top, the controls under it. From tablet width up: two columns, the
          controls left, the preview right at about 58% of the section, never over 640px; both
          columns start and end on the same lines, the post box takes the space between. The
          PNG stays CARD_WIDTH by CARD_HEIGHT; only the preview is drawn smaller. */}
      <div className="mt-4 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-stretch md:gap-8">
        <div className="w-full max-w-[640px] md:order-2 md:justify-self-end">
          <canvas
            ref={canvas}
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            aria-label={`share card: ${card.sender.handle} ${chadsLine(card.people, cardChain(card.chainKey)?.name ?? null).replace(/^sent/, `sent ${cardShortAmount(card)}`)}`}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={cn(
              "aspect-video w-full rounded-xl border border-chad-border bg-chad-surface",
              // With a picture a swipe on the card moves it, not the page.
              picture !== null && "cursor-grab touch-none active:cursor-grabbing",
            )}
          />
        </div>

        <div className="md:order-1 md:flex md:flex-col">
          <p className="type-label mt-5 mb-2 md:mt-0">design</p>
          <div className="flex flex-wrap gap-2">
            {CARD_DESIGNS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={design === option.id}
                onClick={() => setDesign(option.id)}
                className={cn(
                  "btn btn-secondary h-11 px-4 md:h-8 md:rounded-full md:px-3",
                  design === option.id && "border-chad-accent text-chad-text",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {design === "fun" ? (
            <>
              <p className="type-label mt-5 mb-2 md:mt-3">meme</p>
              <FunArtPicker value={funArt} onChange={setFunArt} />
            </>
          ) : null}

          <p className="type-label mt-5 mb-2 md:mt-3">background</p>
          <div className="flex flex-wrap gap-2">
            <label
              className={cn(
                "btn btn-secondary h-11 cursor-pointer px-4 md:h-8 md:rounded-full md:px-3",
                picture !== null && "border-chad-accent text-chad-text",
              )}
            >
              {picture === null ? "add picture" : "another picture"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => void pickPicture(event.target.files?.[0])}
              />
            </label>
            {picture !== null ? (
              <button
                type="button"
                onClick={() => {
                  setPicture(null);
                  setPlace(PICTURE_START);
                }}
                className="btn btn-secondary h-11 px-4 md:h-8 md:rounded-full md:px-3"
              >
                no picture
              </button>
            ) : null}
          </div>
          <p className="type-small mt-2 text-chad-text-dim">
            best is a 16:9 picture, like 1920 x 1080.
          </p>
          {picture !== null ? (
            <PictureControls
              zoom={place.zoom}
              onZoom={(zoom) => setPlace((now) => zoomPicture(sizeOf(picture), now, zoom))}
              onReset={() => setPlace(PICTURE_START)}
            />
          ) : null}
          {uploadError ? <p className="type-small mt-1 text-chad-error">{uploadError}</p> : null}

          <div className="mt-5 md:mt-3 md:flex md:min-h-0 md:flex-1 md:flex-col">
            <label htmlFor="share-text" className="type-label mb-2 block">
              your post
            </label>
            <Textarea
              id="share-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              className="type-body md:min-h-16 md:flex-1 md:resize-none"
            />
            <p
              className={cn(
                "type-small mt-1",
                text.length > 280 ? "text-chad-error" : "text-chad-text-dim",
              )}
            >
              {text.length} / 280
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row md:mt-auto md:pt-3">
            <button
              type="button"
              onClick={() => void download()}
              className="btn btn-secondary h-11 w-full sm:w-auto sm:flex-1"
            >
              download card
            </button>
            <button
              type="button"
              onClick={() => void post()}
              className="btn btn-x h-11 w-full sm:w-auto sm:flex-1"
            >
              post on X
            </button>
          </div>
          {note ? <p className="type-small mt-2 text-chad-text-dim">{note}</p> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * With a picture: the `zoom` slider, 1x to 3x, and `reset`, back to the middle at 1x. 44px on
 * the phone, 32px from `md`, like the pills above.
 */
export function PictureControls({
  zoom,
  onZoom,
  onReset,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <label htmlFor="share-zoom" className="type-label">
        zoom
      </label>
      <input
        id="share-zoom"
        type="range"
        min={PICTURE_ZOOM_MIN}
        max={PICTURE_ZOOM_MAX}
        step={0.01}
        value={zoom}
        aria-label="zoom"
        onChange={(event) => onZoom(Number(event.target.value))}
        className="h-11 min-w-0 flex-1 accent-chad-accent md:h-8"
      />
      <button
        type="button"
        onClick={onReset}
        className="btn btn-secondary h-11 px-4 md:h-8 md:rounded-full md:px-3"
      >
        reset
      </button>
    </div>
  );
}

/**
 * The fun design's picture: `chad`, `laugh`, `bowl`, the same compact pills as the designs.
 */
export function FunArtPicker({
  value,
  onChange,
}: {
  value: FunArtId;
  onChange: (id: FunArtId) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {FUN_ARTS.map((art) => (
        <button
          key={art.id}
          type="button"
          aria-pressed={value === art.id}
          onClick={() => onChange(art.id)}
          className={cn(
            "btn btn-secondary h-11 px-4 md:h-8 md:rounded-full md:px-3",
            value === art.id && "border-chad-accent text-chad-text",
          )}
        >
          {art.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// the drawing, 1600 by 900. Tokens from the page's own css variables.
// ---------------------------------------------------------------------------

const PAD = 80;

interface Palette {
  readonly bg: string;
  readonly text: string;
  readonly dim: string;
  readonly surface2: string;
  readonly mint: string;
  readonly ink: string;
}

type Font = (weight: number, px: number) => string;

function drawCard(
  ctx: CanvasRenderingContext2D,
  card: ShareCardData,
  assets: Assets,
  design: CardDesignId,
  funArt: FunArtId,
  picture: ImageBitmap | null,
  place: PicturePlace,
): void {
  const family = getComputedStyle(document.body).fontFamily;
  const c: Palette = {
    bg: cssVar("--chad-bg") || "#0a0a0b",
    text: cssVar("--chad-text") || "#f2f2f4",
    dim: cssVar("--chad-text-dim") || "#8b8b95",
    surface2: cssVar("--chad-surface-2") || "#18181c",
    mint: cssVar("--chad-brand-mint") || "#7cf2b0",
    ink: cssVar("--chad-accent-ink") || "#0a0a0b",
  };
  const font: Font = (weight, px) => `${String(weight)} ${String(px)}px ${family}`;
  const centered = design === "center";
  const mode = nameMode(card.receivers.length);
  const handles = card.receivers.map((person) => `@${person.handle}`);
  // On fun the text stays clear of the man's hand, arm and face, per picture.
  const boxes = funTextBoxes(design === "fun" ? funArt : null);
  const art = assets.arts[funArt];

  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";

  // 1. the background: the sender's picture under a dark fade, or the design's own
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  if (picture !== null) {
    // Where the sender moved it; it always covers the whole card.
    const at = pictureRect(sizeOf(picture), place);
    ctx.drawImage(picture, at.x, at.y, at.w, at.h);
    fade(ctx, c, design);
  } else if (design === "clean") {
    glow(ctx, c.mint, 1300, 220, 760, 0.2);
  } else if (design === "center") {
    grid(ctx);
    glow(ctx, c.mint, 800, 470, 700, 0.12);
  } else if (art !== null) {
    // The picked meme, scaled to fill and cropped from the middle, never stretched. A light
    // fade on the left, where the text sits; the art is already dark there.
    drawCover(ctx, art, 0, 0, CARD_WIDTH, CARD_HEIGHT);
    const left = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
    left.addColorStop(0, withAlpha(c.bg, 0.55));
    left.addColorStop(0.45, withAlpha(c.bg, 0.25));
    left.addColorStop(0.6, withAlpha(c.bg, 0));
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  } else {
    glow(ctx, c.mint, 1150, 380, 900, 0.26);
  }

  // 2. a name wall fills the background behind everything that follows
  if (mode === "wall") {
    // On fun the wall stays on the left with the rest of the text, clear of the art.
    const wallBox = design === "fun" ? boxes.wall : { x: 40, width: CARD_WIDTH - 80 };
    const wall = fitNames(
      handles,
      // Ends above the claim line at the bottom.
      { width: wallBox.width, height: CARD_HEIGHT - 150 },
      (t, px) => measure(ctx, font(500, px), t),
      { max: 40, min: 8 },
    );
    ctx.font = font(500, wall.px);
    ctx.fillStyle = withAlpha(c.text, 0.2);
    ctx.textAlign = "center";
    wall.lines.forEach((line, i) => {
      ctx.fillText(
        line.join(NAME_GAP),
        wallBox.x + wallBox.width / 2,
        40 + (i + 0.8) * wall.px * NAME_LINE_HEIGHT,
      );
    });
    ctx.textAlign = "left";
  }

  // 3. the main block: where it sits and how wide it may grow
  const blockX = centered ? CARD_WIDTH / 2 : PAD;
  const blockMax = centered
    ? CARD_WIDTH - PAD * 2
    : Math.min(mode === "list" ? 780 : 1000, boxes.barMax);
  // Short and readable, `25.12 SOL`; the post keeps the exact amount.
  const short = cardShortAmount(card);
  const amount = short.slice(0, short.lastIndexOf(" "));
  const chainInfo = cardChain(card.chainKey);
  // The ticker cut and sized like the drop page: a long one one step smaller.
  const unit = barSymbol(card);
  const bar = barGeometry(
    ctx,
    font,
    amount,
    unit.text,
    blockMax,
    headerGap(ctx, font),
    unit.small ? COIN_RATIO_SMALL : COIN_RATIO,
  );
  const top = centered ? 196 : 212;
  const barY = top + 150;
  const chadsY = barY + bar.height + 62;
  // `sent to 500 chads on Robinhood` steps down from 40px when it would reach the art.
  const chadsText = chadsLine(card.people, chainInfo?.name ?? null);
  const chadsPx = fitTextPx(chadsText, boxes.lineMax, (t, px) => measure(ctx, font(500, px), t), {
    max: 40,
    min: 24,
  });

  if (mode === "wall") {
    // A dark panel keeps the sender and the bar big and readable on top of the crowd.
    // As wide as its widest line: the bar, or `sent to 500 chads on Robinhood`.
    ctx.font = font(500, chadsPx);
    const lineW = ctx.measureText(chadsText).width;
    const panelX = centered ? blockX - (Math.max(bar.width, lineW, 520) + 96) / 2 : PAD - 48;
    const panelW = Math.min(Math.max(bar.width, lineW, 520) + 96, boxes.panelRight - panelX);
    roundRect(ctx, panelX, 44, panelW, chadsY + 40 - 44, 32);
    ctx.fillStyle = withAlpha(c.bg, 0.9);
    ctx.fill();
  }

  // 4. the top: the hand, the wordmark, testnet
  header(ctx, assets.hand, c, font, centered);

  // 5. the sender
  const senderText = `@${card.sender.handle}`;
  ctx.font = font(500, 36);
  const senderW = 84 + 20 + ctx.measureText(senderText).width;
  const senderX = centered ? blockX - senderW / 2 : PAD;
  drawAvatar(ctx, assets.sender, card.sender.handle, senderX, top, 84, c, font);
  ctx.font = font(500, 36);
  ctx.fillStyle = c.text;
  ctx.fillText(senderText, senderX + 104, top + 55);

  // 6. the green bar with the chain logo (a token's logo on a token drop) and the amount, then
  // sent to N chads on the chain
  const barX = centered ? blockX - bar.width / 2 : PAD;
  drawBar(ctx, bar, barX, barY, amount, unit.text, assets, c, font);
  ctx.font = font(500, chadsPx);
  ctx.fillStyle = c.text;
  ctx.textAlign = centered ? "center" : "left";
  ctx.fillText(chadsText, centered ? blockX : PAD, chadsY);
  ctx.textAlign = "left";

  // 7. the names as a readable list, up to 30
  if (mode === "list") {
    const box = centered
      ? {
          x: PAD + 40,
          y: chadsY + 44,
          width: CARD_WIDTH - (PAD + 40) * 2,
          height: 750 - chadsY - 44,
        }
      : {
          x: PAD,
          y: chadsY + 44,
          // The fun design keeps its text on the left, clear of the art.
          width: design === "fun" ? boxes.list.width : CARD_WIDTH - PAD * 2,
          height: 740 - chadsY - 44,
        };
    const list = fitNames(handles, box, (t, px) => measure(ctx, font(500, px), t), {
      max: 44,
      min: 20,
    });
    ctx.font = font(500, list.px);
    ctx.fillStyle = c.text;
    ctx.textAlign = centered ? "center" : "left";
    list.lines.forEach((line, i) => {
      const y = box.y + (i + 0.8) * list.px * NAME_LINE_HEIGHT;
      ctx.fillText(line.join(NAME_GAP), centered ? CARD_WIDTH / 2 : box.x, y);
    });
    ctx.textAlign = "left";
  }

  // 8. dropchad.com, always, on a solid black box with straight corners
  ctx.font = font(600, 32);
  const url = ctx.measureText("dropchad.com");
  const urlBase = CARD_HEIGHT - 78;
  const boxPadX = 20;
  const boxPadY = 14;

  // 9. the claim line under the names, on the same baseline and the same kind of box, so it
  // reads on a name wall and on a photo too. Centred on `center`.
  ctx.font = font(500, 28);
  const claim = ctx.measureText(CARD_CLAIM_LINE);
  const claimX = centered ? CARD_WIDTH / 2 - claim.width / 2 : PAD;
  ctx.fillStyle = c.bg;
  ctx.fillRect(
    claimX - boxPadX,
    urlBase - claim.actualBoundingBoxAscent - boxPadY,
    claim.width + boxPadX * 2,
    claim.actualBoundingBoxAscent + claim.actualBoundingBoxDescent + boxPadY * 2,
  );
  ctx.fillStyle = c.dim;
  ctx.fillText(CARD_CLAIM_LINE, claimX, urlBase);

  ctx.font = font(600, 32);
  ctx.fillStyle = c.bg;
  ctx.fillRect(
    CARD_WIDTH - PAD - url.width - boxPadX,
    urlBase - url.actualBoundingBoxAscent - boxPadY,
    url.width + boxPadX * 2,
    url.actualBoundingBoxAscent + url.actualBoundingBoxDescent + boxPadY * 2,
  );
  ctx.fillStyle = c.text;
  ctx.textAlign = "right";
  ctx.fillText("dropchad.com", CARD_WIDTH - PAD, urlBase);
  ctx.textAlign = "left";
}

function header(
  ctx: CanvasRenderingContext2D,
  hand: Drawable | null,
  c: Palette,
  font: Font,
  centered: boolean,
): void {
  ctx.font = font(600, 48);
  ctx.letterSpacing = "-0.96px";
  const dropW = ctx.measureText("drop").width;
  const chadW = ctx.measureText("chad").width;
  ctx.letterSpacing = "0px";
  ctx.font = font(500, 20);
  ctx.letterSpacing = "1.6px";
  const pillW = TESTNET_ONLY ? ctx.measureText("TESTNET").width + 28 + 26 : 0;
  ctx.letterSpacing = "0px";
  const total = 64 + 18 + dropW + chadW + pillW;
  const x = centered ? (CARD_WIDTH - total) / 2 : PAD;

  if (hand) {
    const { x: ix, y: iy, w: iw, h: ih } = LOGO_INK;
    const scale = HAND_INK.w / iw;
    ctx.drawImage(hand, ix, iy, iw, ih, x + HAND_INK.x, 76 + HAND_INK.y, HAND_INK.w, ih * scale);
  }
  ctx.font = font(600, 48);
  ctx.letterSpacing = "-0.96px";
  ctx.fillStyle = c.text;
  ctx.fillText("drop", x + 82, 124);
  ctx.fillStyle = c.mint;
  ctx.fillText("chad", x + 82 + dropW, 124);
  ctx.letterSpacing = "0px";
  if (TESTNET_ONLY) {
    const px = x + 82 + dropW + chadW + 26;
    ctx.font = font(500, 20);
    ctx.letterSpacing = "1.6px";
    roundRect(ctx, px, 90, pillW - 26, 36, 10);
    ctx.fillStyle = "rgba(35,35,41,0.95)";
    ctx.fill();
    ctx.fillStyle = c.text;
    ctx.fillText("TESTNET", px + 14, 115);
    ctx.letterSpacing = "0px";
  }
}

interface Bar {
  readonly width: number;
  readonly height: number;
  readonly px: number;
  readonly logo: number;
  readonly numberWidth: number;
  /** From the logo's right edge to where the number is drawn, so its ink starts at the gap. */
  readonly numberOffset: number;
  /** The unit's size against the number's: smaller for a long ticker. */
  readonly coinRatio: number;
}

const BAR_PAD = 36;
const COIN_RATIO = 0.42;
/** A long ticker, 7 letters and more, one step smaller in the bar. */
const COIN_RATIO_SMALL = 0.34;

/**
 * The hand on the card: the logo, `dropchad-logo.png`, kept as `scripts/hand-silhouette.png` and
 * served from here. Never `hand-1024.png`.
 */
export const HAND_SRC = "/brand/hand-silhouette.png";

/** The logo's ink in its 1000px file, every pixel with any alpha. */
export const LOGO_INK = { x: 85, y: 71, w: 832, h: 853 } as const;

/**
 * Where the hand's ink goes in its 64px square: the box the old master's ink filled (91, 82, 841
 * wide of 1024), so the hand, the gap after it and the bar stay where they were. One scale, from
 * the width; the logo is 0.14px taller here, nothing moves.
 */
export const HAND_INK = { x: (64 * 91) / 1024, y: (64 * 82) / 1024, w: (64 * 841) / 1024 } as const;

/**
 * The hand's transparent air on its right at 64px on the old master and kept
 * as it was: the logo's ink ends where that hand's did. The gap you see is the drawn gap plus this.
 */
export const HAND_AIR_RIGHT = (64 * (1024 - 930)) / 1024;

/**
 * The logo in the brand mint with the file's own alpha: the space between the
 * fingers stays see-through, so it shows the card background. The logo as it is if no canvas.
 */
async function mintHand(logo: HTMLImageElement | null, mint: string): Promise<Drawable | null> {
  if (logo === null) return null;
  const canvas = document.createElement("canvas");
  canvas.width = logo.naturalWidth;
  canvas.height = logo.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return logo;
  ctx.drawImage(logo, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = mint;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return createImageBitmap(canvas).catch(() => logo);
}

/**
 * The gap you see at the top between the hand and `drop`: the 18px drawn gap, the hand's air,
 * and the `d`'s own left side space. The bar uses the same gap between its logo and the number.
 */
function headerGap(ctx: CanvasRenderingContext2D, font: Font): number {
  ctx.font = font(600, 48);
  ctx.letterSpacing = "-0.96px";
  const bearing = -ctx.measureText("drop").actualBoundingBoxLeft;
  ctx.letterSpacing = "0px";
  return 18 + HAND_AIR_RIGHT + bearing;
}

/** The mint bar's size: the amount as big as `maxWidth` allows, never cut. */
function barGeometry(
  ctx: CanvasRenderingContext2D,
  font: Font,
  amount: string,
  symbol: string,
  maxWidth: number,
  gap: number,
  coinRatio: number = COIN_RATIO,
): Bar {
  const inner = (px: number) => {
    ctx.font = font(600, px);
    ctx.letterSpacing = `${String(-px * 0.02)}px`;
    const measured = ctx.measureText(amount);
    const n = measured.width;
    ctx.letterSpacing = "0px";
    // The number's ink starts `gap` after the logo, whatever the first digit's side space.
    const offset = gap + measured.actualBoundingBoxLeft;
    ctx.font = font(600, Math.round(px * coinRatio));
    const s = ctx.measureText(symbol).width;
    const logo = Math.round(px * 0.62);
    return { total: logo + offset + n + px * 0.12 + s, n, logo, offset };
  };
  const px = cardAmountSize(
    `${amount} ${symbol}`,
    maxWidth - BAR_PAD * 2,
    (_t, size) => inner(size).total,
  );
  const m = inner(px);
  return {
    width: m.total + BAR_PAD * 2,
    height: Math.round(px * 1.18),
    px,
    logo: m.logo,
    numberWidth: m.n,
    numberOffset: m.offset,
    coinRatio,
  };
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  bar: Bar,
  x: number,
  y: number,
  amount: string,
  symbol: string,
  assets: Pick<Assets, "chain" | "chainTile" | "mark" | "token">,
  c: Palette,
  font: Font,
): void {
  // Straight 90 degree corners, the axiom pnl card look.
  ctx.fillStyle = c.mint;
  ctx.fillRect(x, y, bar.width, bar.height);

  const cx = x + BAR_PAD + bar.logo / 2;
  const cy = y + bar.height / 2;
  if (assets.mark.kind === "token") {
    // A token drop: the token's logo, round, or its letter on a dark disc; the
    // chain's mark small on the lower right corner, ringed in the bar's mint.
    tokenDisc(ctx, cx, cy, bar.logo / 2, assets.token, assets.mark.letter, c, font);
    const r = bar.logo * 0.2;
    const bx = cx + bar.logo * 0.36;
    const by = cy + bar.logo * 0.36;
    chainDisc(ctx, bx, by, r + Math.max(2, bar.logo * 0.04), c.mint, null);
    chainDisc(ctx, bx, by, r, assets.chainTile, assets.chain);
  } else {
    // The chain's mark on its own tile colour, as on every chain badge of the site.
    chainDisc(ctx, cx, cy, bar.logo / 2, assets.chainTile, assets.chain);
  }

  const baseline = y + bar.height / 2 + bar.px * 0.36;
  const nx = x + BAR_PAD + bar.logo + bar.numberOffset;
  ctx.font = font(600, bar.px);
  ctx.letterSpacing = `${String(-bar.px * 0.02)}px`;
  ctx.fillStyle = c.ink;
  ctx.fillText(amount, nx, baseline);
  ctx.letterSpacing = "0px";
  ctx.font = font(600, Math.round(bar.px * bar.coinRatio));
  ctx.fillStyle = withAlpha(c.ink, 0.72);
  ctx.fillText(symbol, nx + bar.numberWidth + bar.px * 0.12, baseline);
}

/** A round tile in `fill` with the chain's mark inside, 60% of its size, its own shape kept. */
function chainDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  logo: Drawable | null,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (logo) drawContain(ctx, logo, cx - r * 0.6, cy - r * 0.6, r * 1.2, r * 1.2);
}

/** A token's logo cut round, or its letter in mint on a dark disc when it has none. */
function tokenDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  logo: Drawable | null,
  letter: string,
  c: Palette,
  font: Font,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = c.ink;
  ctx.fill();
  if (logo) {
    ctx.clip();
    drawCover(ctx, logo, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.font = font(600, Math.round(r * 1.1));
    ctx.fillStyle = c.mint;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, cx, cy + r * 0.04);
  }
  ctx.restore();
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  image: Drawable | null,
  handle: string,
  x: number,
  y: number,
  size: number,
  c: Palette,
  font: Font,
): void {
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = c.surface2;
  ctx.fill();
  ctx.clip();
  if (image) {
    drawCover(ctx, image, x, y, size, size);
  } else {
    ctx.font = font(600, Math.round(size * 0.4));
    ctx.fillStyle = c.dim;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((handle[0] ?? "?").toUpperCase(), x + r, y + r + 1);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.bg;
  ctx.stroke();
}

function sizeOf(image: Drawable): { w: number; h: number } {
  return image instanceof HTMLImageElement
    ? { w: image.naturalWidth || image.width, h: image.naturalHeight || image.height }
    : { w: image.width, h: image.height };
}

/** Draw `image` to fill the box, cropped from the middle, never stretched. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: Drawable,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { w: iw, h: ih } = sizeOf(image);
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** Draw `image` inside the box, its own shape kept (the Ethereum mark is tall). */
function drawContain(
  ctx: CanvasRenderingContext2D,
  image: Drawable,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { w: iw, h: ih } = sizeOf(image);
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** The dark fade over a picture, strongest where the text sits, `pictureFade`. */
function fade(ctx: CanvasRenderingContext2D, c: Palette, design: CardDesignId): void {
  const shade = pictureFade(design);
  if (shade.kind === "even") {
    ctx.fillStyle = withAlpha(c.bg, shade.alpha);
  } else {
    const across = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
    for (const [at, alpha] of shade.stops) across.addColorStop(at, withAlpha(c.bg, alpha));
    ctx.fillStyle = across;
  }
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const up = ctx.createLinearGradient(0, CARD_HEIGHT, 0, CARD_HEIGHT * 0.6);
  up.addColorStop(0, withAlpha(c.bg, 0.85));
  up.addColorStop(1, withAlpha(c.bg, 0));
  ctx.fillStyle = up;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

function glow(
  ctx: CanvasRenderingContext2D,
  mint: string,
  x: number,
  y: number,
  r: number,
  alpha: number,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha(mint, alpha));
  g.addColorStop(1, withAlpha(mint, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

function grid(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= CARD_WIDTH; x += 64) line(ctx, x + 0.5, 0, x + 0.5, CARD_HEIGHT);
  for (let y = 0; y <= CARD_HEIGHT; y += 64) line(ctx, 0, y + 0.5, CARD_WIDTH, y + 0.5);
}

function measure(ctx: CanvasRenderingContext2D, f: string, text: string): number {
  ctx.font = f;
  return ctx.measureText(text).width;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** `#rrggbb` at an alpha, for the fades, the glows and the wall. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null || m[1] === undefined) return `rgba(10,10,11,${String(alpha)})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${String((n >> 16) & 255)},${String((n >> 8) & 255)},${String(n & 255)},${String(alpha)})`;
}

/** An image, or `null` when it does not load. The X picture asks for CORS so the canvas stays exportable. */
function loadImage(src: string | null, cors: boolean): Promise<HTMLImageElement | null> {
  if (src === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    if (cors) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

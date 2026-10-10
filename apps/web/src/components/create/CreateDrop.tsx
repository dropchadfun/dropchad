"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";

import { ChainSwitch } from "@/components/chains/ChainSwitch";
import { devPreviewEnabled, samplePreview, submitAllowed } from "@/components/create/dev-preview";
import { explain } from "@/components/create/errors";
import {
  initialForm,
  reduceForm,
  viewOf,
  type CreateMode,
  type Step,
} from "@/components/create/form";
import { ModeSwitch } from "@/components/create/ModeSwitch";
import {
  assetHalves,
  assetSub,
  mintOf,
  tokenCheckError,
  type TokenFeeTier,
} from "@/components/create/token";
import { TokenBox } from "@/components/create/TokenBox";
import { WayBack } from "@/components/create/WayBack";
import { FundingCardFrom } from "@/components/drops/FundingCard";
import { Avatar } from "@/components/site/Avatar";
import { FitNumber } from "@/components/site/FitNumber";
import { useSession } from "@/components/site/SessionProvider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  createDrop,
  getChains,
  getTokenCheck,
  openLive,
  resolveHandles,
  type CreatedDrop,
} from "@/lib/api";
import type { ChainPill } from "@/lib/chains";
import { readCsrfToken } from "@/lib/csrf";
import { afterCreatePath } from "@/lib/drop-path";
import { formatAmount, formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Make a drop, or a multisend. Three steps: one tap from the front page, nothing
 * deeper.
 *
 * The switch on top: `drop` first and the default, X handles
 * and amounts; `multisend` last, addresses and amounts. When the chosen chain has handle mode
 * off, `drop` is greyed, the page is on `multisend`, and one line says `x handle drops are
 * paused`. Copy says multisend in multisend mode, never drop.
 *
 * 1. who receives: the chain first (robinhood or solana, whichever is live), then the box for the
 *    mode. Drop mode checks the handles on the phone, then **one paid lookup on `next`**: every
 *    handle must be found, or the page stays here and lists the misses.
 *    Multisend reads addresses as before. Count and total live.
 * 2. what and how much: in drop mode first the people it pays, name and avatar; then the
 *    chosen chain, read only, asset (native, the only one today), a title (no picture box: a
 *    drop with no picture shows the sender's X avatar),
 *    and the refund address with the exchange warning. The fee line is the chain's real
 *    `defaultFeeBps` from `GET /api/chains`, never a constant; until the api answers it says
 *    "…", and if the chain did not answer it says "not sure".
 * 3. fund this address: the exact amount, the address, the QR. The page follows the stream and
 *    moves on the moment `funding_seen` arrives.
 *
 * The form state is `form.ts`, a reducer; moving between steps touches `step` only.
 * The sender never connects a wallet. There is nothing to sign here.
 *
 * `?handleMode=on` is a dev only preview, `dev-preview.ts`: in local development only, drop mode
 * can be picked and the lookup answers with sample names, and a drop is never sent from it.
 */
export function CreateDrop({
  pills,
  initialMode = "drop",
}: {
  pills: readonly ChainPill[];
  /** `?mode=multisend` from the front page link; `drop` otherwise. */
  initialMode?: CreateMode;
}) {
  const router = useRouter();
  const { profile } = useSession();

  const [form, dispatch] = useReducer(reduceForm, pills, (start) =>
    initialForm(start, initialMode),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedDrop | null>(null);
  /**
   * Fee in bps and the flat minimum per registry key. Absent until `/api/chains` answers; a field
   * is `null` when the chain did not.
   */
  const [fees, setFees] = useState<ReadonlyMap<
    string,
    {
      readonly bps: number | null;
      readonly min: bigint | null;
      /** the minimum per receiver and the max fee, zero is off. */
      readonly perReceiver: bigint | null;
      readonly maxFee: bigint | null;
      readonly tiers: readonly TokenFeeTier[] | null;
    }
  > | null>(null);
  /** `handleMode` per registry key as the api said it, `null` until it answers. */
  const [apiHandleModes, setApiHandleModes] = useState<Record<string, boolean> | null>(null);
  /**
   * The dev only preview, from the browser's own url and host. `NODE_ENV` is
   * written in by Next at build time, so a production build can never turn it on.
   */
  const devPreview = useSyncExternalStore(
    noSubscribe,
    // `NODE_ENV === "development"` first: a production build turns it into `false` and drops
    // the call, so the preview is not only off there but gone.
    () =>
      process.env.NODE_ENV === "development" &&
      devPreviewEnabled(window.location.search, {
        nodeEnv: process.env.NODE_ENV,
        hostname: window.location.hostname,
      }),
    // The server render never knows the browser's url: off, then the browser decides.
    () => false,
  );

  // The fee is read from the chain through the api, and handle mode per chain.
  // One call, on mount.
  useEffect(() => {
    let cancelled = false;
    getChains()
      .then(({ chains }) => {
        if (cancelled) return;
        setFees(
          new Map(
            chains.map((entry) => [
              entry.key,
              {
                bps: entry.defaultFeeBps,
                min: typeof entry.minFee === "string" ? BigInt(entry.minFee) : null,
                // Absent from an api before: zero, the old fee.
                perReceiver: amountOrZero(entry.minFeePerReceiver),
                maxFee: amountOrZero(entry.maxFee),
                // The token fee tiers; absent from an api before 5b.
                tiers: entry.tokenFeeTiers ?? null,
              },
            ]),
          ),
        );
        setApiHandleModes(
          Object.fromEntries(chains.map((entry) => [entry.key, entry.handleMode === true])),
        );
      })
      .catch(() => {
        if (!cancelled) setFees(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // What the switch reads: the api's answer, or in the dev preview every chain on.
  useEffect(() => {
    if (devPreview) {
      dispatch({
        type: "handleModes",
        value: Object.fromEntries(
          pills.flatMap((pill) => (pill.chainKey ? [[pill.chainKey, true] as const] : [])),
        ),
      });
    } else if (apiHandleModes !== null) {
      dispatch({ type: "handleModes", value: apiHandleModes });
    }
  }, [devPreview, apiHandleModes, pills]);

  const { step, mode, text, handleText, chain, title, refund } = form;
  const drop = mode === "drop";
  const chainKey = pills.find((pill) => pill.key === chain)?.chainKey ?? null;
  const fee = chainKey === null ? undefined : fees?.get(chainKey);
  const feeBps = fee?.bps ?? null;
  const minFee = fee?.min ?? null;
  const tokenTiers = fee?.tiers ?? null;
  const perReceiver = fee?.perReceiver ?? null;
  const maxFee = fee?.maxFee ?? null;
  const ownHandle = profile?.handle ?? null;
  const view = useMemo(
    () => viewOf(form, pills, feeBps, minFee, ownHandle, tokenTiers, perReceiver, maxFee),
    [form, pills, feeBps, minFee, ownHandle, tokenTiers, perReceiver, maxFee],
  );
  const { pill: selectedPill, decimals, symbol: nativeSymbol, parsed, handles } = view;
  const { step1Ok, refundOk, step2Ok } = view;
  /** The chain's own coin, `SOL` or `ETH`, whatever the drop is in. */
  const coin = selectedPill?.nativeSymbol ?? "ETH";

  // Step 3 listens for the money. `funding_seen` means the drop is about to go live: go watch it.
  useEffect(() => {
    if (created === null) return;
    const close = openLive(created.drop.address, (event) => {
      if (
        event.type === "funding_seen" ||
        event.type === "activated" ||
        event.type === "claim_paid"
      ) {
        router.push(afterCreatePath(mode, created.drop.address));
      }
    });
    return close;
  }, [created, router, mode]);

  // The token box: a pasted address is checked once; the reducer drops an
  // answer for an address that is no longer in the box.
  const pastedMint = view.tokenChosen ? mintOf(form.mintText, view.family) : null;
  const checkedMint = form.tokenCheck?.forMint ?? null;
  // a `0x` address is checked on Robinhood.
  const checkChain = view.family === "evm" ? "robinhood" : "solana";
  useEffect(() => {
    if (pastedMint === null || checkedMint === pastedMint) return;
    let cancelled = false;
    getTokenCheck(pastedMint, checkChain)
      .then((check) => {
        if (!cancelled) dispatch({ type: "tokenCheck", result: { forMint: pastedMint, check } });
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          dispatch({
            type: "tokenCheck",
            result: { forMint: pastedMint, error: tokenCheckError(caught) },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [pastedMint, checkedMint, checkChain]);

  /** Drop mode, `next`: the one paid lookup. A clean answer moves to step 2 in the reducer. */
  const lookup = async () => {
    if (devPreview) {
      // Sample names from `dev-preview.ts`. No api call, no X lookup, nothing leaves the browser.
      const distinct = [
        ...new Map(handles.lines.map((l) => [l.handle.toLowerCase(), l.handle])).values(),
      ];
      dispatch({ type: "preview", preview: samplePreview(distinct, handleText) });
      return;
    }
    const token = readCsrfToken();
    if (token === null) {
      setError("sign in with X first.");
      return;
    }
    setBusy(true);
    setError(null);
    const forText = handleText;
    try {
      const distinct = [
        ...new Map(handles.lines.map((l) => [l.handle.toLowerCase(), l.handle])).values(),
      ];
      const result = await resolveHandles(distinct, token);
      dispatch({
        type: "preview",
        preview: { forText, found: result.found, missing: result.missing },
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "handle_mode_not_ready" && chainKey) {
        // Handle mode went off since the page loaded: the switch moves to multisend.
        dispatch({ type: "handleModes", value: { ...form.handleModes, [chainKey]: false } });
      }
      setError(explain(caught, { decimals, token: view.tokenChosen, coin }));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!submitAllowed({ devPreview, mode })) {
      setError("dev preview: a drop is never sent from here.");
      return;
    }
    const token = readCsrfToken();
    if (token === null) {
      setError("sign in with X first.");
      return;
    }
    setBusy(true);
    setError(null);
    const common = {
      ...(selectedPill?.chainKey ? { chain: selectedPill.chainKey } : {}),
      refundRecipient: refund.trim(),
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    try {
      const result = await createDrop(
        drop
          ? {
              ...common,
              mode: "handle",
              // `native`, or the checked mint on a token drop.
              asset: view.asset,
              handles: handles.lines.map((line) => ({
                handle: line.handle,
                amount: line.amountWei.toString(),
              })),
            }
          : {
              ...common,
              mode: "address",
              receivers: parsed.receivers.map((r) => ({
                address: r.address,
                amount: r.amountWei.toString(),
              })),
            },
        token,
      );
      setCreated(result);
      dispatch({ type: "created" });
    } catch (caught) {
      setError(explain(caught, { decimals, token: view.tokenChosen, coin }));
    } finally {
      setBusy(false);
    }
  };

  if (profile === null) {
    return (
      <main className="mx-auto w-full max-w-(--container-content) px-4 py-8">
        <h1 className="type-h1">make a drop</h1>
        <p className="type-body mt-3 text-chad-text-dim">
          sign in with X first. the drop is posted in your name.
        </p>
        <a href="/api/auth/x/start" className="btn btn-x mt-6">
          sign in with X
        </a>
      </main>
    );
  }

  // One amount per person on the step 2 list: a repeated handle is merged, like the api does.
  const amountOf = new Map<string, bigint>();
  for (const line of handles.lines) {
    const key = line.handle.toLowerCase();
    amountOf.set(key, (amountOf.get(key) ?? 0n) + line.amountWei);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-4 md:py-6">
      <h1 className="type-h1">{drop ? "make a drop" : "multisend"}</h1>
      {devPreview ? (
        <p className="type-small mt-1 text-chad-text-dim">
          dev preview: sample names, nothing is sent.
        </p>
      ) : null}
      {step === 3 ? null : (
        <ModeSwitch
          mode={mode}
          dropAvailable={view.dropAvailable}
          onChange={(next) => dispatch({ type: "mode", mode: next })}
        />
      )}
      <Steps step={step} />

      {step === 1 ? (
        <section className="mt-6">
          <p className="type-label mb-2">chain</p>
          <ChainSwitch
            pills={pills}
            value={chain}
            onChange={(key) => dispatch({ type: "chain", key })}
            allowAll={false}
          />
          {view.tokenBox ? (
            <TokenBox
              coin={coin}
              asset={form.asset}
              mintText={form.mintText}
              check={view.tokenCheck}
              error={view.tokenError}
              quickTokens={selectedPill?.quickTokens ?? []}
              onAsset={(value) => dispatch({ type: "asset", value })}
              onMintText={(value) => dispatch({ type: "mintText", value })}
            />
          ) : null}

          <label htmlFor="receivers" className="type-label mt-6 block">
            {drop ? "who gets it" : "who receives"}
          </label>
          <p className="type-small mt-1 mb-3 text-chad-text-dim">{view.receiversHint}</p>
          <Textarea
            id="receivers"
            value={drop ? handleText : text}
            onChange={(event) =>
              dispatch({
                type: drop ? "handleText" : "text",
                value: event.target.value,
              })
            }
            spellCheck={false}
            rows={10}
            placeholder={view.placeholder}
            className="type-body min-h-56 rounded-lg border-chad-border bg-chad-surface font-mono"
          />
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <Fact label={drop ? "people" : "receivers"} value={formatCount(view.people)} />
            <Fact label="total" value={view.totalText} accent />
          </dl>
          {(drop ? handles.duplicates : parsed.duplicates) > 0 ? (
            <p className="type-small mt-2 text-chad-text-dim">
              {drop
                ? `${formatCount(handles.duplicates)} repeated ${handles.duplicates === 1 ? "handle" : "handles"}. they are merged into one person each.`
                : `${formatCount(parsed.duplicates)} repeated ${parsed.duplicates === 1 ? "address" : "addresses"}. they are merged into one line each.`}
            </p>
          ) : null}
          <LineErrors errors={drop ? handles.errors : parsed.errors} />
          {drop && handles.tooMany ? (
            <p className="type-table mt-3 text-chad-error">
              {view.tokenChosen
                ? `${formatCount(view.maxPeople)} people per token drop at most.`
                : `${formatCount(view.maxPeople)} people per drop at most.`}
            </p>
          ) : null}
          {drop && view.missing.length > 0 ? (
            <p className="type-table mt-3 text-chad-error">
              not found on X: {view.missing.map((handle) => `@${handle}`).join(", ")}. fix or remove
              them.
            </p>
          ) : null}
          {error ? <p className="type-body mt-3 text-chad-error">{error}</p> : null}
          {drop ? (
            <Primary disabled={!step1Ok || busy} onClick={() => void lookup()}>
              {busy ? "checking the handles…" : "next"}
            </Primary>
          ) : (
            <Primary disabled={!step1Ok} onClick={() => dispatch({ type: "next" })}>
              next
            </Primary>
          )}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="mt-6 space-y-6">
          {drop ? (
            <div>
              <p className="type-label mb-2">who gets it</p>
              <ul className="card divide-y divide-chad-border rounded-xl">
                {view.found.map((person) => (
                  <li key={person.xUserId} className="flex items-center gap-3 px-3 py-2">
                    <Avatar src={person.profileImageUrl} name={person.handle} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="type-table truncate text-chad-text">{person.displayName}</p>
                      <p className="type-small truncate text-chad-text-dim">@{person.handle}</p>
                    </div>
                    <span className="type-table shrink-0 text-chad-text">
                      {formatAmount(amountOf.get(person.handle.toLowerCase()) ?? 0n, decimals, 6)}{" "}
                      {nativeSymbol}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <p className="type-label mb-2">chain</p>
            <div className="card type-body flex h-10 items-center rounded-lg px-3">
              {selectedPill?.name ?? "none"}
            </div>
          </div>

          <div>
            <p className="type-label mb-2">asset</p>
            {view.tokenChosen && view.tokenCheck ? (
              // The full address, `name · ticker` under it; no line when the token has neither.
              <div className="card rounded-lg px-3 py-2">
                <p className="type-body font-mono">
                  {assetHalves(view.tokenCheck.mint).map((half) => (
                    <span key={half} className="inline-block whitespace-nowrap">
                      {half}
                    </span>
                  ))}
                </p>
                {assetSub(view.tokenCheck) ? (
                  <p className="type-small mt-1 text-chad-text-dim">{assetSub(view.tokenCheck)}</p>
                ) : null}
              </div>
            ) : (
              <div className="card type-body flex h-10 items-center rounded-lg px-3">
                {nativeSymbol}
                {view.tokenBox ? null : (
                  <span className="type-small ml-auto text-chad-text-dim">tokens come later</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="title" className="type-label">
              title
            </label>
            <Input
              id="title"
              value={title}
              onChange={(event) => dispatch({ type: "title", value: event.target.value })}
              maxLength={80}
              placeholder="drop for chads"
              className="type-body mt-2 h-10 rounded-lg border-chad-border bg-chad-surface"
            />
          </div>

          <div>
            <label htmlFor="refund" className="type-label">
              refund address
            </label>
            <Input
              id="refund"
              value={refund}
              onChange={(event) => dispatch({ type: "refund", value: event.target.value })}
              spellCheck={false}
              placeholder={view.refundPlaceholder}
              aria-invalid={refund.length > 0 && !refundOk}
              className="type-body mt-2 h-10 rounded-lg border-chad-border bg-chad-surface font-mono placeholder:font-sans"
            />
            <p className="type-small mt-2 text-chad-text-dim">
              whatever people do not claim in 7 days comes back here.{" "}
              <span className="text-chad-text">
                a wallet you hold the keys to. never an exchange deposit address:
              </span>{" "}
              exchanges do not credit contract transfers and the money is gone.
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Fact label={drop ? "people" : "receivers"} value={formatCount(view.people)} />
            <Fact
              label="people get"
              value={`${formatAmount(view.totalWei, decimals, 6)} ${nativeSymbol}`}
              accent
            />
            <Fact
              label="fee"
              value={view.feeBig ?? (fees === null ? "…" : "not sure")}
              sub={view.feeSmall}
            />
          </dl>

          {view.tokenFeeNote ? (
            <p className="type-small text-chad-text-dim">{view.tokenFeeNote}</p>
          ) : null}

          {view.feeFromMin && view.feeBps !== null ? (
            <p className="type-small text-chad-text-dim">
              {String(view.feeBps / 100)}% of this drop is less than the minimum fee, so the minimum
              applies.
            </p>
          ) : null}

          {error ? <p className="type-body text-chad-error">{error}</p> : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => dispatch({ type: "back" })}
              className="btn btn-secondary"
            >
              back
            </button>
            <Primary
              disabled={!step2Ok || busy || !submitAllowed({ devPreview, mode })}
              onClick={() => void submit()}
            >
              {busy
                ? drop
                  ? "making the drop…"
                  : "making the multisend…"
                : drop
                  ? "drop it"
                  : "send it"}
            </Primary>
          </div>
          {!busy && view.step2Reason ? (
            <p className="type-small text-chad-text-dim">{view.step2Reason}</p>
          ) : null}
        </section>
      ) : null}

      {step === 3 && created ? (
        <section className="mt-6">
          <p className="type-label mb-3">fund this address</p>
          <FundingCardFrom
            funding={created.funding}
            amountWei={created.drop.totalEntitlementsWei}
            feeWei={created.drop.feeAmountWei}
            warnings={created.warnings}
            kind={drop ? "drop" : "multisend"}
          />
          <WayBack mode={mode} address={created.drop.address} origin={window.location.origin} />
          <p className="type-body mt-4 flex items-center gap-2 text-chad-text-dim">
            <span className="live-dot size-2 rounded-full bg-chad-accent" aria-hidden="true" />
            {drop
              ? "watching the address. this page moves on the moment the money lands."
              : "watching the address. this page moves on the moment the money lands."}
          </p>
        </section>
      ) : null}
    </main>
  );
}

/** The url of a loaded page does not change under it: nothing to subscribe to. */
const noSubscribe = () => () => undefined;

/**
 * An amount from `GET /api/chains`: absent the design is zero, the old fee;
 * `null` (the chain did not answer) stays unknown, so the fee is never guessed.
 */
function amountOrZero(value: string | null | undefined): bigint | null {
  if (value === undefined) return 0n;
  return value === null ? null : BigInt(value);
}

function LineErrors({ errors }: { errors: readonly { line: number; message: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="type-table mt-3 space-y-1 text-chad-error">
      {errors.slice(0, 5).map((entry) => (
        <li key={entry.line}>
          line {entry.line}: {entry.message}
        </li>
      ))}
      {errors.length > 5 ? <li>and {errors.length - 5} more</li> : null}
    </ul>
  );
}

function Steps({ step }: { step: Step }) {
  const labels = ["who receives", "what and how much", "fund it"];
  return (
    <ol className="mt-4 flex gap-2" aria-label="steps">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        return (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span
              className={cn(
                "h-0.5 rounded-full",
                n <= step ? "bg-chad-accent" : "bg-chad-surface-2",
              )}
            />
            <span
              className={cn("type-small", n === step ? "text-chad-text" : "text-chad-text-dim")}
            >
              {n}. {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({
  label,
  value,
  accent = false,
  sub = null,
}: {
  label: string;
  value: string;
  accent?: boolean;
  /** One small grey line under the value, like `$15` under the fee. */
  sub?: string | null;
}) {
  return (
    <div className="card min-w-0 p-3">
      <dt className="type-label">{label}</dt>
      <dd className="mt-1 min-w-0">
        <FitNumber value={value} className={accent ? "text-chad-text" : undefined} />
        {sub ? <span className="type-small mt-0.5 block text-chad-text-dim">{sub}</span> : null}
      </dd>
    </div>
  );
}

function Primary({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="btn btn-primary mt-2 flex-1"
    >
      {children}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ChainSwitch } from "@/components/chains/ChainSwitch";
import {
  CHECK_DELAY_MS,
  amountCheckBody,
  blocksNext,
  checkOutcome,
  type AmountCheck,
} from "@/components/create/amount-check";
import { BetaNotice, BetaTick } from "@/components/create/BetaLines";
import { devPreviewEnabled, samplePreview, submitAllowed } from "@/components/create/dev-preview";
import { errorTone, explain } from "@/components/create/errors";
import {
  STEP_LABELS,
  createsOffFromChains,
  handleModesFromChains,
  handlesForSubmit,
  createLoginHref,
  initialForm,
  MULTISEND_REFUND_LINE,
  reduceForm,
  repeatNote,
  gifForSubmit,
  titleForSubmit,
  viewOf,
  type CreateMode,
  type Step,
} from "@/components/create/form";
import { GifField } from "@/components/create/GifField";
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
import { RowAmount, Ticker } from "@/components/site/Ticker";
import { useSession } from "@/components/site/SessionProvider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  checkDrop,
  createDrop,
  getChains,
  getTokenCheck,
  openLive,
  resolveHandles,
  type CreatedDrop,
} from "@/lib/api";
import { TESTNET_ONLY, type ChainPill } from "@/lib/chains";
import { readCsrfToken } from "@/lib/csrf";
import { afterCreatePath } from "@/lib/drop-path";
import { formatAmount, formatCount } from "@/lib/format";
import { isClosedTestnet } from "@/lib/pause";
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
 * Step names, `STEP_LABELS`: what and who, check it, fund it.
 *
 * 1. what and who: the chain first (robinhood or solana, whichever is live), then the box for the
 *    mode. Drop mode checks the handles on the phone, then **one paid lookup on `next`**: every
 *    handle must be found, or the page stays here and lists the misses.
 *    Multisend reads addresses as before. Count and total live.
 * 2. check it: in drop mode first the people it pays, name and avatar; then the
 *    chosen chain, read only, asset (native, the only one today), a title (no picture box: a
 *    drop with no picture shows the sender's X avatar),
 *    and the refund address with the exchange warning. The fee line is the chain's real
 *    `defaultFeeBps` from `GET /api/chains`, never a constant; until the api answers it says
 *    "…", and if the chain did not answer it says "not sure".
 * 3. fund it: the exact amount, the address, the QR. The page follows the stream and
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
    initialForm(start, initialMode, !TESTNET_ONLY),
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
      /** The minimum per receiver and the max fee, zero is off. */
      readonly perReceiver: bigint | null;
      readonly maxFee: bigint | null;
      readonly tiers: readonly TokenFeeTier[] | null;
    }
  > | null>(null);
  /** `handleMode` per registry key as the api said it, `null` until it answers. */
  const [apiHandleModes, setApiHandleModes] = useState<Record<string, boolean> | null>(null);
  /** New drops off per registry key, `createsOn` false. `null` until it answers. */
  const [apiCreatesOff, setApiCreatesOff] = useState<Record<string, boolean> | null>(null);
  // every chain off by the api switch on the testnet only site.
  const [testnetClosed, setTestnetClosed] = useState(false);
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
        setApiHandleModes(handleModesFromChains(chains));
        setApiCreatesOff(createsOffFromChains(chains));
        setTestnetClosed(isClosedTestnet(chains, TESTNET_ONLY));
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
      dispatch({
        type: "handleModes",
        value: apiHandleModes,
        ...(apiCreatesOff === null ? {} : { createsOff: apiCreatesOff }),
        testnetClosed,
      });
    }
  }, [devPreview, apiHandleModes, apiCreatesOff, testnetClosed, pills]);

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

  // The amount check on step 1: once step 1 is ready, the amounts go to the api half a
  // second after typing stops. One answer per body; `next` waits for the one on its way.
  const checkBody = useMemo(
    () =>
      step === 1 && step1Ok && !devPreview && chainKey !== null
        ? amountCheckBody({
            mode,
            chain: chainKey,
            family: view.family,
            asset: drop ? view.asset : "native",
            lines: drop
              ? handles.lines.map((l) => ({ key: l.handle, amountWei: l.amountWei }))
              : parsed.receivers.map((r) => ({ key: r.address, amountWei: r.amountWei })),
            hasErrors: false,
            tooMany: false,
          })
        : null,
    [step, step1Ok, devPreview, chainKey, mode, view.family, view.asset, drop, handles, parsed],
  );
  const checkKey = checkBody === null ? null : JSON.stringify(checkBody);
  const [checked, setChecked] = useState<{ forKey: string; check: AmountCheck } | null>(null);
  const inflight = useRef<{ forKey: string; answer: Promise<AmountCheck> } | null>(null);
  const unit = { decimals, token: view.tokenChosen, coin };
  const runCheck = (forKey: string, body: NonNullable<typeof checkBody>): Promise<AmountCheck> => {
    if (inflight.current?.forKey === forKey) return inflight.current.answer;
    const token = readCsrfToken();
    const answer: Promise<AmountCheck> =
      token === null
        ? Promise.resolve({ state: "unknown" })
        : checkDrop(body, token).then(
            () => checkOutcome(null, unit),
            (caught: unknown) => checkOutcome(caught, unit),
          );
    inflight.current = { forKey, answer };
    void answer.then((check) => {
      setChecked((current) => (current?.forKey === forKey ? current : { forKey, check }));
    });
    return answer;
  };
  useEffect(() => {
    if (checkKey === null || checkBody === null) return;
    if (inflight.current?.forKey === checkKey) return;
    const timer = setTimeout(() => void runCheck(checkKey, checkBody), CHECK_DELAY_MS);
    return () => clearTimeout(timer);
    // `runCheck` reads the latest render; the body's key is what decides a new check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);
  const amountCheck: AmountCheck | null =
    checked !== null && checked.forKey === checkKey ? checked.check : null;
  /** `next` on step 1: the check for these amounts first, then on unless it refused. */
  const afterCheck = async (go: () => void | Promise<void>) => {
    if (checkKey !== null && checkBody !== null) {
      const check = await runCheck(checkKey, checkBody);
      if (blocksNext(check)) return;
    }
    await go();
  };

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
  // A `0x` address is checked on Robinhood.
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
      setError(
        explain(caught, { decimals, token: view.tokenChosen, coin, closedTestnet: testnetClosed }),
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    // Never without the beta tick on mainnet, nor any other step 2 check.
    if (!step2Ok) return;
    if (!submitAllowed({ devPreview, mode })) {
      setError("dev preview: a drop is never sent from here.");
      return;
    }
    const token = readCsrfToken();
    if (token === null) {
      setError("sign in with X first.");
      return;
    }
    // each handle carries the X id the sender saw on step 2.
    const handleLines = drop ? handlesForSubmit(handles.lines, view.found) : null;
    // Never reached, where every name has its id; if it were, `next` asks again.
    if (drop && handleLines === null) {
      dispatch({ type: "handlesChanged" });
      return;
    }
    setBusy(true);
    setError(null);
    const sentTitle = titleForSubmit(form);
    const sentGif = gifForSubmit(form);
    const common = {
      ...(selectedPill?.chainKey ? { chain: selectedPill.chainKey } : {}),
      refundRecipient: refund.trim(),
      ...(sentTitle === undefined ? {} : { title: sentTitle }),
    };
    try {
      const result = await createDrop(
        drop
          ? {
              ...common,
              mode: "handle",
              ...(sentGif === undefined ? {} : { giphy: sentGif }),
              // `native`, or the checked mint on a token drop.
              asset: view.asset,
              handles: handleLines ?? [],
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
      // A name changed owner: back to step 1, where `next` asks X again.
      if (caught instanceof ApiError && caught.code === "handles_changed") {
        dispatch({ type: "handlesChanged" });
      }
      setError(
        explain(caught, { decimals, token: view.tokenChosen, coin, closedTestnet: testnetClosed }),
      );
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
        <a href={createLoginHref(mode)} className="btn btn-x mt-6">
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
          pauseLine={view.pauseLine}
          onChange={(next) => dispatch({ type: "mode", mode: next })}
        />
      )}
      {/* new drops off here, no steps, only the chain switch. */}
      {view.createsOff ? null : <Steps step={step} />}

      {step === 1 ? (
        <section className="mt-6">
          <p className="type-label mb-2">chain</p>
          <ChainSwitch
            pills={pills}
            value={chain}
            onChange={(key) => dispatch({ type: "chain", key })}
            allowAll={false}
          />
          {view.createsOff ? null : (
            <>
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
              {amountCheck !== null &&
              amountCheck.state === "refused" &&
              amountCheck.code === "drop_too_big" ? (
                <p className="type-small mt-2 text-chad-error">{amountCheck.message}</p>
              ) : null}
              <BetaNotice show={!TESTNET_ONLY} />
              {(drop ? handles.duplicates : parsed.duplicates) > 0 ? (
                <p className="type-small mt-2 text-chad-text-dim">
                  {drop
                    ? repeatNote(handles.duplicates, "handle")
                    : repeatNote(parsed.duplicates, "address")}
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
                  not found on X: {view.missing.map((handle) => `@${handle}`).join(", ")}. fix or
                  remove them.
                </p>
              ) : null}
              {amountCheck !== null &&
              amountCheck.state === "refused" &&
              amountCheck.code !== "drop_too_big" ? (
                <p className="type-body mt-3 text-chad-error">{amountCheck.message}</p>
              ) : null}
              {error ? <ErrorLine text={error} className="mt-3" /> : null}
              {drop ? (
                <Primary
                  disabled={!step1Ok || busy || blocksNext(amountCheck)}
                  onClick={() => void afterCheck(lookup)}
                >
                  {busy ? "checking the handles…" : "next"}
                </Primary>
              ) : (
                <Primary
                  disabled={!step1Ok || blocksNext(amountCheck)}
                  onClick={() => void afterCheck(() => dispatch({ type: "next" }))}
                >
                  next
                </Primary>
              )}
            </>
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
                    <RowAmount
                      amount={formatAmount(
                        amountOf.get(person.handle.toLowerCase()) ?? 0n,
                        decimals,
                        6,
                      )}
                      symbol={nativeSymbol}
                      className="type-table text-chad-text"
                      tickerClassName=""
                    />
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

          {drop ? (
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
          ) : null}

          <GifField
            mode={mode}
            value={form.gif}
            onChange={(value) => dispatch({ type: "gif", value })}
          />

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
            {view.refundShapeError ? (
              <p className="type-small mt-2 text-chad-error">{view.refundShapeError}</p>
            ) : null}
            <p className="type-small mt-2 text-chad-text-dim">
              {drop
                ? "whatever people do not claim in 3 days comes back here."
                : MULTISEND_REFUND_LINE}{" "}
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
              value={formatAmount(view.totalWei, decimals, 6)}
              unit={<Ticker symbol={nativeSymbol} />}
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

          {error ? <ErrorLine text={error} /> : null}

          <BetaTick
            show={!TESTNET_ONLY}
            checked={form.betaAccepted}
            onChange={(value) => dispatch({ type: "betaAccepted", value })}
          />

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
 * An amount from `GET /api/chains`: absent (an older api) is zero, the old fee;
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
  const labels = STEP_LABELS;
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
  unit,
}: {
  label: string;
  value: string;
  /** The ticker after the value, measured with it. */
  unit?: ReactNode;
  accent?: boolean;
  /** One small grey line under the value, like `$15` under the fee. */
  sub?: string | null;
}) {
  return (
    <div className="card min-w-0 p-3">
      <dt className="type-label">{label}</dt>
      <dd className="mt-1 min-w-0">
        <FitNumber value={value} unit={unit} className={accent ? "text-chad-text" : undefined} />
        {sub ? <span className="type-small mt-0.5 block text-chad-text-dim">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** The create error line: the closed testnet text in grey, every other line in red. */
function ErrorLine({ text, className }: { text: string; className?: string }) {
  return (
    <p
      className={cn(
        "type-body whitespace-pre-line",
        errorTone(text) === "calm" ? "text-chad-text-dim" : "text-chad-error",
        className,
      )}
    >
      {text}
    </p>
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

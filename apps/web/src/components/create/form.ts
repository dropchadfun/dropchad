/**
 * The create form, `/create`, as plain data. The component only renders this.
 *
 * The chain is chosen first, on step 1, above the receivers box. Everything the chain decides
 * comes from `viewOf`: the address shape, the decimals, the coin symbol, the placeholder. The
 * pasted list is re-read every time the chain or the text changes, so a solana list pasted under
 * the robinhood pill turns valid the moment the solana pill is tapped. Moving between steps
 * changes `step` only; nothing else is touched.
 *
 * **Two modes **. `drop` is first and the default: X handles
 * and amounts, checked on the phone, then one paid lookup on `next` that must find every handle
 * `multisend` is the address box as it always was. Each mode keeps its own
 * box. When `GET /api/chains` says `handleMode: false` for the chosen chain, `drop` cannot be
 * picked and the page is on `multisend`; until the api answers, `drop` is selected and `next`
 * waits.
 *
 * **The token box **: drop mode on Solana, at the top of step 1,
 * `SOL` or `token`. A pasted address is checked by `GET /api/tokens/:mint`; once it says ok, the
 * amounts are read in the token's decimals and the mint is what is sent. A token drop takes the
 * people of the last fee tier at most. Back to `SOL`, or another chain, clears the token;
 * the typed lines stay. On Robinhood since, `ETH` or `token`, only once the api
 * sends Robinhood `tokenFeeTiers`, so the box stays hidden until `DropFactoryV3` is deployed.
 */
import { MAX_PEOPLE, parseHandles, type ParsedHandles } from "@/components/create/handles";
import { parseReceivers, type ParsedList } from "@/components/create/receivers";
import {
  TOKEN_FEE_NOTE,
  aboutEth,
  aboutSol,
  mintOf,
  tierFor,
  tokenMax,
  type TokenCheckState,
  type TokenFeeTier,
} from "@/components/create/token";
import type { TokenCheck } from "@/lib/api";
import { isAddressFor, type ChainFamily, type ChainPill } from "@/lib/chains";
import { formatAmount } from "@/lib/format";
import { NO_TICKER } from "@/lib/token";

export type Step = 1 | 2 | 3;
export type CreateMode = "drop" | "multisend";
/** The token box: the chain's coin, or a token by its address. */
export type AssetChoice = "native" | "stable" | "token";

/** One handle the lookup found: what step 2 shows before the drop is made. */
export interface FoundHandle {
  readonly handle: string;
  readonly xUserId: string;
  readonly displayName: string;
  readonly profileImageUrl: string | null;
}

/** The answer of the one lookup on `next`, for exactly this handle text. */
export interface HandlePreview {
  readonly forText: string;
  readonly found: readonly FoundHandle[];
  readonly missing: readonly string[];
}

export interface FormState {
  readonly step: Step;
  readonly mode: CreateMode;
  readonly chain: string;
  /** Multisend: `address amount` per line. */
  readonly text: string;
  /** Drop: `@handle amount` per line. */
  readonly handleText: string;
  readonly preview: HandlePreview | null;
  /** `handleMode` per registry key from `GET /api/chains`, `null` until it answers. */
  readonly handleModes: Readonly<Record<string, boolean>> | null;
  /** Pill key to registry key, fixed at the start, so the reducer can read `handleModes`. */
  readonly chainKeys: Readonly<Record<string, string | null>>;
  readonly title: string;
  readonly refund: string;
  /** The token box, drop mode on Solana. */
  readonly asset: AssetChoice;
  /** The pasted token address, as typed. */
  readonly mintText: string;
  /** The check's answer for the pasted address, `null` until it comes. */
  readonly tokenCheck: TokenCheckState | null;
}

export type FormAction =
  | { type: "mode"; mode: CreateMode }
  | { type: "chain"; key: string }
  | { type: "text"; value: string }
  | { type: "handleText"; value: string }
  | { type: "preview"; preview: HandlePreview }
  | { type: "handleModes"; value: Readonly<Record<string, boolean>> }
  | { type: "title"; value: string }
  | { type: "refund"; value: string }
  | { type: "asset"; value: AssetChoice }
  | { type: "mintText"; value: string }
  | { type: "tokenCheck"; result: TokenCheckState }
  | { type: "next" }
  | { type: "back" }
  | { type: "created" };

/** The first live pill is selected from the start, so step 1 never validates against nothing. */
/**
 * The mode `/create` opens on: `?mode=multisend` is the front page's multisend link, anything
 * else is `drop`, the default. A chain with handle mode off still moves drop to multisend.
 */
export function modeFromSearch(value: string | string[] | undefined): CreateMode {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "multisend" ? "multisend" : "drop";
}

export function initialForm(pills: readonly ChainPill[], mode: CreateMode = "drop"): FormState {
  return {
    step: 1,
    mode,
    chain: pills.find((pill) => pill.selectable)?.key ?? "",
    text: "",
    handleText: "",
    preview: null,
    handleModes: null,
    chainKeys: Object.fromEntries(pills.map((pill) => [pill.key, pill.chainKey ?? null])),
    title: "",
    refund: "",
    asset: "native",
    mintText: "",
    tokenCheck: null,
  };
}

/** Back to the chain's coin: the token is forgotten, the typed lines stay. */
const NO_TOKEN = { asset: "native", mintText: "", tokenCheck: null } as const;

/** Whether `drop` can be picked on the chosen chain. `null` while the api has not answered. */
function dropAvailable(state: FormState): boolean | null {
  if (state.handleModes === null) return null;
  const chainKey = state.chainKeys[state.chain] ?? null;
  return chainKey !== null && state.handleModes[chainKey] === true;
}

/**
 * A mode change goes back to step 1, so a list is never sent without its own step 1 check. The
 * funding step stays: the drop exists by then.
 */
function withMode(state: FormState, mode: CreateMode): FormState {
  return { ...state, mode, step: state.step === 3 ? 3 : 1 };
}

/** Drop on a chain where it is off moves to multisend. */
function settle(state: FormState): FormState {
  return state.mode === "drop" && dropAvailable(state) === false
    ? withMode(state, "multisend")
    : state;
}

/** The refund part of `step2Reason`: empty, the wrong shape for the chain, or `null` when ok. */
function refundReason(refund: string, family: "evm" | "svm", drop: boolean): string | null {
  const value = refund.trim();
  if (value === "") return `add a refund address to ${drop ? "drop" : "send"} it.`;
  if (isAddressFor(value, family)) return null;
  return family === "svm"
    ? "this is not a Solana address."
    : "this is not a Robinhood address. it starts with 0x.";
}

/** The lookup answered for the text in the box, and X knows every handle. */
function previewClean(state: FormState): boolean {
  return (
    state.preview !== null &&
    state.preview.forText === state.handleText &&
    state.preview.missing.length === 0
  );
}

export function reduceForm(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "mode":
      if (action.mode === state.mode) return state;
      if (action.mode === "drop" && dropAvailable(state) === false) return state;
      return withMode(state, action.mode);
    case "chain":
      if (action.key === state.chain) return state;
      return settle({ ...state, chain: action.key, ...NO_TOKEN });
    case "handleModes":
      return settle({ ...state, handleModes: action.value });
    case "text":
      return { ...state, text: action.value };
    case "handleText":
      // An old lookup says nothing about new text.
      return { ...state, handleText: action.value, preview: null };
    case "preview": {
      // A lookup for text that has changed since is ignored.
      if (action.preview.forText !== state.handleText) return state;
      const next = { ...state, preview: action.preview };
      return state.step === 1 && previewClean(next) ? { ...next, step: 2 } : next;
    }
    case "title":
      return { ...state, title: action.value };
    case "refund":
      return { ...state, refund: action.value };
    case "asset":
      if (action.value === state.asset) return state;
      // `stable` and `token` are both a token drop; moving between them empties the address,
      // so a pasted token never shows under `stable`.
      return action.value === "native"
        ? { ...state, ...NO_TOKEN }
        : { ...state, asset: action.value, mintText: "", tokenCheck: null };
    case "mintText":
      // An old check says nothing about a new address.
      return { ...state, mintText: action.value, tokenCheck: null };
    case "tokenCheck":
      // An answer for an address no longer in the box is ignored. The answer only ever names
      // an address `mintOf` let through, so the trimmed text is enough, on either chain.
      if (action.result.forMint !== state.mintText.trim()) return state;
      return { ...state, tokenCheck: action.result };
    case "next":
      if (state.step !== 1) return state;
      // In drop mode the lookup moves the page; `next` alone only moves once it has.
      if (state.mode === "drop" && !previewClean(state)) return state;
      return { ...state, step: 2 };
    case "back":
      return state.step === 2 ? { ...state, step: 1 } : state;
    case "created":
      return { ...state, step: 3 };
  }
}

export interface FormView {
  readonly pill: ChainPill | undefined;
  readonly mode: CreateMode;
  /** The chosen chain's `handleMode`, `null` until the api answers. */
  readonly dropAvailable: boolean | null;
  /** Handle mode is off here: `drop` greyed, the paused line shown. */
  readonly paused: boolean;
  /** From `GET /api/chains`, `null` until it answers or when the chain did not. */
  readonly feeBps: number | null;
  /**
   * `min(max(total * bps / 10_000, minFee, minFeePerReceiver * people), maxFee)`, integer
   * division, a zero `maxFee` no cap: the same sum the chain does.
   * Every drop from this page is a native coin drop, the one kind the minimums apply to. `null`
   * while any number is unknown.
   */
  readonly feeWei: bigint | null;
  /** The flat minimum is the fee because the percent is below it. */
  readonly feeFromMin: boolean;
  /** Which part decided the fee; `null` while unknown and on a token drop. */
  readonly feeReason: FeeReason | null;
  /**
   * `fee 1%`, `minimum fee` (either minimum), `max fee`, or `fee` while the bps is unknown; `fee`
   * on a token drop.
   */
  readonly feeLabel: string;
  /**
   * The fee tile's big line: `0.01 SOL` on a SOL drop, `about
   * 0.08 SOL` on a token drop, the api's estimate. `null` while unknown.
   */
  readonly feeBig: string | null;
  /**
   * The small line under it, the part that decided the fee: `1%`,
   * `minimum fee`, `0.0003 SOL per person minimum`, or `max fee`; `$15` on a token drop.
   */
  readonly feeSmall: string | null;
  readonly grossWei: bigint | null;
  readonly family: ChainFamily;
  readonly decimals: number;
  readonly symbol: string;
  readonly placeholder: string;
  readonly refundPlaceholder: string;
  /** Multisend: the address box. */
  readonly parsed: ParsedList;
  /** Drop: the handle box. */
  readonly handles: ParsedHandles;
  /** People in drop mode, receivers in multisend mode. */
  readonly people: number;
  /** What people get, in base units of the chain, for the mode on screen. */
  readonly totalWei: bigint;
  /** The lookup's answer for the text in the box, empty otherwise. */
  readonly found: readonly FoundHandle[];
  readonly missing: readonly string[];
  readonly step1Ok: boolean;
  readonly refundOk: boolean;
  readonly step2Ok: boolean;
  /**
   * Why `drop it` or `send it` is grey, one line: only the
   * refund address. Paused and a token that is not ok already have their own line; `null` then.
   */
  readonly step2Reason: string | null;
  /** The grey line under `who gets it`; `paste a token first` until a token is ok. */
  readonly receiversHint: string;
  /** The step 1 total tile, `1,500 BONK`; the number alone until a token is ok. */
  readonly totalText: string;
  /** The token box shows: drop mode on Solana, or on Robinhood once the api sends its tiers. */
  readonly tokenBox: boolean;
  /** `token` is picked in the box, and the box shows. */
  readonly tokenChosen: boolean;
  /** The check's answer for the address in the box. */
  readonly tokenCheck: TokenCheck | null;
  /** Why there is no answer, in plain words. */
  readonly tokenError: string | null;
  /** The check said ok: the amounts are in the token. */
  readonly tokenOk: boolean;
  /** What `POST /api/drops` gets as `asset`: `native`, or the checked mint. */
  readonly asset: string;
  /** People a drop takes: 500, or on a token drop the end of the last tier. */
  readonly maxPeople: number;
  /** A token drop's fee tier for its people, `null` otherwise or when unknown. */
  readonly tokenTier: TokenFeeTier | null;
  /** The grey line under a Solana token drop's tiles; `null` elsewhere, Robinhood has no rent. */
  readonly tokenFeeNote: string | null;
}

/**
 * The part of the fee that decided it. A tie is said as the percent, then the flat minimum:
 * a minimum only "applies" when it is really bigger. `max` only when the cap cut it.
 */
export type FeeReason = "percent" | "minimum" | "perPerson" | "max";

/**
 * The native fee: the same steps as `nativeDropFee` in the api, `sol_drop_fee` and
 * `DropFactoryV4`. `null` when any number is unknown.
 */
export function nativeFeeOf(input: {
  readonly totalWei: bigint;
  readonly people: number;
  readonly bps: number | null;
  readonly minFee: bigint | null;
  readonly minFeePerReceiver: bigint | null;
  readonly maxFee: bigint | null;
}): { readonly wei: bigint; readonly reason: FeeReason } | null {
  const { bps, minFee, minFeePerReceiver, maxFee } = input;
  if (bps === null || minFee === null || minFeePerReceiver === null || maxFee === null) {
    return null;
  }
  const byBps = (input.totalWei * BigInt(bps)) / 10_000n;
  const perPerson = minFeePerReceiver * BigInt(input.people);
  let wei = byBps;
  let reason: FeeReason = "percent";
  if (minFee > wei) {
    wei = minFee;
    reason = "minimum";
  }
  if (perPerson > wei) {
    wei = perPerson;
    reason = "perPerson";
  }
  if (maxFee !== 0n && wei > maxFee) return { wei: maxFee, reason: "max" };
  return { wei, reason };
}

/** Everything on the screen that the chosen chain, the typed text and the chain's fee decide. */
export function viewOf(
  state: FormState,
  pills: readonly ChainPill[],
  feeBps: number | null = null,
  minFee: bigint | null = 0n,
  /** The signed in sender's handle: a drop cannot pay it. */
  ownHandle: string | null = null,
  /** `tokenFeeTiers` of the chosen chain from `GET /api/chains`. */
  tokenTiers: readonly TokenFeeTier[] | null = null,
  /** from `GET /api/chains`: zero is off; zero when an older api does not send it. */
  minFeePerReceiver: bigint | null = 0n,
  /** from `GET /api/chains`: zero is no cap. */
  maxFee: bigint | null = 0n,
): FormView {
  const pill = pills.find((candidate) => candidate.key === state.chain);
  const family = pill?.family ?? "evm";
  const coinDecimals = pill?.decimals ?? 18;
  const coinSymbol = pill?.nativeSymbol ?? "ETH";
  const drop = state.mode === "drop";
  const available = dropAvailable(state);

  // The token box: drop mode on Solana; on Robinhood only once the api sends its
  // tiers, which it does once `DropFactoryV3` is recorded.
  const tokenBox = drop && (family === "svm" || (tokenTiers !== null && tokenTiers.length > 0));
  const tokenChosen = tokenBox && state.asset !== "native";
  const mint = mintOf(state.mintText, family);
  const answer =
    tokenChosen && mint !== null && state.tokenCheck?.forMint === mint ? state.tokenCheck : null;
  const tokenCheck = answer !== null && "check" in answer ? answer.check : null;
  const tokenError = answer !== null && "error" in answer ? answer.error : null;
  const tokenDecimals = tokenCheck?.ok === true ? tokenCheck.decimals : null;
  const tokenOk = tokenCheck !== null && tokenDecimals !== null;
  // Until the check says ok, the lines are read in the coin's decimals and `next` waits.
  const decimals = tokenOk && tokenDecimals !== null ? tokenDecimals : coinDecimals;
  // A token picked from `stable` whose chain gives no ticker (devnet USDC) reads the button's
  // ticker, never `tokens`. A ticker the chain gives still wins.
  const stableTicker =
    state.asset === "stable"
      ? pill?.quickTokens.find((token) => token.address === mint)?.symbol
      : undefined;
  // No unit before the token is ok: the hint says `paste a token first`, never `token`.
  const symbol = tokenOk
    ? (tokenCheck.symbol ?? stableTicker ?? NO_TICKER)
    : tokenChosen
      ? ""
      : coinSymbol;
  const maxPeople = tokenChosen ? tokenMax(tokenTiers) : MAX_PEOPLE;

  const parsed = parseReceivers(state.text, { family, decimals: coinDecimals, symbol: coinSymbol });
  const handles = parseHandles(state.handleText, {
    decimals,
    symbol,
    ownHandle,
    max: maxPeople,
  });
  const current = state.preview !== null && state.preview.forText === state.handleText;
  const found = current ? (state.preview?.found ?? []) : [];
  const missing = current ? (state.preview?.missing ?? []) : [];

  const totalWei = drop ? handles.totalWei : parsed.totalWei;
  const refundOk = isAddressFor(state.refund.trim(), family);
  // A token drop's fee is a usd tier paid in SOL, never a percent of the token.
  const nativeFee = tokenChosen
    ? null
    : nativeFeeOf({
        totalWei,
        people: drop ? handles.people : parsed.receivers.length,
        bps: feeBps,
        minFee,
        minFeePerReceiver,
        maxFee,
      });
  const feeWei = nativeFee?.wei ?? null;
  const feeReason = nativeFee?.reason ?? null;
  const feeFromMin = feeReason === "minimum";
  const feeLabel =
    feeBps === null || tokenChosen
      ? "fee"
      : feeReason === "minimum" || feeReason === "perPerson"
        ? "minimum fee"
        : feeReason === "max"
          ? "max fee"
          : `fee ${String(feeBps / 100)}%`;
  const tokenOkForSend = !tokenChosen || tokenOk;
  const tokenTier = tokenChosen ? tierFor(tokenTiers, handles.people) : null;

  const step2Reason =
    pill?.selectable !== true ||
    (drop && (available !== true || !previewClean(state))) ||
    !tokenOkForSend
      ? null
      : refundReason(state.refund, family, drop);

  const step1Ok = drop
    ? available === true &&
      handles.lines.length > 0 &&
      handles.errors.length === 0 &&
      !handles.tooMany &&
      missing.length === 0 &&
      tokenOkForSend
    : parsed.receivers.length > 0 && parsed.errors.length === 0;

  return {
    pill,
    mode: state.mode,
    dropAvailable: available,
    paused: available === false,
    feeBps,
    feeWei,
    feeFromMin,
    feeReason,
    feeLabel,
    grossWei: feeWei === null ? null : totalWei + feeWei,
    family,
    decimals,
    symbol,
    placeholder: drop
      ? "@alice 0.01\n@bob 0.01"
      : family === "svm"
        ? "G5wp… 0.01\nCVDF… 0.01"
        : "0xabc… 0.01\n0xdef… 0.01",
    refundPlaceholder:
      family === "svm"
        ? "paste your Solana wallet address"
        : "paste your Robinhood wallet address, 0x…",
    parsed,
    handles,
    people: drop ? handles.people : parsed.receivers.length,
    totalWei,
    found,
    missing,
    step1Ok,
    refundOk,
    step2Ok:
      pill?.selectable === true &&
      refundOk &&
      state.title.trim().length <= 80 &&
      (!drop || (available === true && previewClean(state))) &&
      tokenOkForSend,
    step2Reason,
    receiversHint: !drop
      ? `one per line: address, then amount in ${coinSymbol}. paste from a sheet, it will read it.`
      : symbol === ""
        ? state.asset === "stable"
          ? "one per line: an X handle, then amount. pick a stable first."
          : "one per line: an X handle, then amount. paste a token first."
        : `one per line: an X handle, then amount in ${symbol}. paste from a sheet, it will read it.`,
    totalText: `${formatAmount(totalWei, drop ? decimals : coinDecimals, 6)}${
      (drop ? symbol : coinSymbol) === "" ? "" : ` ${drop ? symbol : coinSymbol}`
    }`,
    tokenBox,
    tokenChosen,
    tokenCheck,
    tokenError,
    tokenOk,
    asset: tokenChosen && tokenOk && tokenCheck !== null ? tokenCheck.mint : "native",
    maxPeople,
    tokenTier,
    tokenFeeNote: tokenChosen && family === "svm" ? TOKEN_FEE_NOTE : null,
    feeBig: tokenChosen
      ? family === "evm"
        ? tokenTier?.wei
          ? aboutEth(tokenTier.wei)
          : null
        : tokenTier?.lamports
          ? aboutSol(tokenTier.lamports)
          : null
      : feeWei === null
        ? null
        : `${formatAmount(feeWei, coinDecimals, 6)} ${coinSymbol}`,
    feeSmall: tokenChosen
      ? tokenTier
        ? `$${tokenTier.usd}`
        : null
      : feeBps === null || feeReason === null
        ? null
        : feeReason === "minimum"
          ? "minimum fee"
          : feeReason === "perPerson"
            ? `${formatAmount(minFeePerReceiver ?? 0n, coinDecimals, 6)} ${coinSymbol} per person minimum`
            : feeReason === "max"
              ? "max fee"
              : `${String(feeBps / 100)}%`,
  };
}

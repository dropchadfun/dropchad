import { BETA_NOTICE, BETA_TICK } from "@/lib/beta";

/**
 * The beta notice on step 1. Nothing on testnet. `text` is the
 * notice of the live chains; absent, the notice with no api answer.
 */
export function BetaNotice({
  show,
  text = BETA_NOTICE,
}: {
  show: boolean;
  text?: string | undefined;
}) {
  if (!show) return null;
  return <p className="type-small mt-2 text-chad-text-dim">{text}</p>;
}

/**
 * The tick box on step 2: the box and its words are one tap target. Nothing on
 * testnet. The 44px target is 24px taller than its words; `-mt-3 mb-3` take that back, so the
 * row sits 24px from its neighbours like the other step 2 rows. Not `-my-3`: the
 * parent's `space-y-6` gap is this row's `margin-block-end` with no specificity, so `-my-3`
 * would replace it and leave no gap below.
 */
export function BetaTick({
  show,
  checked,
  onChange,
}: {
  show: boolean;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!show) return null;
  return (
    <label className="type-small -mt-3 mb-3 flex min-h-11 cursor-pointer items-center gap-3 text-chad-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 shrink-0 accent-chad-accent"
      />
      {BETA_TICK}
    </label>
  );
}

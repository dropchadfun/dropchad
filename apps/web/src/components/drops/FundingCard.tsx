"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Wallet } from "lucide-react";
import QRCode from "qrcode";

import { CopyButton } from "@/components/site/CopyButton";
import { DISPLAY_FIT_STEPS, FitNumber } from "@/components/site/FitNumber";
import { QuickTokenLogo } from "@/components/site/QuickTokenLogo";
import { Skeleton } from "@/components/site/Skeleton";
import { warningParts } from "@/components/drops/funding-warning";
import {
  fundingLimitLine,
  fundingParts,
  noWalletLine,
  payButtonShows,
  payLabel,
  payLink,
  type FundingPart,
} from "@/components/drops/funding";
import { testnetWarningLines } from "@/components/drops/testnet-warning";
import type { Funding } from "@/lib/api";
import {
  TESTNET_ONLY,
  chainName,
  decimalsOf,
  familyOf,
  nativeSymbol,
  type ChainFamily,
} from "@/lib/chains";
import { exactAmount, formatAmount } from "@/lib/format";

/**
 * "Fund this address." The exact amount, the address with copy, and a real QR of the EIP 681
 * uri: the address shown is the one the api read back from `DropCreated`,
 * and the plain address is always next to the QR because not every wallet reads `ethereum:`.
 *
 * The fee line is shown even at zero, so the screen is ready for the 1% fee.
 *
 * A token drop: two parts to the
 * same drop address, each with its own amount, QR and `copy amount`: the tokens first, then the
 * SOL, the fee and the receivers' token accounts. Only the drop address, never the vault
 * The drop starts only when both have landed. On Robinhood the
 * second part is the ETH fee. Each part has `pay with wallet`, its own payment link, on both
 * chains.
 *
 * `pay with wallet`: on a phone only, after the copy
 * buttons, the same link as the QR, and a grey line under it for when no wallet opens. Never on
 * a computer, never in the server rendered page; the QR and the copy buttons always stay.
 *
 * a tap opens the wallet at once, no menu.
 * On Robinhood the button is MetaMask's send link, the QR keeps the plain `ethereum:` link. The
 * grey line says which app opens.
 *
 * The part of a warning the api marks with `**` is bold and `--chad-error`: the
 * refund to an exchange address is the one way a sender loses money for good.
 *
 * While the site is testnet only, a mint bordered box right above the amount to send says to
 * switch the wallet to the drop's own test network.
 */
export function FundingCard({
  address,
  chainId,
  amountWei,
  feeWei,
  grossWei,
  paymentUri,
  warnings,
  kind = "drop",
  fundingDeadline,
  phone,
}: {
  address: string;
  chainId: number;
  amountWei: string;
  feeWei: string;
  grossWei: string;
  paymentUri: string;
  warnings?: readonly string[];
  /** A multisend is never called a drop. */
  kind?: "drop" | "multisend";
  /** The api's unix seconds; the funding limit line. Absent, no line. */
  fundingDeadline?: string;
  /** The phone check; the browser's own `(pointer: coarse)` read when absent. */
  phone?: boolean;
}) {
  const detected = usePhone();
  const showPay = phone ?? detected;
  const family = familyOf(chainId);
  const symbol = nativeSymbol(chainId);
  const decimals = decimalsOf(chainId);
  const limit = fundingDeadline === undefined ? null : fundingLimitLine(fundingDeadline, kind);
  const hasWarnings = warnings !== undefined && warnings.length > 0;

  return (
    <div className="card p-4">
      {TESTNET_ONLY ? <TestnetWarning chainId={chainId} kind={kind} /> : null}
      <p className="type-label">send this amount</p>
      {/* Exact, every decimal, no comma: the same number `copy amount` copies. */}
      <FitNumber
        value={exactAmount(grossWei, decimals)}
        steps={DISPLAY_FIT_STEPS}
        className="mt-1"
        unit={<span className="type-body font-medium text-chad-text-dim">{symbol}</span>}
      />
      <dl className="type-body mt-3 grid grid-cols-2 gap-x-4 gap-y-1 md:max-w-sm">
        <dt className="text-chad-text-dim">people get</dt>
        <dd className="num text-right">
          {formatAmount(amountWei, decimals, 8)} {symbol}
        </dd>
        <dt className="text-chad-text-dim">dropchad fee</dt>
        <dd className="num text-right">
          {formatAmount(feeWei, decimals, 8)} {symbol}
        </dd>
        <dt className="text-chad-text-dim">chain</dt>
        <dd className="text-right">{chainName(chainId)}</dd>
      </dl>
      {limit ? <p className="type-small mt-3 text-chad-text-dim">{limit}</p> : null}

      <div className="mt-5 flex flex-col items-center gap-4 md:flex-row md:items-start">
        <PaymentQr uri={paymentUri} />
        {/* Full card width on a phone, so the address box is as wide as it can be. */}
        <div className="min-w-0 flex-1 self-stretch md:self-auto">
          <p className="type-label">
            {kind === "multisend" ? "multisend address" : "drop address"}
          </p>
          <DropAddress address={address} />
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={address} label="copy address" />
            <CopyButton value={exactAmount(grossWei, decimals)} label="copy amount" />
            {showPay ? (
              <PayButton
                uri={payLink(family, paymentUri)}
                label={payLabel({ amountBaseUnits: grossWei, decimals, symbol, address })}
              />
            ) : null}
          </div>
          {showPay ? <NoWalletLine family={family} /> : null}
          <p className="type-small mt-3 text-chad-text-dim">
            {/* Once: the api's first warning already says it on `/create`. */}
            {hasWarnings
              ? null
              : "a plain transfer is enough. nothing to sign, no wallet to connect. "}
            {kind === "multisend" ? "it starts" : "the drop starts"} by itself the moment the money
            lands.
          </p>
        </div>
      </div>

      <Warnings warnings={warnings} />
    </div>
  );
}

/**
 * The funding card from a funding answer, the create page and the drop page alike
 * 5b: the amount to send is the answer's, never `grossRequiredWei`, which on a token drop is the
 * token total. A token drop gets the two part card.
 */
export function FundingCardFrom({
  funding,
  amountWei,
  feeWei,
  warnings,
  kind,
  phone,
}: {
  funding: Funding;
  amountWei: string;
  feeWei: string;
  warnings?: readonly string[];
  kind?: "drop" | "multisend";
  /** The phone check; the browser's own `(pointer: coarse)` read when absent. */
  phone?: boolean;
}) {
  if (funding.token !== undefined) {
    return <TokenFundingCard funding={funding} {...(phone === undefined ? {} : { phone })} />;
  }
  return (
    <FundingCard
      address={funding.address}
      chainId={funding.chainId}
      amountWei={amountWei}
      feeWei={feeWei}
      grossWei={funding.amountBaseUnits}
      paymentUri={funding.paymentUri}
      {...(warnings === undefined ? {} : { warnings })}
      {...(kind === undefined ? {} : { kind })}
      fundingDeadline={funding.fundingDeadline}
      {...(phone === undefined ? {} : { phone })}
    />
  );
}

/**
 * A token drop, simple enough for anyone: the tokens, then the SOL, each with its amount, QR and copy; one drop address
 * for both; four short lines. The api's long warnings are not repeated here.
 */
function TokenFundingCard({ funding, phone }: { funding: Funding; phone?: boolean }) {
  const detected = usePhone();
  const showPay = phone ?? detected;
  const [tokens, native] = fundingParts(funding) as [FundingPart, FundingPart];
  const limit = fundingLimitLine(funding.fundingDeadline, "drop");
  return (
    <div className="card p-4">
      {TESTNET_ONLY ? <TestnetWarning chainId={funding.chainId} kind="drop" /> : null}
      <PartAmount
        label="1. send the tokens"
        part={tokens}
        logo={
          funding.token ? (
            <QuickTokenLogo chainId={funding.chainId} mint={funding.token.mint} size={20} />
          ) : null
        }
      />
      <dl className="type-body mt-3 grid grid-cols-2 gap-x-4 gap-y-1 md:max-w-sm">
        {/* No people get line: it repeated the big amount just above. */}
        <dt className="text-chad-text-dim">chain</dt>
        <dd className="text-right">{chainName(funding.chainId)}</dd>
      </dl>
      <PartPay part={tokens} address={funding.address} family={funding.family} showPay={showPay} />

      <div className="mt-6 border-t border-chad-border pt-4">
        <PartAmount label={`2. send the ${native.symbol}`} part={native} />
        <p className="type-small mt-2 text-chad-text-dim">
          {funding.family === "evm" ? "for the fee." : "for the fee and the token accounts."}
        </p>
        <PartPay
          part={native}
          address={funding.address}
          family={funding.family}
          showPay={showPay}
        />
      </div>

      <div className="mt-6 border-t border-chad-border pt-4">
        <p className="type-label">drop address</p>
        <DropAddress address={funding.address} />
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton value={funding.address} label="copy address" />
        </div>
        <ul className="type-small mt-4 space-y-1 text-chad-text-dim">
          <li>send both to this address.</li>
          <li>check it before you send.</li>
          <li>unused money goes back to your wallet.</li>
          <li>never use an exchange address.</li>
        </ul>
        {limit ? <p className="type-small mt-3 text-chad-text-dim">{limit}</p> : null}
      </div>
    </div>
  );
}

/**
 * The drop address, whole, on one unbroken line (after a real
 * iPhone): the size follows the width of its box, `.funding-address-box`, so the 44 letters fit
 * on any phone. Never cut, never shortened, no halves.
 */
function DropAddress({ address }: { address: string }) {
  return (
    <div className="funding-address-box mt-1">
      <p className="funding-address type-body font-mono">{address}</p>
    </div>
  );
}

/**
 * The one screen where someone could send real money: a mint bordered box,
 * never small grey text, naming only the drop's own test network.
 */
function TestnetWarning({ chainId, kind }: { chainId: number; kind: "drop" | "multisend" }) {
  const [title, ...lines] = testnetWarningLines(chainId, kind);
  return (
    <div data-testnet-warning="" className="mb-4 rounded-lg border border-chad-accent p-3">
      <p className="type-body font-medium">{title}</p>
      {lines.map((line) => (
        <p key={line} className="type-body text-chad-text">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * One part's label and its exact amount, every decimal, no comma, like `copy amount`. A quick
 * token's logo sits left of the amount.
 */
function PartAmount({
  label,
  part,
  logo = null,
}: {
  label: string;
  part: FundingPart;
  logo?: ReactNode;
}) {
  const amount = (
    <FitNumber
      value={exactAmount(part.amountBaseUnits, part.decimals)}
      steps={DISPLAY_FIT_STEPS}
      className={logo ? "min-w-0 flex-1" : "mt-1"}
      unit={<span className="type-body font-medium text-chad-text-dim">{part.symbol}</span>}
    />
  );
  return (
    <>
      <p className="type-label">{label}</p>
      {logo ? (
        <div className="mt-1 flex items-center gap-2">
          {logo}
          {amount}
        </div>
      ) : (
        amount
      )}
    </>
  );
}

/**
 * One part's QR of its own payment link, `copy amount`, and on a phone `pay with wallet`, the
 * same link as the QR (EIP-681 or Solana Pay). Not every wallet opens it, so the QR and
 * the copy stay. The button says this part's own amount and symbol, to the drop address.
 */
function PartPay({
  part,
  address,
  family,
  showPay,
}: {
  part: FundingPart;
  address: string;
  family: ChainFamily;
  showPay: boolean;
}) {
  return (
    <div className="mt-4 flex flex-col items-center gap-4 md:flex-row md:items-end">
      <PaymentQr uri={part.paymentUri} />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <CopyButton
            value={exactAmount(part.amountBaseUnits, part.decimals)}
            label="copy amount"
          />
          {showPay ? (
            <PayButton
              uri={payLink(family, part.paymentUri)}
              label={payLabel({ ...part, address })}
            />
          ) : null}
        </div>
        {showPay ? <NoWalletLine family={family} /> : null}
      </div>
    </div>
  );
}

/**
 * `pay with wallet`: a plain link the wallet app opens, no wallet connect. Its words say
 * what the link pays and where, `pay 1.01 SOL to …pY3o`.
 */
function PayButton({ uri, label }: { uri: string; label: string }) {
  return (
    <a href={uri} className="btn btn-secondary h-9 shrink-0 gap-1.5 px-3">
      <Wallet className="size-4 text-chad-accent" aria-hidden="true" />
      {label}
    </a>
  );
}

function NoWalletLine({ family }: { family: ChainFamily }) {
  return <p className="type-small mt-2 text-chad-text-dim">{noWalletLine(family)}</p>;
}

const COARSE_POINTER = "(pointer: coarse)";

function subscribePointer(onChange: () => void): () => void {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** A phone; `false` in the server rendered page and before hydration. */
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePointer,
    () => payButtonShows({ coarsePointer: window.matchMedia(COARSE_POINTER).matches }),
    () => false,
  );
}

function PaymentQr({ uri }: { uri: string }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(uri, {
      margin: 1,
      width: 480,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return (
    <div className="flex size-44 shrink-0 items-center justify-center rounded-xl bg-white p-2">
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- data url, generated here
        <img src={qr} alt="QR code of the payment link" className="size-full" />
      ) : (
        <Skeleton className="size-full" />
      )}
    </div>
  );
}

function Warnings({ warnings }: { warnings: readonly string[] | undefined }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    // `break-words`: a long address in the text breaks inside the card, never past its edge
    <ul className="type-small mt-4 space-y-1 break-words text-chad-text-dim">
      {warnings.map((warning) => (
        <li key={warning}>
          ·{" "}
          {warningParts(warning).map((part, i) =>
            part.strong ? (
              <strong key={i} className="font-semibold text-chad-error">
                {part.text}
              </strong>
            ) : (
              part.text
            ),
          )}
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Wallet } from "lucide-react";
import QRCode from "qrcode";

import { CopyButton } from "@/components/site/CopyButton";
import { DISPLAY_FIT_STEPS, FitNumber } from "@/components/site/FitNumber";
import { QuickTokenLogo } from "@/components/site/QuickTokenLogo";
import { Skeleton } from "@/components/site/Skeleton";
import { assetHalves } from "@/components/create/token";
import { warningParts } from "@/components/drops/funding-warning";
import { fundingLimitLine, fundingParts, type FundingPart } from "@/components/drops/funding";
import { testnetWarningLines } from "@/components/drops/testnet-warning";
import type { Funding } from "@/lib/api";
import { TESTNET_ONLY, chainName, decimalsOf, nativeSymbol } from "@/lib/chains";
import { exactAmount, formatAmount } from "@/lib/format";

/**
 * "Fund this address." The exact amount, the address with copy, and a real QR of the EIP 681
 * uri.: the address shown is the one the api read back from `DropCreated`,
 * and the plain address is always next to the QR because not every wallet reads `ethereum:`.
 *
 * The fee line is shown even at zero, so the screen is ready for the 1% fee.
 *
 * A token drop: two parts to the
 * same drop address, each with its own amount, QR and `copy amount`: the tokens first, then the
 * SOL, the fee and the receivers' token accounts. Only the drop address, never the vault
 * The drop starts only when both have landed. On Robinhood the
 * second part is the ETH fee. Each part has `open in wallet`, its own payment link, on both
 * chains.
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
}) {
  const symbol = nativeSymbol(chainId);
  const decimals = decimalsOf(chainId);
  const limit = fundingDeadline === undefined ? null : fundingLimitLine(fundingDeadline, kind);

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
        <div className="min-w-0 flex-1">
          <p className="type-label">
            {kind === "multisend" ? "multisend address" : "drop address"}
          </p>
          <HalvedAddress address={address} />
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={address} label="copy address" />
            <CopyButton value={exactAmount(grossWei, decimals)} label="copy amount" />
          </div>
          <p className="type-small mt-3 text-chad-text-dim">
            a plain transfer is enough. nothing to sign, no wallet to connect.{" "}
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
 * The funding card from a funding answer, the create page and the drop page alike, token step
 * 5b: the amount to send is the answer's, never `grossRequiredWei`, which on a token drop is the
 * token total. A token drop gets the two part card.
 */
export function FundingCardFrom({
  funding,
  amountWei,
  feeWei,
  warnings,
  kind,
}: {
  funding: Funding;
  amountWei: string;
  feeWei: string;
  warnings?: readonly string[];
  kind?: "drop" | "multisend";
}) {
  if (funding.token !== undefined) {
    return <TokenFundingCard funding={funding} />;
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
    />
  );
}

/**
 * A token drop, simple enough for anyone (after the live test
 * ): the tokens, then the SOL, each with its amount, QR and copy; one drop address
 * for both; four short lines. The api's long warnings are not repeated here.
 */
function TokenFundingCard({ funding }: { funding: Funding }) {
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
      <PartPay part={tokens} />

      <div className="mt-6 border-t border-chad-border pt-4">
        <PartAmount label={`2. send the ${native.symbol}`} part={native} />
        <p className="type-small mt-2 text-chad-text-dim">
          {funding.family === "evm" ? "for the fee." : "for the fee and the token accounts."}
        </p>
        <PartPay part={native} />
      </div>

      <div className="mt-6 border-t border-chad-border pt-4">
        <p className="type-label">drop address</p>
        <HalvedAddress address={funding.address} />
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
 * The drop address in two even unbroken halves, the same as step 2's asset row: on the phone two
 * equal lines, never one character alone on the last one.
 */
function HalvedAddress({ address }: { address: string }) {
  return (
    <p className="type-body mt-1 font-mono">
      {assetHalves(address).map((half) => (
        <span key={half} className="inline-block whitespace-nowrap">
          {half}
        </span>
      ))}
    </p>
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
 * One part's QR of its own payment link, `copy amount`, and `open in wallet`, the same link as
 * the QR: on a phone it opens the wallet app (EIP-681 or Solana Pay). Not every wallet opens it,
 * so the QR and the copy stay.
 */
function PartPay({ part }: { part: FundingPart }) {
  return (
    <div className="mt-4 flex flex-col items-center gap-4 md:flex-row md:items-end">
      <PaymentQr uri={part.paymentUri} />
      <div className="flex flex-wrap gap-2">
        <CopyButton value={exactAmount(part.amountBaseUnits, part.decimals)} label="copy amount" />
        <a href={part.paymentUri} className="btn btn-secondary h-9 shrink-0 gap-1.5 px-3">
          <Wallet className="size-4 text-chad-accent" aria-hidden="true" />
          open in wallet
        </a>
      </div>
    </div>
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
    <ul className="type-small mt-4 space-y-1 text-chad-text-dim">
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

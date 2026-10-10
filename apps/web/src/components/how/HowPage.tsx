import Link from "next/link";
import type { ReactNode } from "react";
import {
  AtSign,
  Ban,
  ClipboardPaste,
  Coins,
  FileCode2,
  Link2,
  ListChecks,
  Lock,
  LogIn,
  MousePointerClick,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { CopyButton } from "@/components/site/CopyButton";
import { Section } from "@/components/site/Section";
import type { ChainInfo } from "@/lib/api";
import { chainPills, tokenExplorerUrl, type ChainPill } from "@/lib/chains";

import {
  CAN,
  CLAIM_STEPS,
  FAQ,
  NEXT,
  SAFE_LINES,
  SEND_STEPS,
  TESTNET,
  WHY_GROUPS,
  feeLines,
} from "./how";

/**
 * The how it works page, `/how`. For
 * people new to crypto, simple words, one column. The title on one line (`h1-fit`), why
 * dropchad in a card, what you can do (drop, token drop, multisend), then the steps, safety, fees,
 * testnet, coming next and the questions. Steps are lucide icons in numbered cards, no
 * screenshots. `chains` is the api's `GET /api/chains`, `null` when it did not answer.
 */
export function HowPage({ chains }: { chains: readonly ChainInfo[] | null }) {
  const fees = feeLines(chains);
  const pills = new Map(chainPills().map((pill) => [pill.key, pill]));
  return (
    <main className="mx-auto w-full max-w-160 px-4 pt-6 pb-10 md:pt-10">
      <h1 className="type-h1-fit">send crypto to anyone on X, by username.</h1>

      <Section title="why dropchad">
        <div data-why-card="" className="card divide-y divide-chad-border">
          {WHY_GROUPS.map((group) => (
            <div key={group[0]} data-why-group="" className="type-body px-4 py-3">
              {group.map((line) => (
                <p key={line} data-why="">
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="what you can do">
        <ul className="grid gap-2 md:grid-cols-3">
          {CAN.map((item) => (
            <li key={item.key} data-can={item.key} className="card flex flex-col gap-2 p-4">
              <span className="flex gap-1">
                {item.chains.length === 0 ? (
                  <span className="tile bg-chad-surface-2">
                    <ListChecks className="size-4 text-chad-accent" aria-hidden="true" />
                  </span>
                ) : (
                  item.chains.map((key) => {
                    const pill = pills.get(key);
                    return pill === undefined ? null : <ChainTile key={key} pill={pill} />;
                  })
                )}
              </span>
              <span className="type-body font-medium">{item.title}</span>
              <span className="type-body text-chad-text-dim">{item.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="how to send">
        <Steps icons={[Link2, Coins, AtSign, Wallet, Rocket]} steps={SEND_STEPS} />
      </Section>

      <Section title="how to claim">
        <Steps icons={[LogIn, ClipboardPaste, MousePointerClick]} steps={CLAIM_STEPS} />
        <p className="type-body mt-3 text-chad-text-dim">
          no wallet connect. you pay no gas: we pay it.
        </p>
      </Section>

      <Section title="why it is safe">
        <ul className="card divide-y divide-chad-border">
          {SAFE_LINES.map((line, i) => {
            const Icon = [FileCode2, Users, RotateCcw, Lock, Ban][i] ?? ShieldCheck;
            return (
              <li key={line} className="type-body flex items-start gap-3 px-4 py-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-chad-accent" aria-hidden="true" />
                {line}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="fees">
        <div className="card type-body px-4 py-3">
          {fees === null ? (
            <p>
              the fee shows on step 2 of a drop.{" "}
              <Link href="/create" className="text-chad-accent hover:underline">
                the create page shows the fee
              </Link>{" "}
              before you pay anything.
            </p>
          ) : (
            <>
              {fees.coins.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {fees.tiers.length > 0 ? (
                <>
                  <p className="mt-3">
                    token drops: a flat fee by the number of people, paid in SOL or ETH.
                  </p>
                  <ul className="mt-1 text-chad-text-dim">
                    {fees.tiers.map((line) => (
                      <li key={line} className="tabular-nums">
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3">never a % of your token.</p>
                </>
              ) : null}
            </>
          )}
        </div>
      </Section>

      <Section id="testnet" title="try it on testnet">
        <p className="type-body text-chad-text-dim">free test coins. they have no value.</p>

        <h3 className="type-h2 mt-4">Solana devnet, with Phantom</h3>
        <ol className="type-body mt-2 list-decimal space-y-1 pl-5">
          <li>
            in Phantom: {TESTNET.solana.phantomPath}, then pick {TESTNET.solana.network}.
          </li>
          <li>
            get free devnet SOL at{" "}
            <ExtLink href={TESTNET.solana.faucet.href}>{TESTNET.solana.faucet.label}</ExtLink>.
          </li>
        </ol>

        <h3 className="type-h2 mt-5">Robinhood testnet, with MetaMask</h3>
        <p className="type-body mt-2">in MetaMask, add a custom network:</p>
        <dl className="card mt-2 divide-y divide-chad-border">
          <Row label="network name" value={TESTNET.robinhood.network.name} />
          <Row label="RPC URL" value={TESTNET.robinhood.network.rpc} />
          <Row label="chain ID" value={TESTNET.robinhood.network.chainId} />
          <Row label="currency symbol" value={TESTNET.robinhood.network.symbol} />
          <Row label="block explorer" value={TESTNET.robinhood.network.explorer} />
        </dl>
        <p className="type-body mt-3">
          get free test ETH at{" "}
          <ExtLink href={TESTNET.robinhood.faucets[0].href}>
            {TESTNET.robinhood.faucets[0].label}
          </ExtLink>
          , or at{" "}
          <ExtLink href={TESTNET.robinhood.faucets[1].href}>
            {TESTNET.robinhood.faucets[1].label}
          </ExtLink>
          .
        </p>

        <h3 className="type-h2 mt-5">test tokens</h3>
        <ul className="card mt-2 divide-y divide-chad-border">
          {TESTNET.tokens.map((token) => {
            const explorer = tokenExplorerUrl(token.chainId, token.address);
            return (
              <li key={token.address} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="type-body font-medium">{token.symbol}</span>
                    <span className="type-small text-chad-text-dim">{token.chain}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <CopyButton value={token.address} compact />
                    {explorer === null ? null : (
                      <ExtLink href={explorer} className="type-small px-2 whitespace-nowrap">
                        explorer ↗
                      </ExtLink>
                    )}
                  </span>
                </div>
                <p className="type-small mt-1 font-mono break-all text-chad-text-dim">
                  {token.address}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="type-body mt-3">
          <ExtLink href="https://t.me/dropchad">ask us on Telegram for test tokens</ExtLink>.
        </p>
      </Section>

      <Section title="coming next">
        <ul className="type-body flex flex-wrap gap-2">
          {NEXT.map((item) => (
            <li key={item} data-next="" className="card px-3 py-1.5">
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="questions">
        <dl className="space-y-4">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="type-body font-medium">{item.q}</dt>
              <dd className="type-body mt-1 text-chad-text-dim">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </main>
  );
}

/** A chain logo on its brand tile, as on the chain rail. */
function ChainTile({ pill }: { pill: ChainPill }) {
  return (
    <span className="tile" style={{ background: pill.tileColor }} title={pill.name}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static svg, no sizing needed */}
      <img
        src={pill.logo}
        alt=""
        width={16}
        height={16}
        className="block object-contain"
        style={{ width: 16 * pill.markScale, height: 16 * pill.markScale }}
      />
    </span>
  );
}

/** Numbered steps, each with its icon, in one card. */
function Steps({ steps, icons }: { steps: readonly { text: string }[]; icons: LucideIcon[] }) {
  return (
    <ol className="card divide-y divide-chad-border">
      {steps.map((step, i) => {
        const Icon = icons[i] ?? ShieldCheck;
        return (
          <li key={step.text} className="type-body flex items-center gap-3 px-4 py-3">
            <span className="type-small flex size-6 shrink-0 items-center justify-center rounded-full bg-chad-surface-2 font-medium tabular-nums">
              {i + 1}
            </span>
            <Icon className="size-4 shrink-0 text-chad-accent" aria-hidden="true" />
            <span>{step.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** One network detail: the label, the value, copy. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="min-w-0">
        <dt className="type-small text-chad-text-dim">{label}</dt>
        <dd className="type-body break-all">{value}</dd>
      </div>
      <CopyButton value={value} compact />
    </div>
  );
}

/** A link off site: new tab, mint. */
function ExtLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-chad-accent hover:underline ${className ?? ""}`}
    >
      {children}
    </a>
  );
}

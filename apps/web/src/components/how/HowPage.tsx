import Link from "next/link";
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

import { Section } from "@/components/site/Section";
import type { ChainInfo } from "@/lib/api";
import { TESTNET_ONLY, chainPills, liveMainnetKeys, type ChainPill } from "@/lib/chains";

import {
  CLAIM_STEPS,
  NEXT,
  SAFE_LINES,
  TESTED_LINE,
  WHY_GROUPS,
  canCards,
  faqFor,
  feeLines,
  howChains,
  sendSteps,
  tokenTierNote,
} from "./how";

/**
 * The how it works page, `/how`. For
 * people new to crypto, simple words, one column. The title on one line (`h1-fit`), why
 * dropchad in a card, what you can do (drop, token drop, multisend), then the steps, safety, fees,
 * testnet, coming next and the questions. Steps are lucide icons in numbered cards, no
 * screenshots. `chains` is the api's `GET /api/chains`, `null` when it did not answer.
 * `liveKeys` are the live mainnet chains of the api switch
 * absent, the chains with no api answer.
 */
export function HowPage({
  chains,
  liveKeys = liveMainnetKeys(),
}: {
  chains: readonly ChainInfo[] | null;
  liveKeys?: readonly string[];
}) {
  const named = howChains(TESTNET_ONLY, liveKeys);
  const can = canCards(named);
  const steps = sendSteps(named);
  const faq = faqFor(named);
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
          {can.map((item) => (
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
        <Steps icons={[Link2, Coins, AtSign, Wallet, Rocket]} steps={steps} />
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
                  <p className="mt-3">{tokenTierNote(named)}</p>
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

      <Section title="tested in public">
        <p className="type-body text-chad-text-dim">{TESTED_LINE}</p>
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
        <dl data-faq="" className="space-y-6">
          {faq.map((item) => (
            <div key={item.q}>
              <dt className="type-body font-semibold">{item.q}</dt>
              <dd className="mt-2">
                <ul className="type-body space-y-2 text-chad-text-dim">
                  {item.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
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

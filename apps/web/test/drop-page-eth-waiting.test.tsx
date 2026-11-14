/**
 * The ETH waiting line on the drop page.
 * and the mint exception in section 2
 * - while the drop answer's `chain.data.drop.nativeWaiting` is set and not swept, one line on the
 *   finished drop page, under the `claimed` counter and above `who claimed`
 * - the line exactly as decided, mint (`--chad-accent`) in the `small` size, never grey
 * - gone once swept, and when `nativeWaiting` is `null` or absent (a Solana drop, an older
 *   indexer)
 * - the same for everyone: the sender and anybody else
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterView } from "@/components/drops/AfterView";
import { ETH_WAITING_LINE, ethWaitingShows } from "@/components/drops/eth-waiting";
import type { DropDetail, Profile } from "@/lib/api";

const LINE =
  "some eth is waiting in this drop. the refund address could not take it, it goes back once it can.";
const DROP = "0x0000000000000000000000000000000000d60001";
const ROBINHOOD_TESTNET = 46630;

const creator = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "sample",
  profileImageUrl: null,
  kind: "kol",
  tags: ["dev"],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

const waitingRow = (swept: boolean) => ({
  to: "0x00000000000000000000000000000000000000aa",
  amount: "50000000000000000",
  swept,
  transactionHash: `0x${"11".repeat(32)}`,
  sweptTransactionHash: swept ? `0x${"22".repeat(32)}` : null,
});

/** A refunded Robinhood drop as the api answers it; `nativeWaiting` as given, or left out. */
function detailWith(nativeWaiting?: ReturnType<typeof waitingRow> | null, yours = false) {
  const drop: Record<string, unknown> = {
    address: DROP,
    status: "Finalized",
    claimedCount: 2,
    leafCount: 3,
    fundingDeadline: "1",
  };
  if (nativeWaiting !== undefined) drop["nativeWaiting"] = nativeWaiting;
  return {
    address: DROP,
    chain: { source: "indexer", available: true, indexed: true, data: { drop, claims: [] } },
    ours: {
      source: "dropchad_api",
      known: true,
      data: {
        token: null,
        state: "finished",
        yours,
        memeImageUrl: null,
        lastTxHash: null,
        activateTxHash: null,
      },
    },
  } as unknown as DropDetail;
}

function page(detail: DropDetail): string {
  return renderToStaticMarkup(
    <AfterView
      detail={detail}
      paid={[]}
      paidCount={2}
      leafCount={3}
      chainId={ROBINHOOD_TESTNET}
      amountWei="300000000000000000"
      createdAt={1790838985}
      title={null}
      creator={creator}
      chip="DONE"
    />,
  );
}

describe("the line", () => {
  it("is the decided text, word for word", () => {
    expect(ETH_WAITING_LINE).toBe(LINE);
  });
});

describe("when it shows", () => {
  it("ETH waiting, not swept: shown", () => {
    expect(ethWaitingShows(detailWith(waitingRow(false)))).toBe(true);
    expect(page(detailWith(waitingRow(false)))).toContain(LINE);
  });

  it("swept: gone", () => {
    expect(ethWaitingShows(detailWith(waitingRow(true)))).toBe(false);
    expect(page(detailWith(waitingRow(true)))).not.toContain(LINE);
  });

  it("nativeWaiting null, or absent (a Solana drop, an older indexer): none", () => {
    for (const detail of [detailWith(null), detailWith(undefined)]) {
      expect(ethWaitingShows(detail)).toBe(false);
      expect(page(detail)).not.toContain(LINE);
    }
  });

  it("no chain row at all: none", () => {
    const detail = {
      ...detailWith(waitingRow(false)),
      chain: { source: "indexer", available: false, indexed: false, data: null },
    } as unknown as DropDetail;
    expect(ethWaitingShows(detail)).toBe(false);
  });

  it("the same for the sender and for anybody else", () => {
    expect(page(detailWith(waitingRow(false), true))).toContain(LINE);
    expect(page(detailWith(waitingRow(false), false))).toContain(LINE);
  });
});

describe("where and how it looks", () => {
  it("under the claimed counter, above who claimed", () => {
    const html = page(detailWith(waitingRow(false)));
    const counter = html.indexOf(">claimed<");
    const line = html.indexOf(LINE);
    const list = html.indexOf(">who claimed<");
    expect(counter).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(counter);
    expect(line).toBeLessThan(list);
  });

  it("mint in the small size, never grey, and no link", () => {
    const html = page(detailWith(waitingRow(false)));
    const tag = /<p class="([^"]*)">some eth is waiting/.exec(html);
    expect(tag?.[1]).toContain("type-small");
    expect(tag?.[1]).toContain("text-chad-accent");
    expect(tag?.[1]).not.toContain("text-chad-text-dim");
    expect(html).not.toContain("0x00000000000000000000000000000000000000aa");
    expect(html).not.toContain("0.05");
  });
});

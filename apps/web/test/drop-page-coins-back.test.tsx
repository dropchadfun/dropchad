/**
 * A drop that never went live opens
 * only when its cancel returned coins. On that page the empty `who claimed` line says the coins
 * went back. Every other finished drop keeps its own empty line.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterView } from "@/components/drops/AfterView";
import { COINS_BACK_LINE, coinsBackShows } from "@/components/drops/coins-back";
import type { Chip } from "@/components/drops/drop-card-data";
import type { DropDetail } from "@/lib/api";

const LINE = "not fully funded in time. the coins went back to the refund wallet.";
const OLD_LINE = "nobody. the drop expired before it was funded.";
const DROP = "0x0000000000000000000000000000000000d70001";
const ROBINHOOD_TESTNET = 46630;

/** A drop answer with our state and the chain status as given. */
function detailWith(state: string | null, status: string): DropDetail {
  return {
    address: DROP,
    chain: {
      source: "indexer",
      available: true,
      indexed: true,
      data: {
        drop: { address: DROP, status, claimedCount: 0, leafCount: 3, fundingDeadline: "1" },
        claims: [],
      },
    },
    ours: {
      source: "dropchad_api",
      known: state !== null,
      data:
        state === null
          ? null
          : { token: null, state, yours: false, lastTxHash: null, activateTxHash: null },
    },
  } as unknown as DropDetail;
}

function page(detail: DropDetail, chip: Chip = "EXPIRED"): string {
  return renderToStaticMarkup(
    <AfterView
      detail={detail}
      paid={[]}
      paidCount={0}
      leafCount={3}
      chainId={ROBINHOOD_TESTNET}
      amountWei="300000000000000000"
      createdAt={1790838985}
      title={null}
      creator={null}
      chip={chip}
    />,
  );
}

describe("the coins back line", () => {
  it("is the line exactly as decided", () => {
    expect(COINS_BACK_LINE).toBe(LINE);
  });

  it("replaces the empty line on our funding_expired drop", () => {
    const html = page(detailWith("funding_expired", "Cancelled"));
    expect(html).toContain(LINE);
    expect(html).not.toContain(OLD_LINE);
  });

  it("shows on a drop the chain says is Cancelled, with or without a row of ours", () => {
    expect(coinsBackShows(detailWith(null, "Cancelled"))).toBe(true);
    expect(page(detailWith(null, "Cancelled"))).toContain(LINE);
  });

  it("never on a drop that went live and ended", () => {
    for (const [state, status] of [
      ["claims_expired", "Finalized"],
      ["finished", "Finalized"],
      ["active", "Active"],
    ] as const) {
      expect(coinsBackShows(detailWith(state, status)), state).toBe(false);
      expect(page(detailWith(state, status), "DONE"), state).not.toContain(LINE);
    }
  });
});

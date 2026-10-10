/**
 * While a drop waits for money the funding card is the creator's only (,
 * ). The creator is `yours: true` from the browser's own read, never a
 * profile comparison. Everyone else, signed in or not, sees one line, `waiting for @handle to
 * fund this drop`, and the normal drop info, with no address on the screen. The server rendered
 * page carries no `ours.funding`, and the tab title is `drop`. Rendered with `react-dom/server`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DropPage } from "@/components/drops/DropPage";
import { withoutFunding } from "@/components/drops/funding";
import type { DropDetail, Funding, Profile } from "@/lib/api";
import { shortAddress } from "@/lib/format";

const SOLANA = 103;
const DROP = "EsbPxhZPGibWAdyagUXAac8HjJpEY681qDhHeFP3ULRv";
const SRC = join(__dirname, "..", "src");

const FUNDING: Funding = {
  family: "svm",
  address: DROP,
  chainId: SOLANA,
  asset: "native",
  symbol: "SOL",
  decimals: 9,
  amountBaseUnits: "12500000",
  amountDisplay: "0.0125",
  paymentUri: `solana:${DROP}?amount=0.0125`,
  fundingDeadline: "1791841994",
  amountWei: "12500000",
  amountEth: "0.0125",
};

const nigel = {
  xUserId: "1214999437505785857",
  handle: "nigeloxide",
  displayName: "nigeloxide",
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

/** nigeloxide's 0.01 SOL drop on devnet, waiting for money. `yours` as the api sent it. */
function waiting(
  yours: boolean | undefined,
  funding: Funding | null | undefined = FUNDING,
): DropDetail {
  return {
    address: DROP,
    chain: {
      source: "rpc",
      available: true,
      indexed: true,
      data: {
        drop: {
          address: DROP,
          chainId: SOLANA,
          status: "Created",
          totalEntitlements: "10000000",
          leafCount: 1,
          claimedCount: 0,
          createdAt: "1791237194",
        },
        claims: [],
        events: [],
      },
    },
    ours: {
      source: "dropchad_api",
      known: true,
      data: {
        address: DROP,
        chainId: SOLANA,
        chainKey: "solana-devnet",
        asset: "11111111111111111111111111111111",
        token: null,
        ...(funding === undefined ? {} : { funding }),
        title: null,
        memeImageUrl: null,
        state: "created",
        mode: "handle",
        totalEntitlementsWei: "10000000",
        grossRequiredWei: "12500000",
        feeAmountWei: "2500000",
        leafCount: 1,
        paidCount: 0,
        failedIndexes: [],
        createTxHash: "5pKjmkhQ",
        activateTxHash: null,
        lastTxHash: null,
        refundRecipient: "4w2gyJCVCnX37VSQxUFQJhpTPZcAitjKidSvpNsqBe3T",
        merkleRoot: "0x00",
        manifestUrl: "",
        lastError: null,
        fundingDeadline: "1791841994",
        createdAt: "2026-10-05T21:53:14.429Z",
        creator: nigel,
        ...(yours === undefined ? {} : { yours }),
        fed: [],
      },
    },
  } as unknown as DropDetail;
}

const page = (detail: DropDetail) => renderToStaticMarkup(<DropPage initial={detail} />);

/** Nothing on the screen or in a link that gives the drop address away. */
function expectNoAddress(html: string) {
  expect(html).not.toContain(DROP);
  expect(html).not.toContain(shortAddress(DROP));
  expect(html).not.toContain("solana:");
}

describe("the creator sees the funding card", () => {
  const html = page(waiting(true));

  it("send this amount, the fee lines, the drop address and the copy buttons", () => {
    expect(html).toContain("waiting for the money");
    expect(html).toContain("send this amount");
    expect(html).toContain("fee");
    expect(html).toContain(DROP.slice(0, 8));
    expect(html).toContain("copy");
  });

  it("not the line meant for everyone else", () => {
    expect(html).not.toContain("to fund this drop");
  });
});

describe("everyone else sees one line and no address", () => {
  for (const [who, yours] of [
    ["a signed in user who did not make it", false],
    ["an api before step 21, no `yours` at all", undefined],
  ] as const) {
    it(`${who}: waiting for @nigeloxide to fund this drop`, () => {
      const html = page(waiting(yours));
      expect(html).toContain("waiting for @nigeloxide to fund this drop");
      expect(html).not.toContain("waiting for the money");
      expect(html).not.toContain("send this amount");
      expect(html).not.toContain("fund the address below");
      expectNoAddress(html);
    });
  }

  it("no funding card from the old `grossRequiredWei` path either (an api before 4f)", () => {
    const html = page(waiting(false, undefined));
    expect(html).toContain("waiting for @nigeloxide to fund this drop");
    expect(html).not.toContain("send this amount");
    expectNoAddress(html);
  });

  it("the normal drop info stays under the line: sender, chip, people fed", () => {
    const html = page(waiting(false));
    expect(html).toContain("nigeloxide");
    expect(html).toContain("FUNDING");
    expect(html).toContain("people fed");
    expect(html).toContain("nobody yet. the drop is not funded.");
    const line = html.indexOf("to fund this drop");
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeLessThan(html.indexOf("people fed"));
  });
});

describe("the server rendered page carries no funding", () => {
  it("withoutFunding drops `ours.funding` and is never `yours`", () => {
    const stripped = withoutFunding(waiting(true));
    const ours = stripped.ours.data as unknown as Record<string, unknown>;
    expect("funding" in ours).toBe(false);
    expect(ours.yours).toBe(false);
    expect(JSON.stringify(stripped)).not.toContain("solana:");
  });

  it("keeps everything else, and a drop the api did not create stays as it is", () => {
    const stripped = withoutFunding(waiting(false));
    expect(stripped.address).toBe(DROP);
    expect(stripped.chain).toEqual(waiting(false).chain);
    expect(stripped.ours.data?.creator?.handle).toBe("nigeloxide");
    expect(stripped.ours.data?.state).toBe("created");
    const noOurs = {
      ...waiting(false),
      ours: { source: "dropchad_api", known: false, data: null },
    };
    expect(withoutFunding(noOurs as unknown as DropDetail)).toEqual(noOurs);
  });

  it("the route hands the drop page the stripped read", () => {
    const route = readFileSync(join(SRC, "app", "d", "[address]", "page.tsx"), "utf8");
    expect(route).toMatch(/<DropPage initial=\{withoutFunding\(detail\)\} \/>/);
  });

  it("the browser reads the drop again with the cookie, and `yours` decides", () => {
    const source = readFileSync(join(SRC, "components", "drops", "DropPage.tsx"), "utf8");
    expect(source).toMatch(/yours === true/);
    expect(source).not.toMatch(/creator\??\.handle ===/);
  });
});

describe("the tab title has no address", () => {
  it("is `drop`", async () => {
    const { generateMetadata } = await import("@/app/d/[address]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ address: DROP }) });
    expect(meta.title).toBe("drop");
  });
});

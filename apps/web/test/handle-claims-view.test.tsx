/**
 * The drop page of a Solana handle drop, bug found live: `/d/Dx4BT8Zk…QK7Wv` crashed
 * with `Cannot read properties of null (reading 'length')`. A Solana handle claim carries
 * `recipient: null`: the bitmap says a leaf is paid, not to which address, and a handle leaf
 * names an X id, never an address. The data below is that drop as the live api sent it, read
 * only. Rendered with `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DropPage } from "@/components/drops/DropPage";
import { LiveView, type PaidEntry } from "@/components/drops/LiveView";
import type { DropDetail, Profile } from "@/lib/api";

const DROP = "Dx4BT8ZkGLR49rmVRfkWKF96WCBXNrr3fRE3LAVQK7Wv";

const creator = {
  xUserId: "1000000000000000001",
  handle: "samplechad",
  displayName: "sample",
  profileImageUrl: "https://pbs.twimg.com/profile_images/2084749855172259840/QGsWDaTW_normal.jpg",
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

/** `GET /api/drops/Dx4BT8Zk…QK7Wv`, the fields the page reads. */
const LIVE = {
  address: DROP,
  chain: {
    source: "rpc",
    available: true,
    indexed: true,
    data: {
      drop: {
        address: DROP,
        chainId: 103,
        chainKey: "solana-devnet",
        family: "svm",
        source: "rpc",
        status: "Active",
        asset: "11111111111111111111111111111111",
        creatorCommitment: "0x3dfee5acdae5c523310efc2b1f08d0620e59ef0a83e67fedef4174ced064b313",
        totalEntitlements: "20000000",
        leafCount: 2,
        fundingDeadline: "1791406388",
        claimDeadline: "1793393682",
        totalClaimed: "20000000",
        claimedCount: 2,
        verified: true,
        createdAt: "1790801588",
        transactionHash:
          "4sAgioERxPvba5TR7pGCYNPdKdGvwoLLELhhnNxCVQcs1vrKUqxC8g75gXPVUnFNWk93fRVR3jatCAUmNRsSTPsv",
        finality: "seen",
        statusFinality: "seen",
      },
      // The real claims: no recipient, no transaction.
      claims: [
        { index: 0, recipient: null, amount: "10000000", transactionHash: null, finality: "seen" },
        { index: 1, recipient: null, amount: "10000000", transactionHash: null, finality: "seen" },
      ],
      events: [],
    },
  },
  ours: {
    source: "dropchad_api",
    known: true,
    data: {
      creator,
      yours: false,
      address: DROP,
      chainId: 103,
      chainKey: "solana-devnet",
      mode: "handle",
      state: "finished",
      paidCount: 2,
      leafCount: 2,
      failedIndexes: [],
      totalEntitlementsWei: "20000000",
      feeAmountWei: "2500000",
      grossRequiredWei: "22500000",
      refundRecipient: "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH",
      fundingDeadline: "1791406388",
      title: "for good chads",
      memeImageUrl: null,
      merkleRoot: "0xf8d22010468613fec4bf9751a24df2e2a7a3ce71a89f81499a4e2b701b0d4673",
      manifestUrl: `/api/drops/${DROP}/manifest`,
      createTxHash:
        "4sAgioERxPvba5TR7pGCYNPdKdGvwoLLELhhnNxCVQcs1vrKUqxC8g75gXPVUnFNWk93fRVR3jatCAUmNRsSTPsv",
      activateTxHash:
        "4QfsvaL5TZtoHitAHx42DTjirYwGwGfcGiawT29EAupxKUWWEjc9zxB5HomY1oLzQmPeDVNUGCnpwpH2ssE1X5Pq",
      lastTxHash:
        "3VLpeGbuwhwER5xYgktQ5ezdE8iLuPyCV67cwKfYcZMZKcmEXXYQ9BhTgDnkTdkXXrzWinX74v5d34RVYZ6JskGK",
      lastError: null,
      createdAt: "2026-09-30T20:53:08.356Z",
    },
  },
} as unknown as DropDetail;

describe("a Solana handle drop, claims without a recipient address", () => {
  it("the finished drop page renders, both claims listed by their place", () => {
    const html = renderToStaticMarkup(<DropPage initial={LIVE} />);
    expect(html).toContain("who got fed");
    expect(html).toContain(">#1<");
    expect(html).toContain(">#2<");
  });

  it("the live feed renders a paid entry without an address", () => {
    const paid: PaidEntry[] = [
      {
        index: 0,
        recipient: null,
        handle: null,
        profileImageUrl: null,
        amountWei: "10000000",
        txHash: null,
        fresh: false,
      },
    ];
    const html = renderToStaticMarkup(
      <LiveView
        address={DROP}
        chainId={103}
        title="for good chads"
        creator={creator}
        amountWei="20000000"
        createdAt={1790801588}
        leafCount={2}
        paidCount={1}
        paid={paid}
        waiting={false}
      />,
    );
    expect(html).toContain(">#1<");
  });

  // the page never shows the address the money landed on, only the handle or `#1`.
  it("an entry with an address shows its place, never the address", () => {
    const paid: PaidEntry[] = [
      {
        index: 0,
        recipient: "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH",
        handle: null,
        profileImageUrl: null,
        amountWei: "10000000",
        txHash: null,
        fresh: false,
      },
    ];
    const html = renderToStaticMarkup(
      <LiveView
        address={DROP}
        chainId={103}
        title={null}
        creator={creator}
        amountWei="20000000"
        createdAt={1790801588}
        leafCount={2}
        paidCount={1}
        paid={paid}
        waiting={false}
      />,
    );
    expect(html).toContain(">#1<");
    expect(html).not.toContain("HPDRfu");
  });
});

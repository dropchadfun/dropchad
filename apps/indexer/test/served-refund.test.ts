/**
 * ETH waiting is not refunded: the indexer's read
 * endpoints give each drop `nativeWaiting`, and on a native drop whose row is not swept `refunded`
 * is served minus the waiting amount; once swept it counts again. A token drop's `refunded` is
 * tokens and stays. `GET /native-waiting` lists every row not swept, for owner alert 6. The stored
 * rows do not change: these are the shapes the endpoints serve.
 */
import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { nativeWaitingList, nativeWaitingShape, servedRefunded } from "../src/native-waiting.js";

const DROP = "0x0000000000000000000000000000000000d60001" as const;
const TO = "0x00000000000000000000000000000000000000aa" as const;
const TOKEN = "0x077ac8ffc52458c6bf08d427c5eb038be3f06f03" as const;
const TX = `0x${"11".repeat(32)}` as const;
const SWEEP_TX = `0x${"22".repeat(32)}` as const;

const row = (swept: boolean, drop: `0x${string}` = DROP) => ({
  drop,
  to: TO,
  amount: 50_000_000_000_000_000n,
  swept,
  sweptTransactionHash: swept ? SWEEP_TX : null,
  blockNumber: 10n,
  blockHash: `0x${"33".repeat(32)}` as const,
  transactionHash: TX,
  logIndex: 2,
  timestamp: 1_800_000_000n,
});

describe("servedRefunded", () => {
  const refunded = 150_000_000_000_000_000n;

  it("a native drop with no row: refunded as stored", () => {
    expect(servedRefunded({ asset: zeroAddress, refunded }, undefined)).toBe(refunded);
  });

  it("a native drop whose ETH waits: minus the waiting amount", () => {
    expect(servedRefunded({ asset: zeroAddress, refunded }, row(false))).toBe(
      100_000_000_000_000_000n,
    );
  });

  it("a native drop whose waiting ETH was swept: refunded as stored again", () => {
    expect(servedRefunded({ asset: zeroAddress, refunded }, row(true))).toBe(refunded);
  });

  it("a token drop: tokens, never minus the ETH", () => {
    expect(servedRefunded({ asset: TOKEN, refunded: 7n }, row(false))).toBe(7n);
  });
});

describe("nativeWaitingShape, the drop answer", () => {
  it("no row: null", () => {
    expect(nativeWaitingShape(undefined)).toBeNull();
  });

  it("a row: to, the amount as a decimal string, swept and the two transactions", () => {
    expect(nativeWaitingShape(row(false))).toEqual({
      to: TO,
      amount: "50000000000000000",
      swept: false,
      transactionHash: TX,
      sweptTransactionHash: null,
    });
    expect(nativeWaitingShape(row(true))).toMatchObject({
      swept: true,
      sweptTransactionHash: SWEEP_TX,
    });
  });
});

describe("nativeWaitingList, GET /native-waiting", () => {
  it("every row not swept, with the drop, oldest first as given", () => {
    const other = "0x0000000000000000000000000000000000d50002" as const;
    expect(nativeWaitingList([row(false), row(true, other), row(false, other)])).toEqual({
      rows: [
        { drop: DROP, to: TO, amount: "50000000000000000", transactionHash: TX },
        { drop: other, to: TO, amount: "50000000000000000", transactionHash: TX },
      ],
    });
  });

  it("nothing waiting: an empty list", () => {
    expect(nativeWaitingList([])).toEqual({ rows: [] });
  });
});

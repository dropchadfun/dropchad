/**
 * The relayer rules, against a fake chain.
 *
 * These are the tests that matter most in the api. The relayer is the only thing that holds a key,
 * and the design says it holds gas money only and can never move drop funds. Every claim in
 * that sentence is asserted here:
 *
 * - it exposes seven verbs and nothing else: `claimHandle` since, `refund`
 *   since 16c, `cancelUnfunded` since
 * - every transaction it sends carries `value: 0`
 * - `createDrop` can only be sent to the factory
 * - `activate`, `claim` and `claimBatch` can only be sent to a drop we created
 * - two concurrent sends never take the same nonce
 * - the per call gas cap and the daily budget both refuse before anything is signed
 */
import { describe, expect, it, vi } from "vitest";
import { getAddress, toFunctionSelector, type Address, type Hex } from "viem";
import { dropFactoryV1Abi, dropV1Abi, dropV2Abi } from "@dropchad/shared";
import { decodeFunctionData, getAbiItem } from "viem";

import {
  ALLOWED_SELECTORS,
  GasBudgetExceededError,
  GasCapExceededError,
  RelayerRefusedError,
  TransactionRevertedError,
  createRelayer,
  type ClaimItem,
  type CreateDropParams,
  type GasBudget,
  type HandleClaimItem,
  type ReceiptLike,
  type RelayerTransport,
} from "../src/chain/relayer.js";

const FACTORY = getAddress("0x00000000000000000000000000000000000fac70");
const KNOWN_DROP = getAddress("0x00000000000000000000000000000000000d0000");
const STRANGER = getAddress("0x000000000000000000000000000000000000dead");
const RELAYER_ADDRESS = getAddress("0x000000000000000000000000000000000000be11");

interface SentTx {
  to: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
  nonce: number;
}

interface FakeTransportOptions {
  startNonce?: number;
  estimate?: bigint;
  maxFee?: bigint;
  status?: ReceiptLike["status"];
  failSend?: boolean;
  /** Resolve sends only when released, so two calls can be in flight at once. */
  gate?: { promise: Promise<void> };
}

function createFakeTransport(options: FakeTransportOptions = {}): RelayerTransport & {
  sent: SentTx[];
  nonceReads: number;
} {
  const sent: SentTx[] = [];
  let nonceReads = 0;

  return {
    address: RELAYER_ADDRESS,
    sent,
    get nonceReads() {
      return nonceReads;
    },
    pendingNonce: () => {
      nonceReads += 1;
      return Promise.resolve(options.startNonce ?? 7);
    },
    estimateGas: () => Promise.resolve(options.estimate ?? 100_000n),
    maxFeePerGas: () => Promise.resolve(options.maxFee ?? 1_000_000_000n),
    async send(tx) {
      if (options.gate !== undefined) await options.gate.promise;
      if (options.failSend === true) throw new Error("rpc said no");
      sent.push({ ...tx });
      return `0x${String(sent.length).padStart(64, "0")}`;
    },
    waitForReceipt: (hash) =>
      Promise.resolve({
        status: options.status ?? "success",
        transactionHash: hash,
        blockNumber: 1n,
        gasUsed: 90_000n,
        effectiveGasPrice: 1_000_000n,
        logs: [],
      }),
  };
}

function unlimitedBudget(): GasBudget & { reserved: bigint[]; settled: [bigint, bigint][] } {
  const reserved: bigint[] = [];
  const settled: [bigint, bigint][] = [];
  return {
    reserved,
    settled,
    reserve: (wei) => {
      reserved.push(wei);
      return Promise.resolve();
    },
    settle: (a, b) => {
      settled.push([a, b]);
      return Promise.resolve();
    },
  };
}

function build(
  transport: RelayerTransport,
  overrides: {
    budget?: GasBudget;
    isKnownDrop?: (address: Address) => Promise<boolean>;
    caps?: { createDrop: bigint; claimBatch: bigint; claimHandle: bigint };
  } = {},
) {
  return createRelayer({
    transport,
    factory: FACTORY,
    isKnownDrop:
      overrides.isKnownDrop ??
      ((address) => Promise.resolve(address.toLowerCase() === KNOWN_DROP.toLowerCase())),
    gasBudget: overrides.budget ?? unlimitedBudget(),
    gasCaps: overrides.caps ?? {
      createDrop: 2_000_000n,
      claimBatch: 3_000_000n,
      claimHandle: 300_000n,
    },
  });
}

// Typed, not asserted: the type is what makes `0x...` a `Hex` here, so a wrong shape fails at
// the declaration instead of at thirteen call sites.
const CREATE_PARAMS: CreateDropParams = {
  asset: "0x0000000000000000000000000000000000000000",
  merkleRoot: `0x${"11".repeat(32)}`,
  manifestHash: `0x${"22".repeat(32)}`,
  totalEntitlements: 1000n,
  leafCount: 3,
  refundRecipient: STRANGER,
  creatorCommitment: `0x${"33".repeat(32)}`,
  nonce: 0n,
  fundingPeriod: 604_800,
  claimPeriod: 2_592_000,
  tokenFactory: "0x0000000000000000000000000000000000000000",
};

const CLAIM_ITEM: ClaimItem = {
  index: 0n,
  recipient: STRANGER,
  amount: 1000n,
  proof: [`0x${"44".repeat(32)}`],
};

const HANDLE_ITEM: HandleClaimItem = {
  index: 0n,
  xId: 44196397n,
  amount: 1000n,
  recipient: STRANGER,
  proof: [`0x${"44".repeat(32)}`],
  signature: `0x${"ab".repeat(65)}`,
};

describe("the seven calls, and no eighth", () => {
  it("exposes exactly an address and seven verbs", () => {
    const relayer = build(createFakeTransport());
    expect(Object.keys(relayer).sort()).toEqual([
      "activate",
      "address",
      "cancelUnfunded",
      "claim",
      "claimBatch",
      "claimHandle",
      "createDrop",
      "refund",
    ]);
  });

  it("the allowed selectors are computed from the ABIs, not written by hand", () => {
    expect(ALLOWED_SELECTORS.createDrop).toBe(
      toFunctionSelector(getAbiItem({ abi: dropFactoryV1Abi, name: "createDrop" })),
    );
    expect(ALLOWED_SELECTORS.activate).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "activate" })),
    );
    expect(ALLOWED_SELECTORS.claim).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "claim" })),
    );
    expect(ALLOWED_SELECTORS.claimBatch).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "claimBatch" })),
    );
    expect(ALLOWED_SELECTORS.claimHandle).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV2Abi, name: "claimHandle" })),
    );
    expect(ALLOWED_SELECTORS.refund).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "refund" })),
    );
    // The same function on `DropV2`, so one selector covers old and new drops.
    expect(ALLOWED_SELECTORS.refund).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV2Abi, name: "refund" })),
    );
    expect(Object.keys(ALLOWED_SELECTORS)).toHaveLength(7);
  });

  it("every send carries value zero, on all four calls", async () => {
    const transport = createFakeTransport();
    const relayer = build(transport);

    await relayer.createDrop(CREATE_PARAMS);
    await relayer.activate(KNOWN_DROP);
    await relayer.claim(KNOWN_DROP, CLAIM_ITEM);
    await relayer.claimBatch(KNOWN_DROP, [CLAIM_ITEM]);

    expect(transport.sent).toHaveLength(4);
    for (const tx of transport.sent) expect(tx.value).toBe(0n);
  });

  it("each call carries its own selector", async () => {
    const transport = createFakeTransport();
    const relayer = build(transport);

    await relayer.createDrop(CREATE_PARAMS);
    await relayer.activate(KNOWN_DROP);
    await relayer.claim(KNOWN_DROP, CLAIM_ITEM);
    await relayer.claimBatch(KNOWN_DROP, [CLAIM_ITEM]);

    expect(transport.sent.map((tx) => tx.data.slice(0, 10))).toEqual([
      ALLOWED_SELECTORS.createDrop,
      ALLOWED_SELECTORS.activate,
      ALLOWED_SELECTORS.claim,
      ALLOWED_SELECTORS.claimBatch,
    ]);
  });
});

describe("where the relayer is allowed to send", () => {
  it("createDrop always goes to the factory", async () => {
    const transport = createFakeTransport();
    await build(transport).createDrop(CREATE_PARAMS);
    expect(transport.sent[0]?.to).toBe(FACTORY);
  });

  it("refuses activate on an address that is not a drop we created", async () => {
    const transport = createFakeTransport();
    await expect(build(transport).activate(STRANGER)).rejects.toThrow(RelayerRefusedError);
    expect(transport.sent).toHaveLength(0);
  });

  it("refuses claim on an unknown address", async () => {
    const transport = createFakeTransport();
    await expect(build(transport).claim(STRANGER, CLAIM_ITEM)).rejects.toThrow(RelayerRefusedError);
    expect(transport.sent).toHaveLength(0);
  });

  it("refuses claimBatch on an unknown address", async () => {
    const transport = createFakeTransport();
    await expect(build(transport).claimBatch(STRANGER, [CLAIM_ITEM])).rejects.toThrow(
      RelayerRefusedError,
    );
    expect(transport.sent).toHaveLength(0);
  });

  it("refuses even the factory itself as a claim target", async () => {
    // The factory is not in `drops`, so it is a stranger to the three drop calls. This is the
    // case that would matter if the two allowlists were ever accidentally merged.
    const transport = createFakeTransport();
    await expect(build(transport).activate(FACTORY)).rejects.toThrow(RelayerRefusedError);
    expect(transport.sent).toHaveLength(0);
  });
});

describe("the nonce manager", () => {
  it("gives two concurrent sends two different, consecutive nonces", async () => {
    let release: () => void = () => undefined;
    const gate = { promise: new Promise<void>((resolve) => (release = resolve)) };
    const transport = createFakeTransport({ startNonce: 41, gate });
    const relayer = build(transport);

    const both = Promise.all([relayer.createDrop(CREATE_PARAMS), relayer.activate(KNOWN_DROP)]);
    release();
    await both;

    expect(transport.sent.map((tx) => tx.nonce)).toEqual([41, 42]);
    // The chain is asked once, then the count is tracked locally.
    expect(transport.nonceReads).toBe(1);
  });

  it("re-reads the nonce from the chain after a failed send", async () => {
    const failing = createFakeTransport({ failSend: true });
    const relayer = build(failing);
    await expect(relayer.createDrop(CREATE_PARAMS)).rejects.toThrow("rpc said no");
    await expect(relayer.createDrop(CREATE_PARAMS)).rejects.toThrow("rpc said no");
    // Once per attempt: a failed send may or may not have burned the nonce, only the chain knows.
    expect(failing.nonceReads).toBe(2);
  });

  it("one failed send does not wedge the queue", async () => {
    const transport = createFakeTransport();
    const relayer = build(transport);
    await expect(relayer.activate(STRANGER)).rejects.toThrow(RelayerRefusedError);
    await expect(relayer.activate(KNOWN_DROP)).resolves.toMatchObject({ nonce: 7 });
  });
});

describe("the gas cap", () => {
  it("refuses a createDrop whose estimate is over the cap, before signing anything", async () => {
    const transport = createFakeTransport({ estimate: 2_500_000n });
    const relayer = build(transport, {
      caps: { createDrop: 2_000_000n, claimBatch: 3_000_000n, claimHandle: 300_000n },
    });
    await expect(relayer.createDrop(CREATE_PARAMS)).rejects.toThrow(GasCapExceededError);
    expect(transport.sent).toHaveLength(0);
  });

  it("adds head room over the estimate but never goes above the cap", async () => {
    const transport = createFakeTransport({ estimate: 1_900_000n });
    const relayer = build(transport, {
      caps: { createDrop: 2_000_000n, claimBatch: 3_000_000n, claimHandle: 300_000n },
    });
    await relayer.createDrop(CREATE_PARAMS);
    expect(transport.sent[0]?.gas).toBe(2_000_000n);
  });

  it("uses estimate plus a fifth when that fits under the cap", async () => {
    const transport = createFakeTransport({ estimate: 100_000n });
    const relayer = build(transport);
    await relayer.createDrop(CREATE_PARAMS);
    expect(transport.sent[0]?.gas).toBe(120_000n);
  });
});

describe("the daily gas budget", () => {
  it("charges the worst case cost before sending, then corrects it from the receipt", async () => {
    const transport = createFakeTransport({ estimate: 100_000n, maxFee: 2n });
    const budget = unlimitedBudget();
    await build(transport, { budget }).createDrop(CREATE_PARAMS);

    // gas limit 120,000 x max fee 2 = 240,000 reserved.
    expect(budget.reserved).toEqual([240_000n]);
    // Settled against what it really cost: 90,000 gas used x 1,000,000 per gas.
    expect(budget.settled).toEqual([[240_000n, 90_000n * 1_000_000n]]);
  });

  it("refuses to send when the day's budget is used up", async () => {
    const transport = createFakeTransport();
    const budget: GasBudget = {
      reserve: () => Promise.reject(new GasBudgetExceededError(10n, 5n)),
      settle: () => Promise.resolve(),
    };
    await expect(build(transport, { budget }).createDrop(CREATE_PARAMS)).rejects.toThrow(
      GasBudgetExceededError,
    );
    expect(transport.sent).toHaveLength(0);
  });

  it("gives the reservation back when the send itself fails", async () => {
    const transport = createFakeTransport({ failSend: true });
    const budget = unlimitedBudget();
    await expect(build(transport, { budget }).createDrop(CREATE_PARAMS)).rejects.toThrow();
    expect(budget.settled).toEqual([[budget.reserved[0] as bigint, 0n]]);
  });
});

describe("a reverted transaction", () => {
  it("throws, but only after the gas it burned has been settled", async () => {
    const transport = createFakeTransport({ status: "reverted" });
    const budget = unlimitedBudget();
    await expect(build(transport, { budget }).createDrop(CREATE_PARAMS)).rejects.toThrow(
      TransactionRevertedError,
    );
    expect(budget.settled).toHaveLength(1);
    expect(budget.settled[0]?.[1]).toBe(90_000n * 1_000_000n);
  });

  it("still reports the transaction to the recorder", async () => {
    const transport = createFakeTransport({ status: "reverted" });
    const onSent = vi.fn(() => Promise.resolve());
    const onReceipt = vi.fn(() => Promise.resolve());
    const relayer = createRelayer({
      transport,
      factory: FACTORY,
      isKnownDrop: () => Promise.resolve(true),
      gasBudget: unlimitedBudget(),
      gasCaps: { createDrop: 2_000_000n, claimBatch: 3_000_000n, claimHandle: 300_000n },
      recorder: { onSent, onReceipt },
    });
    await expect(relayer.createDrop(CREATE_PARAMS)).rejects.toThrow(TransactionRevertedError);
    expect(onSent).toHaveBeenCalledOnce();
    expect(onReceipt).toHaveBeenCalledOnce();
  });
});

describe("claimHandle, the fifth call", () => {
  it("goes to a drop we created, with value zero and exactly the handle fields", async () => {
    const transport = createFakeTransport();
    await build(transport).claimHandle(KNOWN_DROP, HANDLE_ITEM);
    const [tx] = transport.sent;
    expect(tx?.to).toBe(KNOWN_DROP);
    expect(tx?.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: dropV2Abi, data: tx?.data ?? "0x" });
    expect(decoded.functionName).toBe("claimHandle");
    expect(decoded.args).toEqual([
      HANDLE_ITEM.index,
      HANDLE_ITEM.xId,
      HANDLE_ITEM.amount,
      HANDLE_ITEM.recipient,
      HANDLE_ITEM.proof,
      HANDLE_ITEM.signature,
    ]);
  });

  it("refuses a drop this api did not create, before anything is signed", async () => {
    const transport = createFakeTransport();
    await expect(build(transport).claimHandle(STRANGER, HANDLE_ITEM)).rejects.toThrow(
      RelayerRefusedError,
    );
    expect(transport.sent).toHaveLength(0);
  });

  it("has its own gas cap, far under the batch cap", async () => {
    const transport = createFakeTransport({ estimate: 400_000n });
    await expect(build(transport).claimHandle(KNOWN_DROP, HANDLE_ITEM)).rejects.toThrow(
      GasCapExceededError,
    );
    expect(transport.sent).toHaveLength(0);
  });
});

describe("refund, the sixth call", () => {
  it("goes to a drop we created, with value zero and no arguments", async () => {
    const transport = createFakeTransport();
    await build(transport).refund(KNOWN_DROP);
    const [tx] = transport.sent;
    expect(tx?.to).toBe(KNOWN_DROP);
    expect(tx?.value).toBe(0n);
    expect(tx?.data).toBe(ALLOWED_SELECTORS.refund);
  });

  it("refuses a drop this api did not create, before anything is signed", async () => {
    const transport = createFakeTransport();
    await expect(build(transport).refund(STRANGER)).rejects.toThrow(RelayerRefusedError);
    expect(transport.sent).toHaveLength(0);
  });
});

/**
 * The L1 part of a gas estimate. On a Robinhood chain the
 * transport reads it from the chain's `NodeInterface`; anywhere else it is 0, and a failed or
 * malformed read counts the whole estimate as work.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import {
  createViemRelayerTransport,
  getServedEvmChain,
  type ServedEvmChain,
} from "../src/chain/client.js";

// Anvil's published test account 2. Play money only.
const RELAYER_SECRET = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const DROP = getAddress("0x00000000000000000000000000000000000d0000");
const DATA = "0x8054186c0000" as Hex;
const NODE_INTERFACE = getAddress("0x00000000000000000000000000000000000000C8");
const nodeInterfaceAbi = parseAbi([
  "function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)",
]);

interface CallArgs {
  account?: Address | { address: Address };
  to?: Address;
  data?: Hex;
}

function transportWith(chain: ServedEvmChain, call: (args: CallArgs) => Promise<{ data?: Hex }>) {
  const calls: CallArgs[] = [];
  const publicClient = {
    call: (args: CallArgs) => {
      calls.push(args);
      return call(args);
    },
  } as unknown as PublicClient;
  const transport = createViemRelayerTransport({
    chain,
    rpcUrls: "http://127.0.0.1:1",
    privateKey: RELAYER_SECRET,
    publicClient,
  });
  return { transport, calls };
}

const answer = (l1: bigint): Promise<{ data: Hex }> =>
  Promise.resolve({
    data: encodeAbiParameters(
      [{ type: "uint64" }, { type: "uint256" }, { type: "uint256" }],
      [l1, 10_000_000n, 321_448_454n],
    ),
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the L1 part on Robinhood", () => {
  // Robinhood mainnet has no factory recorded yet, so it is the testnet entry under its key.
  for (const key of ["robinhood-testnet", "robinhood"]) {
    it(`${key}: read from NodeInterface gasEstimateL1Component, from the relayer`, async () => {
      const chain = { ...getServedEvmChain("robinhood-testnet"), key } as ServedEvmChain;
      const { transport, calls } = transportWith(chain, () => answer(227_961n));
      await expect(transport.l1GasPart?.({ to: DROP, data: DATA })).resolves.toBe(227_961n);

      expect(calls).toHaveLength(1);
      const [args] = calls;
      expect(getAddress(args?.to ?? "0x")).toBe(NODE_INTERFACE);
      const account = args?.account;
      expect(typeof account === "string" ? account : account?.address).toBe(transport.address);
      const decoded = decodeFunctionData({ abi: nodeInterfaceAbi, data: args?.data ?? "0x" });
      expect(decoded.functionName).toBe("gasEstimateL1Component");
      expect(decoded.args).toEqual([DROP, false, DATA]);
    });
  }
});

describe("any other EVM chain", () => {
  it("is 0, with no read", async () => {
    const other = { ...getServedEvmChain("robinhood-testnet"), key: "anvil" } as ServedEvmChain;
    const { transport, calls } = transportWith(other, () => answer(227_961n));
    await expect(transport.l1GasPart?.({ to: DROP, data: DATA })).resolves.toBe(0n);
    expect(calls).toHaveLength(0);
  });
});

describe("a failed or malformed read", () => {
  const cases: [string, () => Promise<{ data?: Hex }>][] = [
    ["the call fails", () => Promise.reject(new Error("rpc https://example.invalid/secret down"))],
    ["no data", () => Promise.resolve({})],
    ["a short answer", () => Promise.resolve({ data: "0x1234" })],
  ];

  for (const [name, call] of cases) {
    it(`${name}: 0, so the whole estimate counts, and one log line names the chain`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { transport } = transportWith(getServedEvmChain("robinhood-testnet"), call);
      await expect(transport.l1GasPart?.({ to: DROP, data: DATA })).resolves.toBe(0n);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls.flat().map(String).join(" ");
      expect(line).toContain("robinhood-testnet");
      // Never the error itself: an rpc url can carry a key.
      expect(line).not.toContain("example.invalid");
    });
  }
});

/**
 * The whole write side, end to end, against a real EVM.
 *
 * Anvil, the real `DropFactoryV1` and `DropV1` bytecode out of `contracts/evm/out`, the real
 * relayer signing real transactions, and the real worker. Create, fund by a plain transfer,
 * activate, pay. The only fake left is x.com.
 *
 * **Why this test earns its runtime.** Everything else in this suite runs against
 * `test/fake-chain.ts`, which is right about the shapes but cannot be wrong the way a chain can:
 * gas estimation, nonces, CREATE2, event encoding, the claim bitmap. This one proves the api
 * against the same bytecode that is deployed on Robinhood testnet.
 *
 * It **skips itself** when anvil is not installed or the contracts have not been built, because
 * `contracts/evm/out` is gitignored and a fresh clone does not have it. It never fails for that
 * reason: it says why it skipped.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeployedChain } from "@dropchad/chains";
import { dropFactoryV1Abi, dropV1Abi } from "@dropchad/shared";
import {
  createWalletClient,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createReadClient, createViemRelayerTransport, toViemChain } from "../src/chain/client.js";
import { createDbGasBudget } from "../src/chain/gas-budget.js";
import type { ChainAdapters } from "../src/chain/adapter.js";
import { createChainGateway } from "../src/chain/gateway.js";
import { createRelayer } from "../src/chain/relayer.js";
import { createDbRecorder } from "../src/chain/write-side.js";
import { CSRF_HEADER } from "../src/auth/session.js";
import type { Database } from "../src/db/client.js";
import { drops } from "../src/db/schema.js";
import { createDropEventBus, type DropEvent } from "../src/worker/events.js";
import { createWorker } from "../src/worker/worker.js";
import { eq } from "drizzle-orm";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

// Anvil's standard test accounts. These keys are published in Foundry's own documentation and
// only ever control play money on a local node.
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const RELAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const FUNDER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;

/** Three addresses that have never held anything, so a balance of zero proves the payout. */
const RECEIVERS: Address[] = [
  getAddress("0x1111111111111111111111111111111111110001"),
  getAddress("0x2222222222222222222222222222222222220002"),
  getAddress("0x3333333333333333333333333333333333330003"),
];
const AMOUNT = parseEther("0.1");
/** 100 bps, as on both testnets. */
const FEE = (AMOUNT * 3n * 100n) / 10_000n;
const CHAIN_ID = 46630;
const PORT = 8547;
const RPC_URL = `http://127.0.0.1:${String(PORT)}`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "contracts", "evm", "out");

function artifactBytecode(file: string, name: string): Hex {
  const json = JSON.parse(readFileSync(join(outDir, file, `${name}.json`), "utf8")) as {
    bytecode: { object: string };
  };
  return json.bytecode.object as Hex;
}

/** The registry entry this test runs against. Anvil, standing in for chain 46630. */
function anvilChain(factory: Address, implementation: Address): DeployedChain {
  return {
    key: "anvil",
    name: "Anvil",
    kind: "testnet",
    family: "evm",
    chainId: CHAIN_ID,
    status: "active",
    displayOrder: null,
    nativeSymbol: "ETH",
    explorer: null,
    explorerKind: null,
    rpcEnv: "ANVIL_RPC_URL",
    archiveRpcEnv: null,
    fallbackRpcEnv: null,
    finalityDepth: null,
    contracts: { factory, implementation, deployBlock: 0 },
    launchpadFactories: [],
    quickTokens: [],
  } as unknown as DeployedChain;
}

const anvilBinary = process.platform === "win32" ? "anvil.exe" : "anvil";
const contractsBuilt = existsSync(join(outDir, "DropFactoryV1.sol", "DropFactoryV1.json"));

let anvil: ChildProcess | undefined;
let started = false;
let skipReason = "";

async function waitForAnvil(): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

beforeAll(async () => {
  if (!contractsBuilt) {
    skipReason = "contracts/evm/out is missing. Run: cd contracts/evm && forge build";
    return;
  }

  try {
    anvil = spawn(anvilBinary, [
      "--port",
      String(PORT),
      "--chain-id",
      String(CHAIN_ID),
      "--silent",
    ]);
  } catch {
    skipReason = "anvil is not installed";
    return;
  }

  anvil.on("error", () => {
    skipReason = "anvil could not be started";
  });

  started = await waitForAnvil();
  if (!started) skipReason = skipReason || "anvil did not come up on time";
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

describe("create, fund, activate, pay, on a real EVM", () => {
  it("runs the whole flow", async () => {
    if (!started) {
      console.log(`skipping the anvil test: ${skipReason}`);
      return;
    }

    // ---------------------------------------------------------------------
    // 1. deploy the same bytecode that is on Robinhood testnet
    // ---------------------------------------------------------------------
    const deployer = privateKeyToAccount(DEPLOYER_KEY);
    const relayerAccount = privateKeyToAccount(RELAYER_KEY);
    const bootChain = anvilChain(deployer.address, deployer.address);
    const viemChain = toViemChain(bootChain, RPC_URL);
    const publicClient: PublicClient = createReadClient(bootChain, RPC_URL);
    const deployerWallet = createWalletClient({
      account: deployer,
      chain: viemChain,
      transport: http(RPC_URL),
    });

    const implHash = await deployerWallet.deployContract({
      abi: dropV1Abi,
      bytecode: artifactBytecode("DropV1.sol", "DropV1"),
      args: [],
    });
    const implementation = (await publicClient.waitForTransactionReceipt({ hash: implHash }))
      .contractAddress as Address;

    const factoryHash = await deployerWallet.deployContract({
      abi: dropFactoryV1Abi,
      bytecode: artifactBytecode("DropFactoryV1.sol", "DropFactoryV1"),
      args: [deployer.address, implementation, deployer.address],
    });
    const factory = (await publicClient.waitForTransactionReceipt({ hash: factoryHash }))
      .contractAddress as Address;

    // without this, `createDrop` reverts with `NotAllowedCreator`.
    const allowHash = await deployerWallet.writeContract({
      address: factory,
      abi: dropFactoryV1Abi,
      functionName: "setCreatorAllowed",
      args: [relayerAccount.address, true],
      chain: viemChain,
    });
    await publicClient.waitForTransactionReceipt({ hash: allowHash });

    // the fee has to cover the relayer's gas, so the factory charges 1 percent.
    const feeHash = await deployerWallet.writeContract({
      address: factory,
      abi: dropFactoryV1Abi,
      functionName: "setDefaultFeeBps",
      args: [100],
      chain: viemChain,
    });
    await publicClient.waitForTransactionReceipt({ hash: feeHash });

    // Gas money for the relayer, and nothing else. It never holds drop funds.
    const funderWallet = createWalletClient({
      account: privateKeyToAccount(FUNDER_KEY),
      chain: viemChain,
      transport: http(RPC_URL),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await funderWallet.sendTransaction({
        to: relayerAccount.address,
        value: parseEther("1"),
        chain: viemChain,
        account: privateKeyToAccount(FUNDER_KEY),
      }),
    });

    // ---------------------------------------------------------------------
    // 2. the real api, over the real relayer
    // ---------------------------------------------------------------------
    const chain = anvilChain(factory, implementation);
    const events = createDropEventBus();
    const seen: DropEvent[] = [];

    const buildWriteSide = (db: Database) => {
      const transport = createViemRelayerTransport({
        chain,
        rpcUrls: RPC_URL,
        privateKey: RELAYER_KEY,
        publicClient,
      });
      const relayer = createRelayer({
        transport,
        factory,
        isKnownDrop: async (address) =>
          (
            await db
              .select({ address: drops.address })
              .from(drops)
              .where(eq(drops.address, address.toLowerCase()))
              .limit(1)
          ).length === 1,
        gasBudget: createDbGasBudget({
          db,
          chainId: CHAIN_ID,
          dailyLimitWei: parseEther("1"),
          now: () => new Date(),
        }),
        gasCaps: { createDrop: 3_000_000n, claimBatch: 5_000_000n, claimHandle: 300_000n },
        recorder: createDbRecorder(db, CHAIN_ID, "robinhood-testnet"),
      });
      return {
        chain: createChainGateway({
          publicClient,
          relayer,
          chainId: CHAIN_ID,
          version: 1,
          factory,
          implementation,
        }),
        chainName: "Anvil",
      };
    };

    const harness: Harness = await createHarness({ events, writeSideFor: buildWriteSide });
    // The clock has to be real here: the funding deadline is a real timestamp on a real chain.
    harness.setNow(new Date());

    try {
      const { jar } = await login(harness);
      const headers = {
        cookie: cookieHeader(jar),
        [CSRF_HEADER]: jar["dc_csrf"] ?? "",
        "content-type": "application/json",
      };

      // -------------------------------------------------------------------
      // 3. create
      // -------------------------------------------------------------------
      const created = await harness.app.request("/api/drops", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: "address",
          receivers: RECEIVERS.map((address) => ({ address, amount: AMOUNT.toString() })),
          refundRecipient: deployer.address,
          title: "anvil end to end",
        }),
      });
      expect(created.status).toBe(201);

      const payload = (await created.json()) as {
        drop: { address: Address; grossRequiredWei: string; manifestHash: Hex };
        funding: { paymentUri: string; amountWei: string };
      };
      const dropAddress = getAddress(payload.drop.address);
      expect(payload.drop.grossRequiredWei).toBe((AMOUNT * 3n + FEE).toString());
      expect(payload.funding.paymentUri).toBe(
        `ethereum:${dropAddress}@46630?value=${(AMOUNT * 3n + FEE).toString()}`,
      );

      // The address the api predicted really has a contract on it now.
      expect(await publicClient.getCode({ address: dropAddress })).toMatch(/^0x[0-9a-f]+$/);

      events.subscribe(dropAddress, (event) => seen.push(event));

      // What the relayer holds before any of the drop money moves. It must only ever go down,
      // and only by gas.: gas money only, never drop funds.
      const relayerBefore = await publicClient.getBalance({ address: relayerAccount.address });

      // -------------------------------------------------------------------
      // 4. fund it with a plain transfer, the way a sender would
      // -------------------------------------------------------------------
      await publicClient.waitForTransactionReceipt({
        hash: await funderWallet.sendTransaction({
          to: dropAddress,
          value: BigInt(payload.funding.amountWei),
          chain: viemChain,
          account: privateKeyToAccount(FUNDER_KEY),
        }),
      });

      // -------------------------------------------------------------------
      // 5. the worker does the rest
      // -------------------------------------------------------------------
      const worker = createWorker({
        db: harness.deps.db,
        chains: harness.deps.writeSides as ChainAdapters,
        events,
        now: () => new Date(),
        pollMs: 10,
      });
      await worker.drain();

      // -------------------------------------------------------------------
      // 6. what actually happened on chain
      // -------------------------------------------------------------------
      for (const receiver of RECEIVERS) {
        expect(await publicClient.getBalance({ address: receiver })).toBe(AMOUNT);
      }
      // Everything went out. The drop holds nothing.
      expect(await publicClient.getBalance({ address: dropAddress })).toBe(0n);
      // `status` is `Active`, 1: claimed out, but the claim window is still open.
      expect(
        await publicClient.readContract({
          address: dropAddress,
          abi: dropV1Abi,
          functionName: "status",
        }),
      ).toBe(1);
      expect(
        await publicClient.readContract({
          address: dropAddress,
          abi: dropV1Abi,
          functionName: "claimedCount",
        }),
      ).toBe(3);

      // The relayer paid gas and received nothing. Not one wei of the drop came back to it.
      const relayerAfter = await publicClient.getBalance({ address: relayerAccount.address });
      expect(relayerAfter).toBeLessThan(relayerBefore);
      expect(relayerBefore - relayerAfter).toBeLessThan(parseEther("0.01"));

      // -------------------------------------------------------------------
      // 7. and what the api says about it
      // -------------------------------------------------------------------
      const row = (
        await harness.deps.db
          .select()
          .from(drops)
          .where(eq(drops.address, dropAddress.toLowerCase()))
      )[0];
      expect(row?.state).toBe("finished");
      expect(row?.paidCount).toBe(3);
      expect(row?.failedIndexes).toEqual([]);

      expect(seen.map((event) => event.type)).toEqual([
        "funding_seen",
        "activated",
        "claim_paid",
        "claim_paid",
        "claim_paid",
        "finished",
      ]);

      const manifest = await harness.app.request(
        `/api/drops/${dropAddress.toLowerCase()}/manifest`,
      );
      expect(manifest.headers.get("x-dropchad-manifest-hash")).toBe(payload.drop.manifestHash);

      // This flow makes a multisend, and a multisend has no share card.
      const share = await harness.app.request(`/api/drops/${dropAddress.toLowerCase()}/share`);
      expect(share.status).toBe(404);
      expect(await share.json()).toEqual({ error: "no_share_card" });
    } finally {
      await harness.close();
    }
  }, 120_000);
});

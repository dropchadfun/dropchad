/**
 * The whole Solana flow against the **real compiled program** on LiteSVM: create, fund, activate,
 * pay, refund, close. The twin of `anvil.integration.test.ts`.
 *
 * It needs two things that are not in the repo: the `litesvm` Node binding, which ships no
 * Windows binary, and the program
 * `contracts/solana/target/deploy/dropchad.so`, which `anchor build` writes on the local
 * machine. Missing either, the test **skips itself and says why**, so the suite is green on
 * Windows and the proof runs in WSL:
 *
 *   npx vitest run test/litesvm.integration.test.ts   (from apps/api, in WSL, after npm install)
 *
 * Written against the litesvm 1.4.1 typings, which take `@solana/kit` shapes: a transaction is
 * `{ messageBytes, signatures }` and an address is a base58 string. Not executed on the machine
 * this was written on; the first WSL run is the proof.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { buildDropTree } from "@dropchad/shared";
import { getChain } from "@dropchad/chains";
import { describe, expect, it } from "vitest";

import { CONFIG_ACCOUNT_BYTES_HANDLE, decodeConfig } from "../src/chain/svm/accounts.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import {
  adminInstruction,
  checkAdminCall,
  checkReadBack,
  type AdminAction,
} from "../src/chain/svm/admin.js";
import { randomSigner, type Signer } from "../src/chain/svm/keypair.js";
import { configPda } from "../src/chain/svm/pda.js";
import {
  DROPCHAD_PROGRAM_ID,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import type { AccountInfo, SvmRpc, TransactionMeta } from "../src/chain/svm/rpc.js";
import { compileMessage, signTransaction } from "../src/chain/svm/transaction.js";
import { unblindedCommitment } from "../src/chain/predict.js";
import { nativeDropFee } from "../src/drops/native-fee.js";
import { decodeTransaction, encodeConfigAccount, rentFor } from "./fake-svm.js";
import { liveDevnetConfig, withOurKeys } from "./live-config.js";

const PROGRAM_SO = resolve(
  import.meta.dirname,
  "../../../contracts/solana/target/deploy/dropchad.so",
);

/** The slice of the litesvm 1.4.1 surface this test uses. */
interface LiteSvmLike {
  addProgramFromFile(programId: string, path: string): void;
  setAccount(account: {
    address: string;
    data: Uint8Array;
    executable: boolean;
    lamports: bigint;
    programAddress: string;
  }): void;
  getAccount(address: string): {
    exists: boolean;
    data?: Uint8Array;
    lamports?: bigint;
    programAddress?: string;
  };
  airdrop(address: string, lamports: bigint): unknown;
  minimumBalanceForRentExemption(dataLen: bigint): bigint;
  latestBlockhash(): string;
  getBalance(address: string): bigint | null;
  sendTransaction(tx: {
    messageBytes: Uint8Array;
    signatures: Record<string, Uint8Array | null>;
  }): {
    err?: () => unknown;
    meta?: () => { logs(): string[]; computeUnitsConsumed(): bigint };
    logs?: () => string[];
    computeUnitsConsumed?: () => bigint;
  };
  simulateTransaction(tx: {
    messageBytes: Uint8Array;
    signatures: Record<string, Uint8Array | null>;
  }): {
    err?: () => unknown;
    meta(): { logs(): string[]; computeUnitsConsumed(): bigint };
  };
  setClock(clock: unknown): void;
  getClock(): {
    unixTimestamp: bigint;
    slot: bigint;
    epochStartTimestamp: bigint;
    epoch: bigint;
    leaderScheduleEpoch: bigint;
  };
}

async function loadLiteSvm(): Promise<{
  LiteSVM: new () => LiteSvmLike;
  Clock: new (...args: bigint[]) => unknown;
} | null> {
  try {
    const name = "litesvm";
    const mod = (await import(name)) as {
      LiteSVM: new () => LiteSvmLike;
      Clock: new (...args: bigint[]) => unknown;
    };
    return mod;
  } catch {
    return null;
  }
}

const lite = await loadLiteSvm();
const available = lite !== null && existsSync(PROGRAM_SO);
const reason =
  lite === null
    ? "litesvm is not installed or has no binary for this platform"
    : `no program at ${PROGRAM_SO}`;

/** Our `SvmRpc` over a LiteSVM instance, so the real relayer and adapter drive it unchanged. */
function rpcOver(svm: LiteSvmLike, relayer: Pubkey): SvmRpc {
  const metas = new Map<string, TransactionMeta>();
  let height = 1;
  const info = (key: Pubkey): AccountInfo | null => {
    const account = svm.getAccount(pubkeyToBase58(key));
    if (!account.exists) return null;
    return {
      lamports: account.lamports ?? 0n,
      owner: pubkeyFromBase58(account.programAddress ?? "11111111111111111111111111111111"),
      data: account.data ?? new Uint8Array(),
      executable: false,
    };
  };
  const toKit = (bytes: Uint8Array) => {
    const { signatures, message } = decodeTransaction(bytes);
    const record: Record<string, Uint8Array | null> = {};
    message.accountKeys.slice(0, message.header.numRequiredSignatures).forEach((key, i) => {
      record[pubkeyToBase58(key)] = signatures[i] ?? null;
    });
    // Signatures first, then the message: what `serializeMessage` wrote after the shortvec.
    const sigBytes = 1 + 64 * signatures.length;
    return {
      messageBytes: bytes.slice(sigBytes),
      signatures: record,
      message,
      signature: pubkeyToBase58(signatures[0] as Uint8Array),
    };
  };
  const errOf = (result: { err?: () => unknown; meta?: () => { logs(): string[] } }): unknown => {
    const err = result.err?.();
    if (err === undefined || err === null) return null;
    // litesvm 1.4.1 (`dist/internal.d.ts`): `TransactionErrorInstructionError` has `index` as a
    // field and `err()` as a method; `InstructionErrorCustom` has `code` as a field. Any other
    // error is a class with `toString()` or a number from a fieldless enum.
    const record = err as { index?: unknown; err?: () => unknown };
    const inner = typeof record.err === "function" ? record.err() : undefined;
    const code = (inner as { code?: unknown } | undefined)?.code;
    const index = typeof record.index === "number" ? record.index : 0;
    // Every litesvm error class has its own `toString()`; a fieldless enum is a plain number.
    const text = (value: unknown): string =>
      typeof value === "number" ? `${value}` : (value as { toString(): string }).toString();
    // The proof runs by hand in WSL: print the real error and the program logs, so a failure
    // says why before the relayer turns it into its own error.
    console.error(
      `litesvm transaction failed: ${text(err)}${inner === undefined ? "" : ` / ${text(inner)}`}\n` +
        (result.meta?.().logs() ?? []).join("\n"),
    );
    return typeof code === "number"
      ? { InstructionError: [index, { Custom: code }] }
      : { InstructionError: [index, text(inner ?? err)] };
  };
  return {
    getAccountInfo: (key) => Promise.resolve(info(key)),
    getMultipleAccounts: (keys) => Promise.resolve(keys.map(info)),
    getBalance: (key) => Promise.resolve(svm.getBalance(pubkeyToBase58(key)) ?? 0n),
    getMinimumBalanceForRentExemption: (n) =>
      Promise.resolve(svm.minimumBalanceForRentExemption(BigInt(n))),
    getLatestBlockhash: () =>
      Promise.resolve({
        blockhash: pubkeyFromBase58(svm.latestBlockhash()),
        lastValidBlockHeight: height + 1000,
      }),
    getBlockHeight: () => Promise.resolve(height),
    simulateTransaction: (bytes) => {
      const tx = toKit(bytes);
      const result = svm.simulateTransaction({
        messageBytes: tx.messageBytes,
        signatures: tx.signatures,
      });
      const err = errOf(result);
      const meta = result.meta();
      return Promise.resolve({
        err,
        logs: meta.logs(),
        unitsConsumed: Number(meta.computeUnitsConsumed()),
      });
    },
    sendTransaction: (bytes) => {
      const tx = toKit(bytes);
      const before = svm.getBalance(pubkeyToBase58(relayer)) ?? 0n;
      const result = svm.sendTransaction({
        messageBytes: tx.messageBytes,
        signatures: tx.signatures,
      });
      const err = errOf(result);
      const meta = result.meta?.() ?? result;
      height += 1;
      metas.set(tx.signature, {
        slot: height,
        blockTime: Number(svm.getClock().unixTimestamp),
        fee: 5_000n,
        err,
        logMessages: meta.logs?.() ?? [],
        computeUnitsConsumed: Number(meta.computeUnitsConsumed?.() ?? 0n),
        preBalances: [before],
        postBalances: [svm.getBalance(pubkeyToBase58(relayer)) ?? 0n],
        accountKeys: tx.message.accountKeys,
      });
      return Promise.resolve(tx.signature);
    },
    getSignatureStatuses: (sigs) =>
      Promise.resolve(
        sigs.map((s) =>
          metas.has(s)
            ? {
                slot: height,
                confirmationStatus: "confirmed" as const,
                err: metas.get(s)?.err ?? null,
              }
            : null,
        ),
      ),
    getTransaction: (s) => Promise.resolve(metas.get(s) ?? null),
  };
}

describe.skipIf(!available)(
  `the real program on LiteSVM${available ? "" : ` (skipped: ${reason})`}`,
  () => {
    it("creates, funds, activates, pays, refunds and closes a SOL drop", async () => {
      if (lite === null) return;
      const svm = new lite.LiteSVM();
      svm.addProgramFromFile(pubkeyToBase58(DROPCHAD_PROGRAM_ID), PROGRAM_SO);

      const signer = randomSigner();
      const relayerAddress = pubkeyToBase58(signer.publicKey);
      svm.airdrop(relayerAddress, 1_000_000_000n);

      // The Config, written straight in: `initialize_config` wants the upgrade authority, and the
      // authority check is the Rust suite's business. Chain id 103, relayer us, fee zero. The
      // migrated 253 byte layout, the one devnet holds: the program
      // no longer reads the 116 byte one. A random binder; this test makes no handle claim.
      const config = configPda();
      svm.setAccount({
        address: pubkeyToBase58(config.address),
        data: encodeConfigAccount(
          {
            admin: signer.publicKey,
            relayer: signer.publicKey,
            feeWallet: signer.publicKey,
            defaultFeeBps: 0,
            paused: false,
            chainId: 103n,
            handle: {
              binder: randomSigner().publicKey,
              binderRevoked: false,
              minFeeLamports: 0n,
            },
          },
          config.bump,
        ),
        executable: false,
        lamports: rentFor(CONFIG_ACCOUNT_BYTES_HANDLE),
        programAddress: pubkeyToBase58(DROPCHAD_PROGRAM_ID),
      });

      const rpc = rpcOver(svm, signer.publicKey);
      const known = new Set<string>();
      const relayer = createSvmRelayer({
        rpc,
        signer,
        isKnownDrop: (a) => Promise.resolve(known.has(a)),
        budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
        caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
        rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
        sleep: () => Promise.resolve(),
      });
      const adapter = createSvmAdapter({
        rpc,
        relayer,
        chain: getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"],
      });

      const LEAF = 10_000_000n;
      const receivers = [0xa1, 0xa2, 0xa3].map((b) => ({
        recipient: pubkeyToBase58(new Uint8Array(32).fill(b)),
        amount: LEAF,
      }));
      const commitment = unblindedCommitment(1234567890n, 0n);
      const predicted = await adapter.predictDrop(commitment, 0n);
      expect(predicted.taken).toBe(false);
      const tree = buildDropTree({
        family: "svm",
        drop: predicted.address,
        chainId: 103,
        receivers,
      });
      const created = await adapter.createDrop({
        merkleRoot: tree.root,
        manifestHash: `0x${"11".repeat(32)}`,
        totalEntitlements: tree.totalEntitlements,
        leafCount: 3,
        refundRecipient: relayerAddress,
        creatorCommitment: commitment,
        nonce: 0n,
        fundingPeriod: 3_600,
        claimPeriod: 86_400,
      });
      known.add(created.drop);
      expect(created.drop).toBe(predicted.address);
      expect(created.merkleRoot).toBe(tree.root);

      // Fund with a plain transfer, 3.3. The airdrop is one.
      svm.airdrop(created.drop, LEAF * 3n);
      expect(await adapter.getSpendableBalance(created.drop)).toBe(LEAF * 3n);
      await adapter.activate(created.drop);
      expect((await adapter.readDrop(created.drop)).status).toBe(1);

      const paid = await adapter.claimBatch(
        created.drop,
        tree.entries.map((e) => ({
          index: e.index,
          recipient: e.recipient,
          amount: e.amount,
          proof: e.proof,
        })),
      );
      expect(paid.paid.map((p) => p.index).sort()).toEqual([0, 1, 2]);
      for (const r of receivers) expect(svm.getBalance(r.recipient)).toBe(LEAF);

      // Past the claim deadline: refund with nothing left, then close, rent back to the relayer.
      const clock = svm.getClock();
      svm.setClock(
        new lite.Clock(
          clock.slot,
          clock.epochStartTimestamp,
          clock.epoch,
          clock.leaderScheduleEpoch,
          clock.unixTimestamp + 86_401n,
        ),
      );
      await adapter.refund(created.drop);
      expect((await adapter.readDrop(created.drop)).status).toBe(2);
      const before = svm.getBalance(relayerAddress) ?? 0n;
      await adapter.closeDrop(created.drop);
      expect((await adapter.readDrop(created.drop)).closed).toBe(true);
      expect((svm.getBalance(relayerAddress) ?? 0n) - before).toBe(rentFor(1291) - 5_000n);
    });

    // The upgraded program on a copy of the live
    // devnet `Config` (`fee_model.rs`), our key in the three key slots. The planned fees are set
    // through the real admin instructions with the checks of `solana-admin.ts`, then the fee the
    // program writes into each new drop must equal the api's `nativeDropFee` and the number.
    it("charges the api's fee on a live Config copy, before and after", async () => {
      if (lite === null) return;
      const svm = new lite.LiteSVM();
      svm.addProgramFromFile(pubkeyToBase58(DROPCHAD_PROGRAM_ID), PROGRAM_SO);

      const signer = randomSigner();
      const relayerAddress = pubkeyToBase58(signer.publicKey);
      svm.airdrop(relayerAddress, 10_000_000_000n);

      const live = liveDevnetConfig();
      expect(live.address).toBe(pubkeyToBase58(configPda().address));
      svm.setAccount({
        address: live.address,
        data: withOurKeys(live.bytes, signer.publicKey),
        executable: false,
        lamports: live.lamports,
        programAddress: pubkeyToBase58(DROPCHAD_PROGRAM_ID),
      });

      const rpc = rpcOver(svm, signer.publicKey);
      const adapter = adapterOver(rpc, signer);
      const readConfig = async () => {
        const info = await rpc.getAccountInfo(configPda().address, "confirmed");
        if (info === null) throw new Error("no Config");
        return decodeConfig(info);
      };

      let nonce = 0n;
      const commitment = unblindedCommitment(1234567890n, 0n);
      /** Creates a SOL drop of `count` people at `each` lamports; the fee the program wrote. */
      const feeOf = async (count: number, each: bigint): Promise<bigint> => {
        const n = nonce++;
        const predicted = await adapter.predictDrop(commitment, n);
        const tree = buildDropTree({
          family: "svm",
          drop: predicted.address,
          chainId: 103,
          receivers: Array.from({ length: count }, (_, i) => ({
            recipient: pubkeyToBase58(new Uint8Array(32).fill(0x10 + i)),
            amount: each,
          })),
        });
        const created = await adapter.createDrop({
          merkleRoot: tree.root,
          manifestHash: `0x${"22".repeat(32)}`,
          totalEntitlements: tree.totalEntitlements,
          leafCount: count,
          refundRecipient: relayerAddress,
          creatorCommitment: commitment,
          nonce: n,
          fundingPeriod: 3_600,
          claimPeriod: 86_400,
        });
        // The api's fee from the same chain read the api makes; `created` is the stored drop.
        const apiFee = nativeDropFee(await adapter.feeConfig(), tree.totalEntitlements, count);
        expect(created.feeAmount).toBe(apiFee);
        return created.feeAmount;
      };

      // Before the settings, the upgrade alone: today's fee, 1% and the 0.0003 SOL flat minimum.
      expect(await adapter.feeConfig()).toEqual({
        bps: 100,
        minFee: 300_000n,
        minFeePerReceiver: 0n,
        maxFee: 0n,
      });
      expect(await feeOf(10, 1_000_000n)).toBe(300_000n);
      expect(await feeOf(1, 1_000_000_000n)).toBe(10_000_000n);

      // The settings, in the runbook order, each checked like `solana-admin.ts` does.
      const settings: AdminAction[] = [
        { kind: "set-fee-per-receiver", lamports: 300_000n },
        { kind: "set-max-fee", lamports: 500_000_000n },
        { kind: "set-min-fee", lamports: 0n },
      ];
      for (const action of settings) {
        const before = await readConfig();
        expect(checkAdminCall(action, before, signer.publicKey).result).toBe("send");
        await sendSigned(rpc, signer, adminInstruction(action, signer.publicKey));
        expect(checkReadBack(action, before, await readConfig())).toEqual([]);
      }
      expect(await adapter.feeConfig()).toEqual({
        bps: 100,
        minFee: 0n,
        minFeePerReceiver: 300_000n,
        maxFee: 500_000_000n,
      });

      // After: with the reference examples. Each also equals the api's fee, inside `feeOf`.
      expect(await feeOf(1, 10_000_000n)).toBe(300_000n); // 0.01 SOL: the per person minimum
      expect(await feeOf(1, 100_000_000n)).toBe(1_000_000n); // 0.1 SOL: 1%
      expect(await feeOf(1, 1_000_000_000n)).toBe(10_000_000n); // 1 SOL: 1%
      expect(await feeOf(1, 100_000_000_000n)).toBe(500_000_000n); // 100 SOL: the cap
      expect(await feeOf(10, 10_000_000n)).toBe(3_000_000n); // 0.1 SOL to 10: per person
      expect(await feeOf(10, 100_000_000n)).toBe(10_000_000n); // 1 SOL to 10: 1%
      expect(await feeOf(10, 1_000_000n)).toBe(3_000_000n); // was 300000 before the settings

      // The brake of the runbook: back to today's fee in three calls.
      const brake: AdminAction[] = [
        { kind: "set-fee-per-receiver", lamports: 0n },
        { kind: "set-max-fee", lamports: 0n },
        { kind: "set-min-fee", lamports: 300_000n },
      ];
      for (const action of brake) {
        const before = await readConfig();
        await sendSigned(rpc, signer, adminInstruction(action, signer.publicKey));
        expect(checkReadBack(action, before, await readConfig())).toEqual([]);
      }
      expect(await feeOf(10, 1_000_000n)).toBe(300_000n);
      // The live bytes after the brake, our keys aside: only the per person and max fee were
      // touched and both are zero again, so the Config is the live copy byte for byte.
      const back = await rpc.getAccountInfo(configPda().address, "confirmed");
      expect(back?.data).toEqual(withOurKeys(live.bytes, signer.publicKey));
    });
  },
);

/** The real relayer and adapter over LiteSVM, every drop known, no budget limit. */
function adapterOver(rpc: SvmRpc, signer: Signer) {
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(true),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  return createSvmAdapter({
    rpc,
    relayer,
    chain: getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"],
  });
}

/** One admin instruction, signed by the admin, sent and confirmed without an error. */
async function sendSigned(
  rpc: SvmRpc,
  signer: Signer,
  instruction: Parameters<typeof compileMessage>[0]["instructions"][number],
): Promise<void> {
  const { blockhash } = await rpc.getLatestBlockhash("confirmed");
  const tx = signTransaction(
    compileMessage({
      feePayer: signer.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }),
    [signer],
  );
  const simulation = await rpc.simulateTransaction(tx.bytes, "confirmed");
  expect(simulation.err).toBeNull();
  const signature = await rpc.sendTransaction(tx.bytes, "confirmed");
  const [status] = await rpc.getSignatureStatuses([signature]);
  expect(status?.err ?? null).toBeNull();
}

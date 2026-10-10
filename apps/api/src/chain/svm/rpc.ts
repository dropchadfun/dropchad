/**
 * The Solana JSON-RPC calls this api makes, and no others.
 *
 * Nine methods over `fetch`. Reads take a commitment: `confirmed` drives the live flow, the same
 * job `seen` does on the EVM side, and `finalized` is what the board and the stats read.
 * Nothing here signs; a transaction arrives already serialized.
 *
 * `fetchImpl` is injectable so the tests run the real request building against a stub, the way
 * the X client is tested.
 */
import { pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "./pubkey.js";

export type Commitment = "processed" | "confirmed" | "finalized";

export interface AccountInfo {
  readonly lamports: bigint;
  readonly owner: Pubkey;
  readonly data: Uint8Array;
  readonly executable: boolean;
}

export interface LatestBlockhash {
  readonly blockhash: Uint8Array;
  readonly lastValidBlockHeight: number;
}

export interface SimulationResult {
  /** `null` when the transaction would succeed. Otherwise the runtime's error object. */
  readonly err: unknown;
  readonly logs: readonly string[];
  readonly unitsConsumed: number | null;
}

export interface SignatureStatus {
  readonly slot: number;
  readonly confirmationStatus: Commitment | null;
  readonly err: unknown;
}

/** The parts of a confirmed transaction the relayer reads. */
export interface TransactionMeta {
  readonly slot: number;
  readonly blockTime: number | null;
  readonly fee: bigint;
  readonly err: unknown;
  readonly logMessages: readonly string[];
  readonly computeUnitsConsumed: number | null;
  readonly preBalances: readonly bigint[];
  readonly postBalances: readonly bigint[];
  /** Account keys of the message, in order, so a balance can be matched to a key. */
  readonly accountKeys: readonly Pubkey[];
}

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    message: string,
    readonly data?: unknown,
  ) {
    super(`${method}: ${message}`);
    this.name = "RpcError";
  }
}

/** A failure worth one more try: `http 429` or a fast network error. */
class RetryableRpcError extends RpcError {}

/** The wait before the one retry. */
const RETRY_MS = 500;

export interface SvmRpc {
  getAccountInfo(pubkey: Pubkey, commitment: Commitment): Promise<AccountInfo | null>;
  getMultipleAccounts(
    pubkeys: readonly Pubkey[],
    commitment: Commitment,
  ): Promise<(AccountInfo | null)[]>;
  getBalance(pubkey: Pubkey, commitment: Commitment): Promise<bigint>;
  getMinimumBalanceForRentExemption(dataLength: number): Promise<bigint>;
  getLatestBlockhash(commitment: Commitment): Promise<LatestBlockhash>;
  getBlockHeight(commitment: Commitment): Promise<number>;
  simulateTransaction(transaction: Uint8Array, commitment: Commitment): Promise<SimulationResult>;
  /** Returns the signature. Preflight is left on: a transaction that fails simulation is not sent. */
  sendTransaction(transaction: Uint8Array, preflightCommitment: Commitment): Promise<string>;
  getSignatureStatuses(signatures: readonly string[]): Promise<(SignatureStatus | null)[]>;
  getTransaction(signature: string, commitment: Commitment): Promise<TransactionMeta | null>;
}

export interface SvmRpcOptions {
  readonly url: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface RpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** A JSON number or numeric string as a bigint; anything else is zero. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "number" || typeof value === "bigint") return BigInt(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  return 0n;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function decodeAccount(value: unknown): AccountInfo | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  const data: unknown = record["data"];
  const base64: unknown = Array.isArray(data) ? (data as unknown[])[0] : undefined;
  if (typeof base64 !== "string" || typeof record["owner"] !== "string") {
    throw new Error("account info has an unexpected shape");
  }
  return {
    lamports: toBigInt(record["lamports"]),
    owner: pubkeyFromBase58(record["owner"]),
    data: new Uint8Array(Buffer.from(base64, "base64")),
    executable: record["executable"] === true,
  };
}

export function createSvmRpc(options: SvmRpcOptions): SvmRpc {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let id = 0;

  /**
   * One call, tried once more after `RETRY_MS` on `http 429` or a fast network error, and never
   * more than once. A timeout already took its full time: no retry.
   */
  async function call(method: string, params: unknown[]): Promise<unknown> {
    try {
      return await callOnce(method, params);
    } catch (error) {
      if (!(error instanceof RetryableRpcError)) throw error;
      // The method and the reason only; the url is a secret when it carries a provider key.
      console.warn(`solana rpc ${error.message}, trying once more`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      return callOnce(method, params);
    }
  }

  async function callOnce(method: string, params: unknown[]): Promise<unknown> {
    id += 1;
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // The url is a secret when it carries a provider key, so it is never in the message.
      const message = `rpc unreachable: ${error instanceof Error ? error.message : "fetch failed"}`;
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw timedOut
        ? new RpcError(method, null, message)
        : new RetryableRpcError(method, null, message);
    }
    if (response.status === 429) throw new RetryableRpcError(method, null, "http 429");
    if (!response.ok) throw new RpcError(method, null, `http ${String(response.status)}`);
    const body = (await response.json()) as RpcResponse;
    if (body.error !== undefined) {
      throw new RpcError(
        method,
        body.error.code ?? null,
        body.error.message ?? "rpc error",
        body.error.data,
      );
    }
    return body.result;
  }

  /** Most reads come back as `{ context, value }`. */
  const valueOf = (result: unknown): unknown => asRecord(result)["value"];

  const base64Of = (tx: Uint8Array) => Buffer.from(tx).toString("base64");

  return {
    async getAccountInfo(pubkey, commitment) {
      const result = await call("getAccountInfo", [
        pubkeyToBase58(pubkey),
        { encoding: "base64", commitment },
      ]);
      return decodeAccount(valueOf(result));
    },

    async getMultipleAccounts(pubkeys, commitment) {
      if (pubkeys.length === 0) return [];
      const result = await call("getMultipleAccounts", [
        pubkeys.map(pubkeyToBase58),
        { encoding: "base64", commitment },
      ]);
      const values = valueOf(result);
      if (!Array.isArray(values)) throw new Error("getMultipleAccounts returned no array");
      return values.map(decodeAccount);
    },

    async getBalance(pubkey, commitment) {
      const result = await call("getBalance", [pubkeyToBase58(pubkey), { commitment }]);
      return toBigInt(valueOf(result));
    },

    async getMinimumBalanceForRentExemption(dataLength) {
      return BigInt(String(await call("getMinimumBalanceForRentExemption", [dataLength])));
    },

    async getLatestBlockhash(commitment) {
      const value = asRecord(valueOf(await call("getLatestBlockhash", [{ commitment }])));
      if (typeof value["blockhash"] !== "string")
        throw new Error("getLatestBlockhash: no blockhash");
      return {
        blockhash: pubkeyFromBase58(value["blockhash"]),
        lastValidBlockHeight: Number(value["lastValidBlockHeight"]),
      };
    },

    async getBlockHeight(commitment) {
      return Number(await call("getBlockHeight", [{ commitment }]));
    },

    async simulateTransaction(transaction, commitment) {
      const value = asRecord(
        valueOf(
          await call("simulateTransaction", [
            base64Of(transaction),
            { encoding: "base64", commitment, sigVerify: false, replaceRecentBlockhash: true },
          ]),
        ),
      );
      const logs = value["logs"];
      return {
        err: value["err"] ?? null,
        logs: Array.isArray(logs) ? logs.filter((l): l is string => typeof l === "string") : [],
        unitsConsumed: value["unitsConsumed"] === undefined ? null : Number(value["unitsConsumed"]),
      };
    },

    async sendTransaction(transaction, preflightCommitment) {
      const result = await call("sendTransaction", [
        base64Of(transaction),
        { encoding: "base64", preflightCommitment, skipPreflight: false, maxRetries: 3 },
      ]);
      if (typeof result !== "string") throw new Error("sendTransaction returned no signature");
      return result;
    },

    async getSignatureStatuses(signatures) {
      const values = valueOf(
        await call("getSignatureStatuses", [signatures, { searchTransactionHistory: true }]),
      );
      if (!Array.isArray(values)) throw new Error("getSignatureStatuses returned no array");
      return values.map((entry) => {
        if (entry === null || entry === undefined) return null;
        const record = asRecord(entry);
        const status = record["confirmationStatus"];
        return {
          slot: Number(record["slot"]),
          confirmationStatus:
            status === "processed" || status === "confirmed" || status === "finalized"
              ? status
              : null,
          err: record["err"] ?? null,
        };
      });
    },

    async getTransaction(signature, commitment) {
      const result = await call("getTransaction", [
        signature,
        { encoding: "json", commitment, maxSupportedTransactionVersion: 0 },
      ]);
      if (result === null || result === undefined) return null;
      const record = asRecord(result);
      const meta = asRecord(record["meta"]);
      const message = asRecord(asRecord(record["transaction"])["message"]);
      const keys = message["accountKeys"];
      const logs = meta["logMessages"];
      const toBigints = (list: unknown): bigint[] =>
        Array.isArray(list) ? list.map((n) => BigInt(String(n))) : [];
      return {
        slot: Number(record["slot"]),
        blockTime:
          record["blockTime"] === null || record["blockTime"] === undefined
            ? null
            : Number(record["blockTime"]),
        fee: toBigInt(meta["fee"]),
        err: meta["err"] ?? null,
        logMessages: Array.isArray(logs)
          ? logs.filter((l): l is string => typeof l === "string")
          : [],
        computeUnitsConsumed:
          meta["computeUnitsConsumed"] === undefined ? null : Number(meta["computeUnitsConsumed"]),
        preBalances: toBigints(meta["preBalances"]),
        postBalances: toBigints(meta["postBalances"]),
        accountKeys: Array.isArray(keys)
          ? keys
              .map((k) => (typeof k === "string" ? k : asRecord(k)["pubkey"]))
              .filter((k): k is string => typeof k === "string")
              .map(pubkeyFromBase58)
          : [],
      };
    },
  };
}

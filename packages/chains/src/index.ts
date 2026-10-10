/**
 * `@dropchad/chains` — the chain registry as a typed package.
 *
 * `chains.json` stays plain JSON on purpose, so a foundry script, the frontend, the indexer and a
 * human all read the same bytes. This module adds types and a runtime check on top of it.
 *
 * Rules that live here and nowhere else:
 * - **Only env var names are in the registry**, never a URL and never a key. `rpcUrlFor` is the
 *   one place that turns a name into a value, and it fails loudly when the value is missing.
 * - A chain is usable when `status` is `active` **and** `contracts.factory` is set. Those are two
 *   different questions and `isDeployed` is the only place they are combined.
 */
import rawRegistry from "./chains.json" with { type: "json" };

import type {
  Chain,
  ChainFamily,
  ChainKind,
  ChainRegistry,
  ChainStatus,
  DeployedChain,
  DeployedProgramChain,
  ExplorerKind,
  FeeModelContractsChain,
  HandleContractsChain,
  TokenDropContractsChain,
  LaunchpadFactory,
  QuickToken,
} from "./types.js";

export type {
  Chain,
  ChainContracts,
  ChainFamily,
  ChainKind,
  ChainRegistry,
  ChainStatus,
  DeployedChain,
  DeployedProgramChain,
  ExplorerKind,
  FeeModelContractsChain,
  HandleContractsChain,
  TokenDropContractsChain,
  LaunchpadFactory,
  QuickToken,
} from "./types.js";

const FAMILIES: readonly ChainFamily[] = ["evm", "svm", "tvm"];
const KINDS: readonly ChainKind[] = ["mainnet", "testnet"];
const STATUSES: readonly ChainStatus[] = ["active", "coming_soon"];
const EXPLORER_KINDS: readonly ExplorerKind[] = ["blockscout", "etherscan", "solana"];

export class ChainRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainRegistryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ChainRegistryError(`${where}: "${key}" must be a non empty string`);
  }
  return value;
}

function requireEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  where: string,
): T {
  const value = source[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ChainRegistryError(`${where}: "${key}" must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function nullableEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  where: string,
): T | null {
  return source[key] === null ? null : requireEnum(source, key, allowed, where);
}

function nullableString(
  source: Record<string, unknown>,
  key: string,
  where: string,
): string | null {
  return source[key] === null ? null : requireString(source, key, where);
}

function nullableInt(source: Record<string, unknown>, key: string, where: string): number | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ChainRegistryError(`${where}: "${key}" must be a non negative integer or null`);
  }
  return value;
}

function parseLaunchpadFactory(raw: unknown, where: string): LaunchpadFactory {
  if (!isRecord(raw)) throw new ChainRegistryError(`${where}: launchpad factory must be an object`);
  return {
    key: requireString(raw, "key", where),
    address: requireString(raw, "address", where),
    adapter: nullableString(raw, "adapter", where),
    startBlock: nullableInt(raw, "startBlock", where),
  };
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A base58 Solana address: 32 to 44 characters, no `0`, `O`, `I` or `l`. */
const SVM_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Our own logo files only: `/tokens/usdc.png`, never a link elsewhere. */
const LOGO_PATH = /^\/tokens\/[a-z0-9-]+\.png$/;

/**
 * `quickTokens`: a ticker of 1 to 10 characters, an exact address in the
 * chain's own format, each address once, a name of 1 to 32 characters and our own logo or
 * `null`. Only evm and svm chains can carry any.
 */
function parseQuickTokens(raw: unknown, family: ChainFamily, where: string): QuickToken[] {
  if (!Array.isArray(raw)) {
    throw new ChainRegistryError(`${where}: "quickTokens" must be an array`);
  }
  const format = family === "evm" ? EVM_ADDRESS : family === "svm" ? SVM_ADDRESS : null;
  const seen = new Set<string>();
  return raw.map((entry: unknown) => {
    if (!isRecord(entry)) throw new ChainRegistryError(`${where}: a quick token must be an object`);
    const symbol = entry["symbol"];
    if (typeof symbol !== "string" || symbol.length < 1 || symbol.length > 10) {
      throw new ChainRegistryError(`${where}: a quick token "symbol" must be 1 to 10 characters`);
    }
    const address = entry["address"];
    if (typeof address !== "string" || format === null || !format.test(address)) {
      throw new ChainRegistryError(
        `${where}: quick token ${symbol} "address" is not a ${family} token address`,
      );
    }
    const key = family === "evm" ? address.toLowerCase() : address;
    if (seen.has(key)) {
      throw new ChainRegistryError(`${where}: quick token ${address} is listed twice`);
    }
    seen.add(key);
    const name = entry["name"];
    if (typeof name !== "string" || name.length < 1 || name.length > 32) {
      throw new ChainRegistryError(
        `${where}: quick token ${symbol} "name" must be 1 to 32 characters`,
      );
    }
    const logo = entry["logo"];
    if (logo !== null && (typeof logo !== "string" || !LOGO_PATH.test(logo))) {
      throw new ChainRegistryError(
        `${where}: quick token ${symbol} "logo" must be null or one of ours, /tokens/<name>.png`,
      );
    }
    return { symbol, address, name, logo };
  });
}

function parseChain(raw: unknown, position: number): Chain {
  if (!isRecord(raw)) throw new ChainRegistryError(`chains[${position}] must be an object`);
  const key = requireString(raw, "key", `chains[${position}]`);
  const where = `chain "${key}"`;

  const contracts = raw["contracts"];
  if (!isRecord(contracts)) throw new ChainRegistryError(`${where}: "contracts" must be an object`);

  const launchpads = raw["launchpadFactories"];
  if (!Array.isArray(launchpads)) {
    throw new ChainRegistryError(`${where}: "launchpadFactories" must be an array`);
  }

  const kind = requireEnum(raw, "kind", KINDS, where);
  const family = requireEnum(raw, "family", FAMILIES, where);
  const testnetOf = raw["testnetOf"];
  if (kind === "testnet" && typeof testnetOf !== "string") {
    throw new ChainRegistryError(`${where}: a testnet entry needs "testnetOf"`);
  }

  const chain: Chain = {
    key,
    name: requireString(raw, "name", where),
    kind,
    ...(typeof testnetOf === "string" ? { testnetOf } : {}),
    family,
    chainId: nullableInt(raw, "chainId", where),
    status: requireEnum(raw, "status", STATUSES, where),
    displayOrder: nullableInt(raw, "displayOrder", where),
    nativeSymbol: requireString(raw, "nativeSymbol", where),
    explorer: nullableString(raw, "explorer", where),
    explorerKind: nullableEnum(raw, "explorerKind", EXPLORER_KINDS, where),
    explorerQuery: nullableString(raw, "explorerQuery", where),
    rpcEnv: nullableString(raw, "rpcEnv", where),
    archiveRpcEnv: nullableString(raw, "archiveRpcEnv", where),
    fallbackRpcEnv: nullableString(raw, "fallbackRpcEnv", where),
    finalityDepth: nullableInt(raw, "finalityDepth", where),
    contracts: {
      factory: nullableString(contracts, "factory", where),
      implementation: nullableString(contracts, "implementation", where),
      deployBlock: nullableInt(contracts, "deployBlock", where),
      program: nullableString(contracts, "program", where),
      deploySlot: nullableInt(contracts, "deploySlot", where),
      factoryV2: nullableString(contracts, "factoryV2", where),
      implementationV2: nullableString(contracts, "implementationV2", where),
      binderRegistry: nullableString(contracts, "binderRegistry", where),
      deployBlockV2: nullableInt(contracts, "deployBlockV2", where),
      factoryV3: nullableString(contracts, "factoryV3", where),
      implementationV3: nullableString(contracts, "implementationV3", where),
      deployBlockV3: nullableInt(contracts, "deployBlockV3", where),
      factoryV4: nullableString(contracts, "factoryV4", where),
      implementationV4: nullableString(contracts, "implementationV4", where),
      deployBlockV4: nullableInt(contracts, "deployBlockV4", where),
    },
    launchpadFactories: launchpads.map((entry) => parseLaunchpadFactory(entry, where)),
    quickTokens: parseQuickTokens(raw["quickTokens"], family, where),
  };

  if (chain.family === "evm" && chain.chainId === null) {
    throw new ChainRegistryError(`${where}: an evm chain needs a chainId`);
  }
  if (chain.family === "svm" && chain.chainId === null) {
    throw new ChainRegistryError(`${where}: an svm chain needs the leaf chain id`);
  }
  if (chain.family !== "svm" && chain.contracts.program !== null) {
    throw new ChainRegistryError(`${where}: only an svm chain has a program`);
  }
  if (chain.family === "svm" && chain.contracts.factory !== null) {
    throw new ChainRegistryError(`${where}: an svm chain has no factory`);
  }
  // Handle mode. All four or none, so a deploy can never land half recorded.
  const v2 = [
    chain.contracts.factoryV2,
    chain.contracts.implementationV2,
    chain.contracts.binderRegistry,
    chain.contracts.deployBlockV2,
  ];
  const v2Set = v2.filter((value) => value !== null).length;
  if (v2Set > 0 && chain.family !== "evm") {
    throw new ChainRegistryError(`${where}: the handle mode V2 fields are evm only`);
  }
  if (v2Set !== 0 && v2Set !== v2.length) {
    throw new ChainRegistryError(
      `${where}: factoryV2, implementationV2, binderRegistry, deployBlockV2: all four or none`,
    );
  }
  // Robinhood token drops. All three or none, evm only, and only on top of the V2 set.
  const v3 = [
    chain.contracts.factoryV3,
    chain.contracts.implementationV3,
    chain.contracts.deployBlockV3,
  ];
  const v3Set = v3.filter((value) => value !== null).length;
  if (v3Set > 0 && chain.family !== "evm") {
    throw new ChainRegistryError(`${where}: the token drop V3 fields are evm only`);
  }
  if (v3Set !== 0 && v3Set !== v3.length) {
    throw new ChainRegistryError(
      `${where}: factoryV3, implementationV3, deployBlockV3: all three or none`,
    );
  }
  if (v3Set > 0 && v2Set === 0) {
    throw new ChainRegistryError(
      `${where}: the V3 fields need the V2 set, DropV3 reads the live BinderRegistry`,
    );
  }
  // The new fee on Robinhood. All three or none, evm only, only on top of the V3 set, and
  // the same `DropV3` as V3.
  const v4 = [
    chain.contracts.factoryV4,
    chain.contracts.implementationV4,
    chain.contracts.deployBlockV4,
  ];
  const v4Set = v4.filter((value) => value !== null).length;
  if (v4Set > 0 && chain.family !== "evm") {
    throw new ChainRegistryError(`${where}: the fee model V4 fields are evm only`);
  }
  if (v4Set !== 0 && v4Set !== v4.length) {
    throw new ChainRegistryError(
      `${where}: factoryV4, implementationV4, deployBlockV4: all three or none`,
    );
  }
  if (v4Set > 0 && v3Set === 0) {
    throw new ChainRegistryError(
      `${where}: the V4 fields need the V3 set, DropFactoryV4 clones the V3 DropV3`,
    );
  }
  if (
    v4Set > 0 &&
    chain.contracts.implementationV4?.toLowerCase() !==
      chain.contracts.implementationV3?.toLowerCase()
  ) {
    throw new ChainRegistryError(
      `${where}: implementationV4 must equal implementationV3, V4 clones the same DropV3`,
    );
  }
  if (chain.explorerQuery !== null && chain.explorerQuery.includes("?")) {
    throw new ChainRegistryError(`${where}: explorerQuery is written without the "?"`);
  }
  return chain;
}

/**
 * Validate an unknown value as a chain registry. Exported so a test can feed it a broken document
 * and prove the check bites, instead of trusting that it would.
 */
export function parseRegistry(raw: unknown): ChainRegistry {
  if (!isRecord(raw)) throw new ChainRegistryError("registry must be an object");
  const version = raw["version"];
  if (version !== 1) {
    throw new ChainRegistryError(`unsupported registry version: ${String(version)}`);
  }

  const list = raw["chains"];
  if (!Array.isArray(list) || list.length === 0) {
    throw new ChainRegistryError(`registry needs a non empty "chains" array`);
  }

  const chains = list.map((entry, position) => parseChain(entry, position));

  const seen = new Set<string>();
  for (const chain of chains) {
    if (seen.has(chain.key)) throw new ChainRegistryError(`duplicate chain key: ${chain.key}`);
    seen.add(chain.key);
  }
  for (const chain of chains) {
    if (chain.testnetOf !== undefined && !seen.has(chain.testnetOf)) {
      throw new ChainRegistryError(
        `chain "${chain.key}": testnetOf "${chain.testnetOf}" not found`,
      );
    }
  }
  return { version, chains };
}

/** The parsed registry. Parsing happens once, at import, so a broken file fails immediately. */
export const registry: ChainRegistry = parseRegistry(rawRegistry);

/** Every chain in the registry, in file order. */
export const chains: readonly Chain[] = registry.chains;

/** The chain with this key, or `undefined`. Use `getChain` when it must exist. */
export function findChain(key: string): Chain | undefined {
  return chains.find((chain) => chain.key === key);
}

/** The chain with this key. Throws with the list of valid keys when it does not exist. */
export function getChain(key: string): Chain {
  const chain = findChain(key);
  if (chain === undefined) {
    throw new ChainRegistryError(
      `unknown chain "${key}". Known keys: ${chains.map((c) => c.key).join(", ")}`,
    );
  }
  return chain;
}

/**
 * The quick token at this exact address on this chain, or
 * `undefined`. Only then are the ticker, name and logo ours; any other address, or the same
 * address on another chain, keeps what its chain says. An evm address matches in any case.
 */
export function findQuickToken(chainKey: string, address: string): QuickToken | undefined {
  const chain = findChain(chainKey);
  if (chain === undefined) return undefined;
  const wanted = chain.family === "evm" ? address.toLowerCase() : address;
  return chain.quickTokens.find(
    (token) => (chain.family === "evm" ? token.address.toLowerCase() : token.address) === wanted,
  );
}

/** The chain with this leaf chain id, or `undefined`. EVM ids and the Solana constants share the space. */
export function findChainByChainId(chainId: number): Chain | undefined {
  return chains.find((chain) => chain.chainId === chainId);
}

/**
 * Chains the product treats as live, ordered for display.
 *
 * `status: "active"` only. It says nothing about whether contracts are deployed — a chain can be
 * active with a `null` factory, and both are true at once. Entries with `displayOrder: null` are
 * never front page pills, so they sort last.
 */
export function getActiveChains(): Chain[] {
  const last = Number.MAX_SAFE_INTEGER;
  return chains
    .filter((chain) => chain.status === "active")
    .sort((a, b) => (a.displayOrder ?? last) - (b.displayOrder ?? last));
}

/** True when the product wants this chain **and** a factory is deployed on it. */
export function isDeployed(chain: Chain): chain is DeployedChain {
  return (
    chain.status === "active" &&
    chain.chainId !== null &&
    chain.contracts.factory !== null &&
    chain.contracts.implementation !== null &&
    chain.contracts.deployBlock !== null
  );
}

/** Active chains that also have contracts. This is what the indexer and the create flow iterate. */
export function getDeployedChains(): DeployedChain[] {
  return getActiveChains().filter(isDeployed);
}

/**
 * True when the whole handle mode set is recorded on this evm chain: `DropFactoryV2`, `DropV2`,
 * the `BinderRegistry` and the V2 start block. New drops go to `factoryV2` once this is true;
 * old drops stay on the V1 factory and are still indexed from it.
 */
export function hasHandleContracts(chain: Chain): chain is HandleContractsChain {
  return (
    chain.family === "evm" &&
    chain.contracts.factoryV2 !== null &&
    chain.contracts.implementationV2 !== null &&
    chain.contracts.binderRegistry !== null &&
    chain.contracts.deployBlockV2 !== null
  );
}

/**
 * True when the V3 set is recorded on top of V2 on this evm chain: `DropFactoryV3` creates every
 * new drop, and Robinhood token drops are on. False everywhere until V3 is deployed, so they
 * stay off until then. .
 */
export function hasTokenDropContracts(chain: Chain): chain is TokenDropContractsChain {
  return (
    hasHandleContracts(chain) &&
    chain.contracts.factoryV3 !== null &&
    chain.contracts.implementationV3 !== null &&
    chain.contracts.deployBlockV3 !== null
  );
}

/**
 * True when the V4 set is recorded on top of V3 on this evm chain: `DropFactoryV4` carries the
 * fee. False everywhere until the design records V4, so the indexer stays on V1 to V3 until
 * then. .
 */
export function hasFeeModelContracts(chain: Chain): chain is FeeModelContractsChain {
  return (
    hasTokenDropContracts(chain) &&
    chain.contracts.factoryV4 !== null &&
    chain.contracts.implementationV4 !== null &&
    chain.contracts.deployBlockV4 !== null
  );
}

/**
 * True when the product wants this svm chain **and** the program is deployed there. The Solana
 * twin of `isDeployed`; the two never overlap because a chain has one family.
 */
export function isProgramDeployed(chain: Chain): chain is DeployedProgramChain {
  return (
    chain.family === "svm" &&
    chain.status === "active" &&
    chain.chainId !== null &&
    chain.contracts.program !== null &&
    chain.contracts.deploySlot !== null
  );
}

/** Active svm chains with a deployed program. Empty until the Solana backend session flips them. */
export function getDeployedProgramChains(): DeployedProgramChain[] {
  return getActiveChains().filter(isProgramDeployed);
}

/**
 * True while nothing runs on a mainnet: no chain of `kind: "mainnet"` has a deployed factory or
 * program. The one flag behind every `testnet` mark on the site, decided
 * it flips by itself the day a mainnet address goes into the registry. An active
 * mainnet with no contracts, robinhood today, does not count: no money can move there.
 */
export function isTestnetOnly(list: readonly Chain[] = chains): boolean {
  return !list.some(
    (chain) => chain.kind === "mainnet" && (isDeployed(chain) || isProgramDeployed(chain)),
  );
}

/** The chain with this key, proven deployed. Throws when it is not. */
export function getDeployedChain(key: string): DeployedChain {
  const chain = getChain(key);
  if (!isDeployed(chain)) {
    throw new ChainRegistryError(`chain "${key}" has no deployed factory yet, or is not active.`);
  }
  return chain;
}

/**
 * Read the RPC URL for a chain out of the environment.
 *
 * The registry holds the env var **name**. This is the only function that turns it into a value,
 * so there is exactly one error message when `.env` is not filled in.
 */
export function rpcUrlFor(
  chain: Chain,
  env: Record<string, string | undefined> = process.env,
): string {
  if (chain.rpcEnv === null) {
    throw new ChainRegistryError(`chain "${chain.key}" has no rpcEnv in the registry`);
  }
  const url = env[chain.rpcEnv];
  if (url === undefined || url.length === 0) {
    throw new ChainRegistryError(
      `missing RPC url for chain "${chain.key}": set ${chain.rpcEnv} in your .env`,
    );
  }
  return url;
}

/**
 * The primary RPC url, then the fallback when the registry names one and it is set.
 *
 * The primary is required, `rpcUrlFor`. The fallback is optional: unset or empty means none, and
 * a fallback equal to the primary is dropped. Only the api uses the list; the indexer stays on
 * the primary alone, because it spreads its calls over every url it gets.
 */
export function rpcUrlsFor(
  chain: Chain,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const primary = rpcUrlFor(chain, env);
  const fallback = chain.fallbackRpcEnv === null ? undefined : env[chain.fallbackRpcEnv];
  return fallback === undefined || fallback.length === 0 || fallback === primary
    ? [primary]
    : [primary, fallback];
}

function withQuery(chain: Chain, url: string): string {
  return chain.explorerQuery === null ? url : `${url}?${chain.explorerQuery}`;
}

/**
 * Link to an address on the chain's explorer, or `null` when the chain has no explorer yet.
 * explorer.solana.com uses the same `/address/` and `/tx/` shapes, plus `?cluster=` off mainnet.
 */
export function explorerAddressUrl(chain: Chain, address: string): string | null {
  return chain.explorer === null ? null : withQuery(chain, `${chain.explorer}/address/${address}`);
}

/** Link to a transaction on the chain's explorer, or `null` when the chain has no explorer yet. */
export function explorerTxUrl(chain: Chain, txHash: string): string | null {
  return chain.explorer === null ? null : withQuery(chain, `${chain.explorer}/tx/${txHash}`);
}

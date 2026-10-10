/**
 * Types for the chain registry. The shapes here describe `chains.json` exactly.
 * Field meanings are documented in `packages/chains/README.md`, which is the prose version of
 * this file. If the two disagree, the README wins and this file is wrong.
 */

/** Which code path can talk to the chain. */
export type ChainFamily = "evm" | "svm" | "tvm";

/** Mainnet or testnet. A testnet entry also carries `testnetOf`. */
export type ChainKind = "mainnet" | "testnet";

/**
 * The product answer, not the on chain answer.
 * `active` means the chain is part of dropchad. It does **not** mean anything is deployed there.
 */
export type ChainStatus = "active" | "coming_soon";

/** Decides the verify flags and the link shapes. `solana` is explorer.solana.com. */
export type ExplorerKind = "blockscout" | "etherscan" | "solana";

/** Deployed dropchad contracts on a chain. `null` means not deployed. */
export interface ChainContracts {
  /** `DropFactoryV1`. EVM only. */
  readonly factory: string | null;
  /** The `DropV1` implementation the factory clones. EVM only. */
  readonly implementation: string | null;
  /**
   * The **L2** block the factory was deployed in, and the indexer start block. EVM only.
   *
   * On Arbitrum Nitro, Solidity `block.number` is the L1 block, so this number is never taken
   * from a deploy script's `block.number`. It is read from the deploy transaction receipt.
   */
  readonly deployBlock: number | null;
  /** The dropchad program id. Solana only. */
  readonly program: string | null;
  /** The slot the program was deployed in, from the deploy transaction. Solana only. */
  readonly deploySlot: number | null;
  // Handle mode. EVM only. All four set, or all four null.
  // The V1 fields above keep their meaning: old drops are still read from the V1 factory.
  /** `DropFactoryV2`, the factory new drops are created on once handle mode ships. */
  readonly factoryV2: string | null;
  /** The `DropV2` implementation `DropFactoryV2` clones. */
  readonly implementationV2: string | null;
  /** The `BinderRegistry` every `DropV2` reads the binder from. */
  readonly binderRegistry: string | null;
  /** The **L2** block `DropFactoryV2` was deployed in, the indexer start block for V2. */
  readonly deployBlockV2: number | null;
  // Robinhood token drops . EVM only, all three or none, and only
  // on top of the V2 set: `DropV3` reads the live `BinderRegistry`. Null until V3 is deployed, so
  // Robinhood token drops stay off until then.
  /** `DropFactoryV3`, the factory every new drop is created on once it is recorded. */
  readonly factoryV3: string | null;
  /** The `DropV3` implementation `DropFactoryV3` clones. */
  readonly implementationV3: string | null;
  /** The **L2** block `DropFactoryV3` was deployed in, the indexer start block for V3. */
  readonly deployBlockV3: number | null;
  // The new fee on Robinhood . EVM only, all three or
  // none, only on top of the V3 set, and `implementationV4` is `implementationV3`: V4 clones the
  // same `DropV3`. Null until the design records V4, so the indexer and the api stay on V3.
  /** `DropFactoryV4`, V3 plus the fee. */
  readonly factoryV4: string | null;
  /** The `DropV3` implementation `DropFactoryV4` clones, the same as `implementationV3`. */
  readonly implementationV4: string | null;
  /** The **L2** block `DropFactoryV4` was deployed in, the indexer start block for V4. */
  readonly deployBlockV4: number | null;
}

/** An allowlisted launchpad token factory, plus the adapter that can read it. */
export interface LaunchpadFactory {
  readonly key: string;
  readonly address: string;
  readonly adapter: string | null;
  readonly startBlock: number | null;
}

/**
 * A quick token on the create page's `stable` tab. A tap fills the token
 * box with `address`, the same as a paste; the same check runs, so this is never an allowlist.
 * For this exact chain and address the ticker, name and logo are ours everywhere.
 */
export interface QuickToken {
  /** The ticker on the chip, 1 to 10 characters. */
  readonly symbol: string;
  /** The exact token address: `0x` and 40 hex on an evm chain, a base58 mint on an svm chain. */
  readonly address: string;
  /** Our name for it, 1 to 32 characters: `USD Coin`, `Tether USD`. */
  readonly name: string;
  /** Our own logo in the web app, `/tokens/<name>.png`, or `null` for none. */
  readonly logo: string | null;
}

export interface Chain {
  /** Stable id, never renamed. */
  readonly key: string;
  readonly name: string;
  readonly kind: ChainKind;
  /** On a testnet entry, the `key` of its mainnet. */
  readonly testnetOf?: string;
  readonly family: ChainFamily;
  /**
   * The chain id that goes into the merkle leaf
   * The EVM chain id on an evm chain; the cluster constant of the design on an svm chain, 101
   * mainnet and 103 devnet. `null` on a chain that has neither.
   */
  readonly chainId: number | null;
  readonly status: ChainStatus;
  /** Front page pill position. `null` means never shown as a pill. */
  readonly displayOrder: number | null;
  readonly nativeSymbol: string;
  /** Base URL, no trailing slash. */
  readonly explorer: string | null;
  readonly explorerKind: ExplorerKind | null;
  /** A query string appended to every explorer link, without the `?`. `cluster=devnet` on Solana devnet. */
  readonly explorerQuery: string | null;
  /** The **name** of the env var that holds the RPC URL, never the URL itself. */
  readonly rpcEnv: string | null;
  readonly archiveRpcEnv: string | null;
  readonly fallbackRpcEnv: string | null;
  /** Blocks before the indexer calls a row `final`. `null` until the design is answered. */
  readonly finalityDepth: number | null;
  readonly contracts: ChainContracts;
  readonly launchpadFactories: readonly LaunchpadFactory[];
  /** Quick token chips. Empty on a chain with none. */
  readonly quickTokens: readonly QuickToken[];
}

export interface ChainRegistry {
  readonly version: number;
  readonly chains: readonly Chain[];
}

/**
 * A chain that can actually be used right now: the product wants it **and** a factory is deployed.
 * This is the type the indexer and the create-drop flow work with, so neither has to null check.
 */
export type DeployedChain = Chain & {
  readonly chainId: number;
  readonly contracts: {
    readonly factory: string;
    readonly implementation: string;
    readonly deployBlock: number;
  };
};

/** An evm chain with the whole handle mode set recorded. `hasHandleContracts` proves it. */
export type HandleContractsChain = Chain & {
  readonly family: "evm";
  readonly contracts: {
    readonly factoryV2: string;
    readonly implementationV2: string;
    readonly binderRegistry: string;
    readonly deployBlockV2: number;
  };
};

/** An evm chain with the V3 set recorded on top of V2: Robinhood token drops are on. */
export type TokenDropContractsChain = HandleContractsChain & {
  readonly contracts: {
    readonly factoryV3: string;
    readonly implementationV3: string;
    readonly deployBlockV3: number;
  };
};

/** An evm chain with the V4 set recorded on top of V3: the fee on Robinhood. */
export type FeeModelContractsChain = TokenDropContractsChain & {
  readonly contracts: {
    readonly factoryV4: string;
    readonly implementationV4: string;
    readonly deployBlockV4: number;
  };
};

/** An svm chain the product wants **and** whose program is deployed. */
export type DeployedProgramChain = Chain & {
  readonly family: "svm";
  readonly chainId: number;
  readonly contracts: {
    readonly program: string;
    readonly deploySlot: number;
  };
};

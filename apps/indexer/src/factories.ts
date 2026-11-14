/**
 * Which factories the indexer follows, and the one implementation each may clone. Handle mode
 *
 * Everything comes from `@dropchad/chains`. `DropFactoryV1` with `DropV1` always; `DropFactoryV2`
 * with `DropV2` only once all four V2 fields are in the registry, `hasHandleContracts`, which is
 * Until then the V2 fields are `null` and the indexer runs exactly as before.
 * `DropFactoryV3` with `DropV3` only once all three V3 fields are recorded on top of V2,
 * `hasTokenDropContracts`. `DropFactoryV4` with the same
 * `DropV3` only once all three V4 fields are recorded on top of V3, `hasFeeModelContracts`
 * `DropFactoryV5` with the new `DropV5` only once all three V5 fields are recorded
 * on top of V4, `hasRefundSafeContracts`. `DropFactoryV6` with the new
 * `DropV6` once the V6 set is recorded, `hasV6Contracts`, round: on top of V5 on the
 * testnet, or alone on a V6 only chain (the mainnet shape), where it is the only factory. V1 is
 * in only when its set is recorded, `isDeployed`. `DropFactoryV7` with the new `DropV7` once the V7
 * set is recorded, `hasV7Contracts`: on top of V6 on the testnet, or alone (the mainnet
 * shape), where it is the only factory.
 *
 * The approval is **per factory**: a `DropFactoryV1` drop must be a clone of `DropV1`, a
 * `DropFactoryV2` drop a clone of `DropV2`, a `DropFactoryV3` or `DropFactoryV4` drop a clone of
 * `DropV3`, a `DropFactoryV5` drop a clone of `DropV5`, a `DropFactoryV6` drop a clone of `DropV6`,
 * a `DropFactoryV7` drop a clone of `DropV7`.
 * The emitting factory picks the pair, never the event.
 */
import {
  hasFeeModelContracts,
  hasHandleContracts,
  hasRefundSafeContracts,
  hasTokenDropContracts,
  hasV6Contracts,
  hasV7Contracts,
  isDeployed,
  type Chain,
  type DeployedChain,
  type V6ContractsChain,
  type V7ContractsChain,
} from "@dropchad/chains";
import { getAddress, type Address } from "viem";

/**
 * A chain the indexer can follow: the V1 set recorded, or the V6 or the V7 set
 * (on top or alone).
 */
export type IndexedChain = DeployedChain | V6ContractsChain | V7ContractsChain;

/** True when the indexer can follow this chain. Anything else stops it at start. */
export function isIndexable(chain: Chain): chain is IndexedChain {
  return isDeployed(chain) || hasV6Contracts(chain) || hasV7Contracts(chain);
}

export interface FactoryEntry {
  readonly name:
    | "DropFactoryV1"
    | "DropFactoryV2"
    | "DropFactoryV3"
    | "DropFactoryV4"
    | "DropFactoryV5"
    | "DropFactoryV6"
    | "DropFactoryV7";
  readonly factory: Address;
  readonly implementation: Address;
  /** The **L2** deploy block of this factory. */
  readonly startBlock: number;
}

export function factoriesFor(chain: IndexedChain): FactoryEntry[] {
  const out: FactoryEntry[] = [];
  if (isDeployed(chain)) {
    out.push({
      name: "DropFactoryV1",
      factory: getAddress(chain.contracts.factory),
      implementation: getAddress(chain.contracts.implementation),
      startBlock: chain.contracts.deployBlock,
    });
  }
  if (hasHandleContracts(chain)) {
    out.push({
      name: "DropFactoryV2",
      factory: getAddress(chain.contracts.factoryV2),
      implementation: getAddress(chain.contracts.implementationV2),
      startBlock: chain.contracts.deployBlockV2,
    });
  }
  if (hasTokenDropContracts(chain)) {
    out.push({
      name: "DropFactoryV3",
      factory: getAddress(chain.contracts.factoryV3),
      implementation: getAddress(chain.contracts.implementationV3),
      startBlock: chain.contracts.deployBlockV3,
    });
  }
  if (hasFeeModelContracts(chain)) {
    out.push({
      name: "DropFactoryV4",
      factory: getAddress(chain.contracts.factoryV4),
      implementation: getAddress(chain.contracts.implementationV4),
      startBlock: chain.contracts.deployBlockV4,
    });
  }
  if (hasRefundSafeContracts(chain)) {
    out.push({
      name: "DropFactoryV5",
      factory: getAddress(chain.contracts.factoryV5),
      implementation: getAddress(chain.contracts.implementationV5),
      startBlock: chain.contracts.deployBlockV5,
    });
  }
  if (hasV6Contracts(chain)) {
    out.push({
      name: "DropFactoryV6",
      factory: getAddress(chain.contracts.factoryV6),
      implementation: getAddress(chain.contracts.implementationV6),
      startBlock: chain.contracts.deployBlockV6,
    });
  }
  if (hasV7Contracts(chain)) {
    out.push({
      name: "DropFactoryV7",
      factory: getAddress(chain.contracts.factoryV7),
      implementation: getAddress(chain.contracts.implementationV7),
      startBlock: chain.contracts.deployBlockV7,
    });
  }
  return out;
}

/** The implementation the registry approves for this factory, or `null` for a factory it does not name. */
export function approvedImplementationFor(
  factories: readonly FactoryEntry[],
  factory: Address,
): Address | null {
  const wanted = getAddress(factory);
  return factories.find((entry) => entry.factory === wanted)?.implementation ?? null;
}

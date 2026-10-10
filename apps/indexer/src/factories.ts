/**
 * Which factories the indexer follows, and the one implementation each may clone. Handle mode
 *
 * Everything comes from `@dropchad/chains`. `DropFactoryV1` with `DropV1` always; `DropFactoryV2`
 * with `DropV2` only once all four V2 fields are in the registry, `hasHandleContracts`, which is
 * Until then the V2 fields are `null` and the indexer runs exactly as before.
 * `DropFactoryV3` with `DropV3` only once all three V3 fields are recorded on top of V2,
 * `hasTokenDropContracts`. `DropFactoryV4` with the same
 * `DropV3` only once all three V4 fields are recorded on top of V3, `hasFeeModelContracts`
 *
 * The approval is **per factory**: a `DropFactoryV1` drop must be a clone of `DropV1`, a
 * `DropFactoryV2` drop a clone of `DropV2`, a `DropFactoryV3` or `DropFactoryV4` drop a clone of
 * `DropV3`. The emitting factory picks the pair, never the event.
 */
import {
  hasFeeModelContracts,
  hasHandleContracts,
  hasTokenDropContracts,
  type DeployedChain,
} from "@dropchad/chains";
import { getAddress, type Address } from "viem";

export interface FactoryEntry {
  readonly name: "DropFactoryV1" | "DropFactoryV2" | "DropFactoryV3" | "DropFactoryV4";
  readonly factory: Address;
  readonly implementation: Address;
  /** The **L2** deploy block of this factory. */
  readonly startBlock: number;
}

export function factoriesFor(chain: DeployedChain): FactoryEntry[] {
  const out: FactoryEntry[] = [
    {
      name: "DropFactoryV1",
      factory: getAddress(chain.contracts.factory),
      implementation: getAddress(chain.contracts.implementation),
      startBlock: chain.contracts.deployBlock,
    },
  ];
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

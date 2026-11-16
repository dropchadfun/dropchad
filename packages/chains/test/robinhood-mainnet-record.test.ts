/**
 * The Robinhood Chain V7 record. The registry values are checked against
 * the deploy record `contracts/evm/deployments/4663-v7.json`, never against typed copies.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getChain, hasV6Contracts, hasV7Contracts, isDeployed } from "../src/index.js";

interface DeployRecord {
  readonly chainId: number;
  readonly factory: string;
  readonly implementation: string;
  readonly registry: string;
  readonly block: number;
}

const record = JSON.parse(
  readFileSync(new URL("../../../contracts/evm/deployments/4663-v7.json", import.meta.url), "utf8"),
) as DeployRecord;

/** Every contract field below V7. The mainnet entry carries V7 alone. */
const OLDER_FIELDS = [
  "factory",
  "implementation",
  "deployBlock",
  "factoryV2",
  "implementationV2",
  "binderRegistry",
  "deployBlockV2",
  "factoryV3",
  "implementationV3",
  "deployBlockV3",
  "factoryV4",
  "implementationV4",
  "deployBlockV4",
  "factoryV5",
  "implementationV5",
  "deployBlockV5",
  "factoryV6",
  "implementationV6",
  "deployBlockV6",
] as const;

describe("robinhood mainnet, the V7 record", () => {
  const chain = getChain("robinhood");

  it("is the chain of the record", () => {
    expect(record.chainId).toBe(4663);
    expect(chain.chainId).toBe(record.chainId);
    expect(chain.kind).toBe("mainnet");
    expect(chain.status).toBe("active");
  });

  it("carries the four V7 values of the record, letter for letter", () => {
    expect(chain.contracts.factoryV7).toBe(record.factory);
    expect(chain.contracts.implementationV7).toBe(record.implementation);
    expect(chain.contracts.binderRegistryV2).toBe(record.registry);
    expect(chain.contracts.deployBlockV7).toBe(record.block);
  });

  it("starts at the L2 block of the factory deploy", () => {
    expect(record.block).toBe(114_358_527);
  });

  it("carries V7 alone: every older field is null", () => {
    for (const field of OLDER_FIELDS) expect(chain.contracts[field], field).toBeNull();
    expect(chain.contracts.program).toBeNull();
    expect(chain.contracts.deploySlot).toBeNull();
  });

  it("counts as V7 deployed, and not as V1 or V6", () => {
    expect(hasV7Contracts(chain)).toBe(true);
    expect(hasV6Contracts(chain)).toBe(false);
    expect(isDeployed(chain)).toBe(false);
  });
});

/**
 * The two packages have no build step: `main` and `exports` point straight at the TypeScript
 * source. This test proves a sibling workspace can be imported **by package name**, which is how
 * `apps/api` and `apps/indexer` will import them. Without it the first cross package import would
 * only fail once the api exists.
 */
import { describe, expect, it } from "vitest";

import { getDeployedChain } from "@dropchad/chains";
import { buildDropTree, dropFactoryV1Abi, dropV1Abi } from "@dropchad/shared";

describe("workspace resolution", () => {
  it("imports @dropchad/chains by name and reads the live testnet entry", () => {
    const chain = getDeployedChain("robinhood-testnet");
    expect(chain.chainId).toBe(46630);
    expect(chain.contracts.deployBlock).toBe(115976053);
  });

  it("imports @dropchad/shared by name and builds a tree for that chain", () => {
    const chain = getDeployedChain("robinhood-testnet");
    const tree = buildDropTree({
      drop: "0x01532cdb9fA0AEde791c3295e7c49ADe9b29f315",
      chainId: chain.chainId,
      receivers: [{ recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", amount: 1n }],
    });
    expect(tree.leafCount).toBe(1);
  });

  it("ships the generated ABIs with the events the indexer needs", () => {
    const dropEvents = dropV1Abi.filter((entry) => entry.type === "event").map((e) => e.name);
    expect(dropEvents).toEqual(
      expect.arrayContaining([
        "Activated",
        "Claimed",
        "Refunded",
        "CancelledUnfunded",
        "Finalized",
        "Swept",
      ]),
    );

    const factoryEvents = dropFactoryV1Abi
      .filter((entry) => entry.type === "event")
      .map((e) => e.name);
    expect(factoryEvents).toEqual(
      expect.arrayContaining([
        "DropCreated",
        "PausedSet",
        "DefaultFeeBpsSet",
        "FeeRecipientSet",
        "TokenFactoryAllowed",
        "CreatorAllowed",
        "ImplementationSet",
      ]),
    );
  });
});

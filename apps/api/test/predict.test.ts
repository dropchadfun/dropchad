/**
 * Address prediction, pinned to the worked example.
 *
 * Those values were reproduced with `cast keccak` when the design was written, and
 * `contracts/evm/test/MerkleVector.t.sol` pins the Solidity side to the same numbers. This file
 * pins the TypeScript side. If any of the three ever drifts, one of these three suites goes red.
 *
 * This matters more than a normal unit test: the predicted address is what a sender is asked to
 * send money to, before the contract exists.
 */
import { encodeAbiParameters, keccak256 } from "viem";
import { describe, expect, it } from "vitest";

import {
  cloneInitCodeHash,
  computeSalt,
  creatorCommitment,
  newCommitmentBlind,
  predictDropAddress,
  unblindedCommitment,
} from "../src/chain/predict.js";

// inputs, all example values.
const CHAIN_ID = 4663;
const FACTORY = "0x00000000000000000000000000000000000fac70" as const;
const IMPLEMENTATION = "0x000000000000000000000000000000000000c10e" as const;
const RELAYER = "0x000000000000000000000000000000000000be11" as const;
const X_USER_ID = 1234567890n;
const NONCE = 0n;

const EXPECTED_COMMITMENT = "0x9c9c4b2787ccf315857d894a848d0d5dd248723d87fe8b14759584b4e56f67d6";
const EXPECTED_SALT = "0x719fb97b012605f1f6361ee78dc7fed012c573d9264b76424931af8d2a176bb7";
const EXPECTED_INIT_CODE_HASH =
  "0xdb105e72fda747c16ff7591b3892d5109ccdcdf0cd7984dc02ae0df7d81d19c1";
const EXPECTED_DROP = "0xed1522decb0421e76f3d8de2384d4ee401d8cb4a";

describe("worked example", () => {
  it("step 1: the unblinded commitment of drops before 21b, still the example for steps 2 to 9", () => {
    expect(unblindedCommitment(X_USER_ID, NONCE)).toBe(EXPECTED_COMMITMENT);
  });

  it("step 1: the salt binds chain, factory, relayer, commitment and nonce", () => {
    expect(
      computeSalt({
        chainId: CHAIN_ID,
        factory: FACTORY,
        creator: RELAYER,
        creatorCommitment: EXPECTED_COMMITMENT,
        nonce: NONCE,
      }),
    ).toBe(EXPECTED_SALT);
  });

  it("step 2: the EIP 1167 init code hash", () => {
    expect(cloneInitCodeHash(IMPLEMENTATION)).toBe(EXPECTED_INIT_CODE_HASH);
  });

  it("step 2: the CREATE2 clone address", () => {
    expect(
      predictDropAddress({
        factory: FACTORY,
        implementation: IMPLEMENTATION,
        salt: EXPECTED_SALT,
      }).toLowerCase(),
    ).toBe(EXPECTED_DROP);
  });
});

describe("what the salt binds", () => {
  const base = {
    chainId: CHAIN_ID,
    factory: FACTORY,
    creator: RELAYER,
    creatorCommitment: EXPECTED_COMMITMENT,
    nonce: NONCE,
  } as const;

  it("a different caller gives a different address, which is what kills front running", () => {
    // `msg.sender` is in the salt, so nobody else can occupy the
    // address we predicted for ourselves.
    const other = computeSalt({ ...base, creator: "0x000000000000000000000000000000000000dead" });
    expect(other).not.toBe(EXPECTED_SALT);
  });

  it("a different chain gives a different address", () => {
    expect(computeSalt({ ...base, chainId: 4664 })).not.toBe(EXPECTED_SALT);
  });

  it("a different nonce gives a different address", () => {
    expect(computeSalt({ ...base, nonce: 1n })).not.toBe(EXPECTED_SALT);
  });

  it("the same inputs always give the same address", () => {
    expect(computeSalt(base)).toBe(computeSalt(base));
  });
});

describe("the unblinded commitment, drops before 21b", () => {
  it("changes with the nonce, so one X id can have many drops", () => {
    expect(unblindedCommitment(X_USER_ID, 0n)).not.toBe(unblindedCommitment(X_USER_ID, 1n));
  });

  it("changes with the X id", () => {
    expect(unblindedCommitment(1n, 0n)).not.toBe(unblindedCommitment(2n, 0n));
  });
});

/**
 * the commitment carries a secret 32 byte blind,
 * so a guessed X id and the public nonce are no longer enough to check it.
 */
describe("the blinded commitment", () => {
  const BLIND = `0x${"b1".repeat(32)}` as const;
  const EXPECTED_BLINDED = "0x01ebbc2baef466ec973d9b5b6ceba677766de7137a052694356c59e7acfb4bf0";

  it("pins the blinded vector", () => {
    expect(creatorCommitment(X_USER_ID, NONCE, BLIND)).toBe(EXPECTED_BLINDED);
  });

  it("is keccak256(abi.encode(uint256 xUserId, uint256 nonce, bytes32 blind))", () => {
    const blind = `0x${"42".repeat(32)}` as const;
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
        [987654321n, 7n, blind],
      ),
    );
    expect(creatorCommitment(987654321n, 7n, blind)).toBe(expected);
  });

  it("a different blind gives a different commitment, and never the unblinded one", () => {
    const one = creatorCommitment(X_USER_ID, NONCE, BLIND);
    const two = creatorCommitment(X_USER_ID, NONCE, `0x${"b2".repeat(32)}`);
    expect(one).not.toBe(two);
    expect(one).not.toBe(EXPECTED_COMMITMENT);
    expect(two).not.toBe(EXPECTED_COMMITMENT);
  });

  it("refuses a blind that is not exactly 32 bytes of hex", () => {
    for (const bad of [
      "0x",
      "0x1234",
      `0x${"b1".repeat(31)}`,
      `0x${"b1".repeat(33)}`,
      `0x${"zz".repeat(32)}`,
      "b1".repeat(32),
    ]) {
      expect(() => creatorCommitment(X_USER_ID, NONCE, bad as `0x${string}`), bad).toThrow();
    }
  });
});

describe("newCommitmentBlind", () => {
  it("is 32 bytes of hex, fresh every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      const blind = newCommitmentBlind();
      expect(blind).toMatch(/^0x[0-9a-f]{64}$/);
      seen.add(blind);
    }
    expect(seen.size).toBe(64);
  });
});

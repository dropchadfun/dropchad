/**
 * Predicting the drop address off chain, before it exists.
 *
 * The whole product depends on this: the sender is shown an address and asked to send money to
 * it, and the design says **deploy before funding**, so the address must be right before
 * anything is deployed. We compute it here and the factory computes it too, and the create flow
 * refuses to go on unless the two agree — and then checks the `DropCreated` event on top.
 *
 * Three pieces, all from
 *
 * 1. `creatorCommitment = keccak256(abi.encode(uint256 xUserId, uint256 nonce, bytes32 blind))`,
 *    `blind` 32 random bytes per drop. Drops before 21b have no blind.
 * 2. `salt = keccak256(abi.encode(uint256 chainId, address factory, address creator,
 *    bytes32 creatorCommitment, uint256 nonce))`. `creator` is `msg.sender` at creation,
 *    which is the relayer, and that is what makes the address ours: nobody else can occupy it.
 * 3. the EIP 1167 clone address from CREATE2.
 *
 * The commitment binds a drop to one identity. It also hides it: the
 * nonce is public on both chains, so without the secret blind a guessed X id would be one hash
 * away. The chain never computes the commitment, so nothing on chain changed.
 */
import { randomBytes } from "node:crypto";

import {
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  keccak256,
  type Address,
  type Hex,
} from "viem";

/** EIP 1167 minimal proxy init code, with the implementation address spliced into the middle. */
export function cloneInitCode(implementation: Address): Hex {
  const impl = getAddress(implementation).slice(2).toLowerCase();
  return `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`;
}

/** `keccak256` of the init code above. This is what CREATE2 hashes. */
export function cloneInitCodeHash(implementation: Address): Hex {
  return keccak256(cloneInitCode(implementation));
}

/** The blind: `0x` and 64 lowercase hex, the only shape the column takes, migration 0015. */
const BLIND = /^0x[0-9a-f]{64}$/;

/**
 * `keccak256(abi.encode(uint256 xUserId, uint256 nonce, bytes32 blind))` since
 * 21b. Every new drop is made with this. The blind is never served, never logged.
 */
export function creatorCommitment(xUserId: bigint, nonce: bigint, blind: Hex): Hex {
  if (!BLIND.test(blind)) throw new Error("a commitment blind is 32 bytes of lowercase hex");
  return keccak256(
    encodeAbiParameters(
      [
        { name: "xUserId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "blind", type: "bytes32" },
      ],
      [xUserId, nonce, blind],
    ),
  );
}

/** 32 random bytes from the system's secure source, one per drop. */
export function newCommitmentBlind(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

/**
 * `keccak256(abi.encode(uint256 xUserId, uint256 nonce))`, the commitment of drops made before
 * Still the reference example for steps 2 to 9, pinned in `MerkleVector.t.sol` and the
 * Solana `fixture.rs`. **Never used to make a new drop.**
 */
export function unblindedCommitment(xUserId: bigint, nonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "xUserId", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
      [xUserId, nonce],
    ),
  );
}

export interface SaltInput {
  readonly chainId: number;
  readonly factory: Address;
  /** `msg.sender` at creation. The relayer. */
  readonly creator: Address;
  readonly creatorCommitment: Hex;
  readonly nonce: bigint;
}

/** effects step 1. */
export function computeSalt(input: SaltInput): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "chainId", type: "uint256" },
        { name: "factory", type: "address" },
        { name: "creator", type: "address" },
        { name: "creatorCommitment", type: "bytes32" },
        { name: "nonce", type: "uint256" },
      ],
      [
        BigInt(input.chainId),
        getAddress(input.factory),
        getAddress(input.creator),
        input.creatorCommitment,
        input.nonce,
      ],
    ),
  );
}

/** The clone address CREATE2 will produce. */
export function predictDropAddress(input: {
  readonly factory: Address;
  readonly implementation: Address;
  readonly salt: Hex;
}): Address {
  return getCreate2Address({
    from: getAddress(input.factory),
    salt: input.salt,
    bytecodeHash: cloneInitCodeHash(input.implementation),
  });
}

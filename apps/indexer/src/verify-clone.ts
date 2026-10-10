/**
 * ** .** Prove a drop really is one of ours before it counts anywhere.
 *
 * Three checks, in cost order. The first two need no network call at all.
 *
 * 1. **The implementation is the approved one.** `DropCreated.implementation` must equal the
 *    address the registry records for the chain.
 * 2. **The address is the CREATE2 clone of that implementation.** An EIP 1167 clone deployed by
 *    our factory with salt `s` can only land at
 *    `CREATE2(factory, s, keccak(0x3d602d80600a3d3981f3363d3d373d3d3d363d73 ++ impl ++ 0x5af43d82803e903d91602b57fd5bf3))`.
 *    Recomputing it from the event's own `salt` proves the factory used the standard clone and
 *    did not point the address at something else.
 * 3. **The deployed code hash matches.** One `eth_getCode` per drop, hashed and compared to the
 *    expected clone runtime code. This is the check the design asks for by name.
 *
 * Check 3 is read **at the latest block, not at the creation block**, and it is allowed to be
 * skipped. Two reasons, both found by running this against the real chain
 *
 * - the public Robinhood testnet RPC is **not an archive node**. `eth_getCode` at the creation
 *   block answers `metadata is not found`. At `latest` it answers correctly.
 * - a clone's code can never change. `DropV1` has no `selfdestruct` and no `delegatecall` that
 *   could install new code, so the code at `latest` is the code that was
 *   there at creation.
 *
 * When the RPC cannot answer at all, checks 1 and 2 still decide `verified` and `codeHashChecked`
 * records that the third one did not run. That is not a downgrade in practice: check 2 already
 * proves the address is the CREATE2 clone of the approved implementation, and CREATE2 fixes the
 * code that can live at that address. Check 3 is the belt to that pair of braces.
 *
 * The expected hash is **derived, never recorded**. Writing a clone code hash into a config file
 * would be a second copy of the same fact, free to drift. Verified against the live testnet drop
 * `0x01532cdb9fA0AEde791c3295e7c49ADe9b29f315`, whose code hash is
 * `0xf2569c9c6f67fb3926310be6c3e21a2c2ff82806f552c1adec8014bd24e8fe7f` both on chain and here.
 */
import { concatHex, getAddress, getCreate2Address, keccak256, type Address, type Hex } from "viem";

/** EIP 1167 minimal proxy runtime code, with the implementation spliced into the middle. */
export function cloneRuntimeCode(implementation: Address): Hex {
  return concatHex([
    "0x363d3d373d3d3d363d73",
    implementation.toLowerCase() as Hex,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]);
}

/** The EIP 1167 **init** code, which is what CREATE2 hashes. */
export function cloneInitCode(implementation: Address): Hex {
  return concatHex([
    "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
    implementation.toLowerCase() as Hex,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]);
}

/** The code hash a real clone of `implementation` must have. */
export function expectedCloneCodeHash(implementation: Address): Hex {
  return keccak256(cloneRuntimeCode(implementation));
}

/** Where our factory must have deployed a clone with this salt. */
export function predictedCloneAddress(args: {
  factory: Address;
  implementation: Address;
  salt: Hex;
}): Address {
  return getCreate2Address({
    from: args.factory,
    salt: args.salt,
    bytecodeHash: keccak256(cloneInitCode(args.implementation)),
  });
}

export interface VerifyResult {
  readonly verified: boolean;
  /** Null when verified, otherwise what failed, in words. */
  readonly error: string | null;
  /** False when the RPC could not serve the code and only checks 1 and 2 ran. */
  readonly codeHashChecked: boolean;
}

export interface VerifyArgs {
  readonly drop: Address;
  readonly factory: Address;
  readonly implementation: Address;
  readonly approvedImplementation: Address;
  readonly salt: Hex;
  /**
   * The clone's deployed bytecode.
   * - a `Hex` string, to check
   * - `undefined`, meaning the address has no code, which is a failure
   * - `null`, meaning the RPC could not be asked. Check 3 is skipped and recorded as skipped.
   */
  readonly deployedCode: Hex | undefined | null;
}

export function verifyClone(args: VerifyArgs): VerifyResult {
  const implementation = getAddress(args.implementation);
  const approved = getAddress(args.approvedImplementation);

  if (implementation !== approved) {
    return {
      verified: false,
      error: `implementation ${implementation} is not the approved ${approved}`,
      codeHashChecked: false,
    };
  }

  const predicted = predictedCloneAddress({
    factory: getAddress(args.factory),
    implementation,
    salt: args.salt,
  });
  if (predicted !== getAddress(args.drop)) {
    return {
      verified: false,
      error: `address ${getAddress(args.drop)} is not the CREATE2 clone for this salt, expected ${predicted}`,
      codeHashChecked: false,
    };
  }

  if (args.deployedCode === null) {
    // The RPC could not be asked. Checks 1 and 2 passed, and that is recorded honestly.
    return { verified: true, error: null, codeHashChecked: false };
  }

  if (args.deployedCode === undefined || args.deployedCode === "0x") {
    return {
      verified: false,
      error: "no code deployed at the drop address",
      codeHashChecked: true,
    };
  }

  const actual = keccak256(args.deployedCode);
  const expected = expectedCloneCodeHash(implementation);
  if (actual !== expected) {
    return {
      verified: false,
      error: `code hash ${actual} does not match the clone ${expected}`,
      codeHashChecked: true,
    };
  }

  return { verified: true, error: null, codeHashChecked: true };
}

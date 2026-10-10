/**
 * the Solana admin calls for, `scripts/solana-admin.ts`.
 * adds the two setters. The seven builders are
 * pinned to the IDL and to the real devnet `Config` address; the checks in `src/chain/svm/admin.ts` decide send, nothing to do, or
 * refuse before anything is simulated, and check the read back after a send. The relayer never
 * sends any of these.
 */
import { describe, expect, it } from "vitest";

import type { ConfigAccount } from "../src/chain/svm/accounts.js";
import {
  MAX_MIN_FEE_LAMPORTS,
  MAX_MIN_FEE_PER_RECEIVER_LAMPORTS,
  adminInstruction,
  checkAdminCall,
  checkReadBack,
  describeConfig,
  parseAdminArgs,
  type AdminAction,
} from "../src/chain/svm/admin.js";
import {
  instructionNameOf,
  migrateConfigInstruction,
  revokeBinderInstruction,
  setBinderInstruction,
  setFeePerReceiverInstruction,
  setMaxFeeInstruction,
  setMinFeeInstruction,
  setPausedInstruction,
} from "../src/chain/svm/instructions.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { ALLOWED_INSTRUCTIONS } from "../src/chain/svm/relayer.js";
import {
  DEFAULT_PUBKEY,
  SYSTEM_PROGRAM_ID,
  pubkeyEquals,
  pubkeyFromBase58,
  pubkeyToBase58,
} from "../src/chain/svm/pubkey.js";

/** The devnet `Config` PDA, the same pin as `svm-primitives.test.ts`. */
const CONFIG = "bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD";
/** The live Solana binder, public, set on chain. */
const BINDER = pubkeyFromBase58("DhiQHDcochXLnLXhwMT3JVDcDe1pVfXjMG7pkPboowGq");

const admin = randomSigner().publicKey;
const relayer = randomSigner().publicKey;
const guardian = randomSigner().publicKey;
const stranger = randomSigner().publicKey;

const base = {
  admin,
  relayer,
  feeWallet: new Uint8Array(32).fill(5),
  defaultFeeBps: 100,
  paused: false,
  chainId: 103n,
  bump: 254,
};
/** A 116 byte `Config`, before `migrate_config`. */
const old: ConfigAccount = { ...base, handle: null };
/** A 253 byte `Config` straight after `migrate_config`: every new field zero. */
const migrated: ConfigAccount = {
  ...base,
  handle: {
    binder: DEFAULT_PUBKEY,
    binderRevoked: false,
    guardian: DEFAULT_PUBKEY,
    minFeeLamports: 0n,
    minFeePerReceiverLamports: 0n,
    maxFeeLamports: 0n,
  },
};
const withHandle = (fields: Partial<NonNullable<ConfigAccount["handle"]>>): ConfigAccount => ({
  ...migrated,
  handle: { ...(migrated.handle as NonNullable<ConfigAccount["handle"]>), ...fields },
});

describe("the seven admin builders", () => {
  const configMeta = (
    keys: readonly { pubkey: Uint8Array; isWritable: boolean; isSigner: boolean }[],
  ) => keys[1] as { pubkey: Uint8Array; isWritable: boolean; isSigner: boolean };

  it("migrate_config: admin signs and pays, config writable, the system program, no args", () => {
    const ix = migrateConfigInstruction({ admin });
    expect(instructionNameOf(ix.data)).toBe("migrate_config");
    expect(ix.keys).toHaveLength(3);
    expect(ix.keys[0]?.pubkey).toBe(admin);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[0]?.isWritable).toBe(true);
    expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(pubkeyEquals(ix.keys[2]?.pubkey as Uint8Array, SYSTEM_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(8);
  });

  it("set_binder: admin signs, config writable, the 32 byte key after the discriminator", () => {
    const ix = setBinderInstruction({ admin, binder: BINDER });
    expect(instructionNameOf(ix.data)).toBe("set_binder");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(ix.data.length).toBe(8 + 32);
    expect(pubkeyToBase58(ix.data.slice(8))).toBe("DhiQHDcochXLnLXhwMT3JVDcDe1pVfXjMG7pkPboowGq");
  });

  it("set_min_fee: a u64 little endian after the discriminator", () => {
    const ix = setMinFeeInstruction({ admin, lamports: 2_500_000n });
    expect(instructionNameOf(ix.data)).toBe("set_min_fee");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(ix.data.length).toBe(8 + 8);
    expect(new DataView(ix.data.buffer, ix.data.byteOffset).getBigUint64(8, true)).toBe(2_500_000n);
  });

  it("revoke_binder: the signer, admin or guardian, and config writable, no args", () => {
    const ix = revokeBinderInstruction({ signer: guardian });
    expect(instructionNameOf(ix.data)).toBe("revoke_binder");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.pubkey).toBe(guardian);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(ix.data.length).toBe(8);
  });

  it("set_paused: one bool byte after the discriminator", () => {
    const on = setPausedInstruction({ admin, paused: true });
    const off = setPausedInstruction({ admin, paused: false });
    expect(instructionNameOf(on.data)).toBe("set_paused");
    expect(on.data.length).toBe(8 + 1);
    expect(on.data[8]).toBe(1);
    expect(off.data[8]).toBe(0);
    expect(on.keys[0]?.isSigner).toBe(true);
    expect(configMeta(on.keys).isWritable).toBe(true);
  });

  it("set_fee_per_receiver and set_max_fee: admin signs, config writable, a u64", () => {
    const cases = [
      [
        setFeePerReceiverInstruction({ admin, lamports: 300_000n }),
        "set_fee_per_receiver",
        300_000n,
      ],
      [setMaxFeeInstruction({ admin, lamports: 500_000_000n }), "set_max_fee", 500_000_000n],
    ] as const;
    for (const [ix, name, lamports] of cases) {
      expect(instructionNameOf(ix.data)).toBe(name);
      expect(ix.keys).toHaveLength(2);
      expect(ix.keys[0]?.pubkey).toBe(admin);
      expect(ix.keys[0]?.isSigner).toBe(true);
      expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
      expect(configMeta(ix.keys).isWritable).toBe(true);
      expect(ix.data.length).toBe(8 + 8);
      expect(new DataView(ix.data.buffer, ix.data.byteOffset).getBigUint64(8, true)).toBe(lamports);
    }
  });

  it("adminInstruction picks the builder for each action", () => {
    const cases: [AdminAction, string][] = [
      [{ kind: "migrate-config" }, "migrate_config"],
      [{ kind: "set-binder", binder: BINDER }, "set_binder"],
      [{ kind: "set-min-fee", lamports: 2_500_000n }, "set_min_fee"],
      [{ kind: "revoke-binder" }, "revoke_binder"],
      [{ kind: "set-paused", paused: true }, "set_paused"],
      [{ kind: "set-fee-per-receiver", lamports: 300_000n }, "set_fee_per_receiver"],
      [{ kind: "set-max-fee", lamports: 500_000_000n }, "set_max_fee"],
    ];
    for (const [action, name] of cases) {
      expect(instructionNameOf(adminInstruction(action, admin).data)).toBe(name);
    }
  });
});

describe("the relayer never sends an admin call", () => {
  it("none of the seven is on the relayer's list", () => {
    const list: readonly string[] = ALLOWED_INSTRUCTIONS;
    for (const name of [
      "migrate_config",
      "set_binder",
      "set_min_fee",
      "revoke_binder",
      "set_paused",
      "set_fee_per_receiver",
      "set_max_fee",
    ]) {
      expect(list).not.toContain(name);
    }
  });
});

describe("parseAdminArgs", () => {
  const parse = (...argv: string[]) => parseAdminArgs(argv);

  it("reads each action with its value, the keypair, the rpc and --dry-run", () => {
    expect(parse("migrate-config", "--dry-run")).toMatchObject({
      action: { kind: "migrate-config" },
      dryRun: true,
      rpc: "https://api.devnet.solana.com",
    });
    const binder = parse("set-binder", "--binder", "DhiQHDcochXLnLXhwMT3JVDcDe1pVfXjMG7pkPboowGq");
    expect("action" in binder && binder.action.kind === "set-binder").toBe(true);
    expect(parse("set-min-fee", "--lamports", "2500000")).toMatchObject({
      action: { kind: "set-min-fee", lamports: 2_500_000n },
      dryRun: false,
    });
    expect(parse("revoke-binder", "--keypair", "C:/k.json")).toMatchObject({
      action: { kind: "revoke-binder" },
      keypair: "C:/k.json",
    });
    expect(parse("set-paused", "--paused", "true")).toMatchObject({
      action: { kind: "set-paused", paused: true },
    });
    expect(parse("set-paused", "--paused", "false")).toMatchObject({
      action: { kind: "set-paused", paused: false },
    });
    expect(parse("set-fee-per-receiver", "--lamports", "300000", "--dry-run")).toMatchObject({
      action: { kind: "set-fee-per-receiver", lamports: 300_000n },
      dryRun: true,
    });
    expect(parse("set-max-fee", "--lamports", "500000000")).toMatchObject({
      action: { kind: "set-max-fee", lamports: 500_000_000n },
      dryRun: false,
    });
    // Zero is a real value for both: off, and no cap.
    expect(parse("set-fee-per-receiver", "--lamports", "0")).toMatchObject({
      action: { kind: "set-fee-per-receiver", lamports: 0n },
    });
    expect(parse("set-max-fee", "--lamports", "0")).toMatchObject({
      action: { kind: "set-max-fee", lamports: 0n },
    });
  });

  it("refuses what it does not know, with a sentence", () => {
    for (const argv of [
      [],
      ["set-admin"],
      ["set-binder"],
      ["set-binder", "--binder", "not-a-key"],
      ["set-min-fee"],
      ["set-min-fee", "--lamports", "2.5"],
      ["set-min-fee", "--lamports", "-1"],
      ["set-paused"],
      ["set-paused", "--paused", "yes"],
      ["set-paused", "--paused", "TRUE"],
      ["set-fee-per-receiver"],
      ["set-fee-per-receiver", "--lamports", "0.0003"],
      ["set-fee-per-receiver", "--lamports", "-1"],
      ["set-max-fee"],
      ["set-max-fee", "--lamports", "0.5"],
      ["set-max-fee", "--lamports", "1e9"],
    ]) {
      const parsed = parseAdminArgs(argv);
      expect("error" in parsed, argv.join(" ")).toBe(true);
    }
  });
});

describe("checkAdminCall", () => {
  const check = (action: AdminAction, config: ConfigAccount, signer = admin) =>
    checkAdminCall(action, config, signer);

  it("refuses every action when the signer is not the admin", () => {
    for (const action of [
      { kind: "migrate-config" },
      { kind: "set-binder", binder: BINDER },
      { kind: "set-min-fee", lamports: 1n },
      { kind: "set-paused", paused: true },
      { kind: "set-fee-per-receiver", lamports: 1n },
      { kind: "set-max-fee", lamports: 1n },
    ] as AdminAction[]) {
      expect(
        check(action, action.kind === "migrate-config" ? old : migrated, stranger).result,
      ).toBe("refuse");
    }
    expect(check({ kind: "revoke-binder" }, withHandle({ binder: BINDER }), stranger).result).toBe(
      "refuse",
    );
  });

  it("migrate-config: sends on 116 bytes, nothing to do on 253", () => {
    expect(check({ kind: "migrate-config" }, old).result).toBe("send");
    expect(check({ kind: "migrate-config" }, migrated).result).toBe("nothing");
  });

  it("set-binder: needs the migration, refuses zero and the relayer, nothing to do when already set", () => {
    const needsMigration = check({ kind: "set-binder", binder: BINDER }, old);
    expect(needsMigration.result).toBe("refuse");
    expect("reason" in needsMigration && needsMigration.reason).toContain("migrate-config");
    expect(check({ kind: "set-binder", binder: DEFAULT_PUBKEY }, migrated).result).toBe("refuse");
    expect(check({ kind: "set-binder", binder: relayer }, migrated).result).toBe("refuse");
    expect(check({ kind: "set-binder", binder: BINDER }, migrated).result).toBe("send");
    expect(
      check({ kind: "set-binder", binder: BINDER }, withHandle({ binder: BINDER })).result,
    ).toBe("nothing");
    // A revoked binder set again clears the revoke: that is a send.
    expect(
      check(
        { kind: "set-binder", binder: BINDER },
        withHandle({ binder: BINDER, binderRevoked: true }),
      ).result,
    ).toBe("send");
  });

  it("set-min-fee: needs the migration, the program cap, nothing to do when equal", () => {
    expect(MAX_MIN_FEE_LAMPORTS).toBe(25_000_000n);
    expect(check({ kind: "set-min-fee", lamports: 2_500_000n }, old).result).toBe("refuse");
    expect(check({ kind: "set-min-fee", lamports: 25_000_001n }, migrated).result).toBe("refuse");
    expect(check({ kind: "set-min-fee", lamports: 25_000_000n }, migrated).result).toBe("send");
    expect(check({ kind: "set-min-fee", lamports: 2_500_000n }, migrated).result).toBe("send");
    expect(
      check(
        { kind: "set-min-fee", lamports: 2_500_000n },
        withHandle({ minFeeLamports: 2_500_000n }),
      ).result,
    ).toBe("nothing");
  });

  it("set-fee-per-receiver: needs the migration, the 0.003 SOL ceiling, nothing to do when equal", () => {
    expect(MAX_MIN_FEE_PER_RECEIVER_LAMPORTS).toBe(3_000_000n);
    const action = (lamports: bigint): AdminAction => ({ kind: "set-fee-per-receiver", lamports });
    const needsMigration = check(action(300_000n), old);
    expect(needsMigration.result).toBe("refuse");
    expect("reason" in needsMigration && needsMigration.reason).toContain("migrate-config");
    expect(check(action(3_000_001n), migrated).result).toBe("refuse");
    expect(check(action(3_000_000n), migrated).result).toBe("send");
    expect(check(action(300_000n), migrated).result).toBe("send");
    expect(
      check(action(300_000n), withHandle({ minFeePerReceiverLamports: 300_000n })).result,
    ).toBe("nothing");
    // Back to zero, the brake: a send when set, nothing to do when already off.
    expect(check(action(0n), withHandle({ minFeePerReceiverLamports: 300_000n })).result).toBe(
      "send",
    );
    expect(check(action(0n), migrated).result).toBe("nothing");
  });

  it("set-max-fee: needs the migration, the 1 SOL ceiling, nothing to do when equal", () => {
    const action = (lamports: bigint): AdminAction => ({ kind: "set-max-fee", lamports });
    expect(check(action(500_000_000n), old).result).toBe("refuse");
    expect(check(action(1_000_000_001n), migrated).result).toBe("refuse");
    expect(check(action(1_000_000_000n), migrated).result).toBe("send");
    expect(check(action(500_000_000n), migrated).result).toBe("send");
    expect(check(action(500_000_000n), withHandle({ maxFeeLamports: 500_000_000n })).result).toBe(
      "nothing",
    );
    expect(check(action(0n), withHandle({ maxFeeLamports: 500_000_000n })).result).toBe("send");
    expect(check(action(0n), migrated).result).toBe("nothing");
  });

  it("set-min-fee 0 is a send: the old flat minimum goes to zero in", () => {
    expect(
      check({ kind: "set-min-fee", lamports: 0n }, withHandle({ minFeeLamports: 300_000n })).result,
    ).toBe("send");
  });

  it("revoke-binder: the admin or the guardian, needs the migration, nothing to do when revoked", () => {
    const live = withHandle({ binder: BINDER, guardian });
    expect(check({ kind: "revoke-binder" }, old).result).toBe("refuse");
    expect(check({ kind: "revoke-binder" }, live).result).toBe("send");
    expect(check({ kind: "revoke-binder" }, live, guardian).result).toBe("send");
    expect(
      check({ kind: "revoke-binder" }, withHandle({ binder: BINDER, binderRevoked: true })).result,
    ).toBe("nothing");
  });

  it("set-paused: works before and after the migration, nothing to do when equal", () => {
    expect(check({ kind: "set-paused", paused: true }, old).result).toBe("send");
    expect(check({ kind: "set-paused", paused: true }, migrated).result).toBe("send");
    expect(check({ kind: "set-paused", paused: false }, old).result).toBe("nothing");
  });
});

describe("checkReadBack", () => {
  it("a change that landed passes, one that did not fails", () => {
    expect(checkReadBack({ kind: "migrate-config" }, old, migrated)).toEqual([]);
    expect(checkReadBack({ kind: "migrate-config" }, old, old)).not.toEqual([]);

    const bound = withHandle({ binder: BINDER });
    expect(checkReadBack({ kind: "set-binder", binder: BINDER }, migrated, bound)).toEqual([]);
    expect(checkReadBack({ kind: "set-binder", binder: BINDER }, migrated, migrated)).not.toEqual(
      [],
    );
    expect(
      checkReadBack(
        { kind: "set-binder", binder: BINDER },
        migrated,
        withHandle({ binder: BINDER, binderRevoked: true }),
      ),
    ).not.toEqual([]);

    const fee = withHandle({ minFeeLamports: 2_500_000n });
    expect(checkReadBack({ kind: "set-min-fee", lamports: 2_500_000n }, migrated, fee)).toEqual([]);
    expect(
      checkReadBack({ kind: "set-min-fee", lamports: 2_500_000n }, migrated, migrated),
    ).not.toEqual([]);

    const revoked = withHandle({ binder: BINDER, binderRevoked: true });
    expect(checkReadBack({ kind: "revoke-binder" }, bound, revoked)).toEqual([]);
    expect(checkReadBack({ kind: "revoke-binder" }, bound, bound)).not.toEqual([]);

    const paused = { ...old, paused: true };
    expect(checkReadBack({ kind: "set-paused", paused: true }, old, paused)).toEqual([]);
    expect(checkReadBack({ kind: "set-paused", paused: true }, old, old)).not.toEqual([]);
  });

  it("migrate-config: every new field must be zero", () => {
    expect(
      checkReadBack({ kind: "migrate-config" }, old, withHandle({ binder: BINDER })),
    ).not.toEqual([]);
    expect(
      checkReadBack({ kind: "migrate-config" }, old, withHandle({ minFeeLamports: 1n })),
    ).not.toEqual([]);
    expect(checkReadBack({ kind: "migrate-config" }, old, withHandle({ guardian }))).not.toEqual(
      [],
    );
    expect(
      checkReadBack({ kind: "migrate-config" }, old, withHandle({ binderRevoked: true })),
    ).not.toEqual([]);
  });

  it("fails when an old field moved: admin, relayer, fee wallet, fee, chain id", () => {
    const action: AdminAction = { kind: "set-paused", paused: true };
    const paused = { ...old, paused: true };
    expect(checkReadBack(action, old, { ...paused, admin: stranger })).not.toEqual([]);
    expect(checkReadBack(action, old, { ...paused, relayer: stranger })).not.toEqual([]);
    expect(checkReadBack(action, old, { ...paused, feeWallet: stranger })).not.toEqual([]);
    expect(checkReadBack(action, old, { ...paused, defaultFeeBps: 101 })).not.toEqual([]);
    expect(checkReadBack(action, old, { ...paused, chainId: 104n })).not.toEqual([]);
  });

  it("set-fee-per-receiver and set-max-fee: the field landed, nothing else moved", () => {
    const perReceiver: AdminAction = { kind: "set-fee-per-receiver", lamports: 300_000n };
    const maxFee: AdminAction = { kind: "set-max-fee", lamports: 500_000_000n };
    const live = withHandle({ binder: BINDER, minFeeLamports: 300_000n });
    const setPer = (fields: Partial<NonNullable<ConfigAccount["handle"]>>) =>
      withHandle({ binder: BINDER, minFeeLamports: 300_000n, ...fields });

    expect(
      checkReadBack(perReceiver, live, setPer({ minFeePerReceiverLamports: 300_000n })),
    ).toEqual([]);
    expect(checkReadBack(perReceiver, live, live)).not.toEqual([]);
    expect(checkReadBack(maxFee, live, setPer({ maxFeeLamports: 500_000_000n }))).toEqual([]);
    expect(checkReadBack(maxFee, live, live)).not.toEqual([]);

    // The other new field, the flat minimum or the binder moved too: wrong.
    expect(
      checkReadBack(
        perReceiver,
        live,
        setPer({ minFeePerReceiverLamports: 300_000n, maxFeeLamports: 1n }),
      ),
    ).not.toEqual([]);
    expect(
      checkReadBack(
        maxFee,
        live,
        setPer({ maxFeeLamports: 500_000_000n, minFeePerReceiverLamports: 1n }),
      ),
    ).not.toEqual([]);
    expect(
      checkReadBack(
        perReceiver,
        live,
        setPer({ minFeePerReceiverLamports: 300_000n, minFeeLamports: 0n }),
      ),
    ).not.toEqual([]);
    expect(
      checkReadBack(maxFee, live, setPer({ maxFeeLamports: 500_000_000n, binder: DEFAULT_PUBKEY })),
    ).not.toEqual([]);
    // An old field moved: wrong too.
    expect(
      checkReadBack(maxFee, live, {
        ...setPer({ maxFeeLamports: 500_000_000n }),
        defaultFeeBps: 101,
      }),
    ).not.toEqual([]);
    // Set back to zero, the brake: passes when it landed.
    expect(
      checkReadBack(
        { kind: "set-max-fee", lamports: 0n },
        setPer({ maxFeeLamports: 500_000_000n }),
        live,
      ),
    ).toEqual([]);
  });

  it("set-min-fee: the two new fields must not move", () => {
    const live = withHandle({ minFeeLamports: 300_000n, minFeePerReceiverLamports: 300_000n });
    const zero = withHandle({ minFeeLamports: 0n, minFeePerReceiverLamports: 300_000n });
    expect(checkReadBack({ kind: "set-min-fee", lamports: 0n }, live, zero)).toEqual([]);
    expect(
      checkReadBack(
        { kind: "set-min-fee", lamports: 0n },
        live,
        withHandle({ minFeeLamports: 0n, minFeePerReceiverLamports: 0n }),
      ),
    ).not.toEqual([]);
  });

  it("fails when another handle field moved", () => {
    const bound = withHandle({ binder: BINDER });
    expect(
      checkReadBack(
        { kind: "set-min-fee", lamports: 2_500_000n },
        bound,
        withHandle({ minFeeLamports: 2_500_000n }),
      ),
    ).not.toEqual([]);
  });
});

describe("describeConfig, the before and after lines of the script", () => {
  it("shows the two fields on a 253 byte Config", () => {
    const line = describeConfig(
      withHandle({
        binder: BINDER,
        minFeeLamports: 0n,
        minFeePerReceiverLamports: 300_000n,
        maxFeeLamports: 500_000_000n,
      }),
    );
    expect(line).toContain("min fee 0 lamports");
    expect(line).toContain("fee per receiver 300000 lamports");
    expect(line).toContain("max fee 500000000 lamports");
    expect(line).toContain("binder DhiQHDcochXLnLXhwMT3JVDcDe1pVfXjMG7pkPboowGq");
    expect(line).toContain("fee 100 bps");
  });

  it("says a 116 byte Config has no handle fields", () => {
    expect(describeConfig(old)).toContain("116 bytes, no handle fields");
  });
});

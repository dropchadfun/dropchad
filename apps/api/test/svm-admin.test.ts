/**
 * The Solana admin calls of the admin tool, and the two fee setters. The seven builders are
 * pinned to the IDL and to the real devnet `Config` address; the checks in `src/chain/svm/admin.ts` decide send, nothing to do, or
 * refuse before anything is simulated, and check the read back after a send. The relayer never
 * sends any of these. Also the two step handover, `propose-admin` and `accept-admin`,
 * `sweep-sol` and `set-relayer`.
 * adds `set-guardian`.
 */
import { describe, expect, it } from "vitest";

import type { ConfigAccount } from "../src/chain/svm/accounts.js";
import {
  MAX_MIN_FEE_LAMPORTS,
  MAX_MIN_FEE_PER_RECEIVER_LAMPORTS,
  adminInstruction,
  checkAdminCall,
  checkReadBack,
  checkSweepReadBack,
  checkSweepSol,
  describeConfig,
  parseAdminArgs,
  type AdminAction,
} from "../src/chain/svm/admin.js";
import {
  acceptAdminInstruction,
  guardianPauseInstruction,
  instructionNameOf,
  migrateConfigInstruction,
  proposeAdminInstruction,
  revokeBinderInstruction,
  setBinderInstruction,
  setFeePerReceiverInstruction,
  setGuardianInstruction,
  setMaxFeeInstruction,
  setMinFeeInstruction,
  setPausedInstruction,
  setRelayerInstruction,
  sweepSolInstruction,
} from "../src/chain/svm/instructions.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { ALLOWED_INSTRUCTIONS } from "../src/chain/svm/relayer.js";
import {
  RESERVED_ACCOUNT_KEYS,
  isReservedAccountKey,
  reservedAccountName,
} from "../src/chain/svm/reserved.js";
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
const next = randomSigner().publicKey;

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
    pendingAdmin: DEFAULT_PUBKEY,
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

  it("guardian_pause: the signer, admin or guardian, and config writable, no args", () => {
    const ix = guardianPauseInstruction({ signer: guardian });
    expect(instructionNameOf(ix.data)).toBe("guardian_pause");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.pubkey).toBe(guardian);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[0]?.isWritable).toBe(false);
    expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
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

  it("propose_admin: admin signs, config writable, the 32 byte key after the discriminator", () => {
    const ix = proposeAdminInstruction({ admin, pendingAdmin: next });
    expect(instructionNameOf(ix.data)).toBe("propose_admin");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.pubkey).toBe(admin);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(ix.data.length).toBe(8 + 32);
    expect(pubkeyEquals(ix.data.slice(8), next)).toBe(true);
    // The zero key cancels; it is encoded like any other key.
    const cancel = proposeAdminInstruction({ admin, pendingAdmin: DEFAULT_PUBKEY });
    expect(cancel.data.slice(8)).toEqual(new Uint8Array(32));
  });

  it("accept_admin: the pending key signs, config writable, no args", () => {
    const ix = acceptAdminInstruction({ pendingAdmin: next });
    expect(instructionNameOf(ix.data)).toBe("accept_admin");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.pubkey).toBe(next);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(ix.data.length).toBe(8);
  });

  it("set_relayer: admin signs, config writable, the 32 byte key after the discriminator", () => {
    const ix = setRelayerInstruction({ admin, relayer: next });
    expect(instructionNameOf(ix.data)).toBe("set_relayer");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.pubkey).toBe(admin);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[0]?.isWritable).toBe(false);
    expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(ix.data.length).toBe(8 + 32);
    expect(pubkeyEquals(ix.data.slice(8), next)).toBe(true);
  });

  it("set_guardian: admin signs, config writable, the 32 byte key after the discriminator", () => {
    const ix = setGuardianInstruction({ admin, guardian: next });
    expect(instructionNameOf(ix.data)).toBe("set_guardian");
    expect(ix.keys).toHaveLength(2);
    expect(ix.keys[0]?.pubkey).toBe(admin);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[0]?.isWritable).toBe(false);
    expect(pubkeyToBase58(configMeta(ix.keys).pubkey)).toBe(CONFIG);
    expect(configMeta(ix.keys).isWritable).toBe(true);
    expect(ix.data.length).toBe(8 + 32);
    expect(pubkeyEquals(ix.data.slice(8), next)).toBe(true);
    // Zero clears the guardian.
    const clear = setGuardianInstruction({ admin, guardian: DEFAULT_PUBKEY });
    expect(pubkeyEquals(clear.data.slice(8), DEFAULT_PUBKEY)).toBe(true);
  });

  it("sweep_sol: caller signs, drop and refund recipient writable, no args", () => {
    const drop = randomSigner().publicKey;
    const refundRecipient = randomSigner().publicKey;
    const ix = sweepSolInstruction({ caller: stranger, drop, refundRecipient });
    expect(instructionNameOf(ix.data)).toBe("sweep_sol");
    expect(ix.keys).toHaveLength(3);
    expect(ix.keys[0]?.pubkey).toBe(stranger);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[1]?.pubkey).toBe(drop);
    expect(ix.keys[1]?.isWritable).toBe(true);
    expect(ix.keys[1]?.isSigner).toBe(false);
    expect(ix.keys[2]?.pubkey).toBe(refundRecipient);
    expect(ix.keys[2]?.isWritable).toBe(true);
    expect(ix.keys[2]?.isSigner).toBe(false);
    expect(ix.data.length).toBe(8);
  });

  it("adminInstruction picks the builder for each action", () => {
    const cases: [AdminAction, string][] = [
      [{ kind: "migrate-config" }, "migrate_config"],
      [{ kind: "set-binder", binder: BINDER }, "set_binder"],
      [{ kind: "set-min-fee", lamports: 2_500_000n }, "set_min_fee"],
      [{ kind: "revoke-binder" }, "revoke_binder"],
      [{ kind: "guardian-pause" }, "guardian_pause"],
      [{ kind: "set-paused", paused: true }, "set_paused"],
      [{ kind: "set-fee-per-receiver", lamports: 300_000n }, "set_fee_per_receiver"],
      [{ kind: "set-max-fee", lamports: 500_000_000n }, "set_max_fee"],
      [{ kind: "propose-admin", pendingAdmin: next }, "propose_admin"],
      [{ kind: "accept-admin" }, "accept_admin"],
      [{ kind: "set-relayer", relayer: next }, "set_relayer"],
      [{ kind: "set-guardian", guardian: next }, "set_guardian"],
    ];
    for (const [action, name] of cases) {
      expect(instructionNameOf(adminInstruction(action, admin).data)).toBe(name);
    }
    // accept_admin is signed by the pending key, the signer passed in.
    expect(adminInstruction({ kind: "accept-admin" }, next).keys[0]?.pubkey).toBe(next);
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
      "guardian_pause",
      "set_paused",
      "set_fee_per_receiver",
      "set_max_fee",
      "propose_admin",
      "accept_admin",
      "sweep_sol",
      "set_relayer",
      "set_guardian",
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
    expect(parse("guardian-pause", "--keypair", "C:/g.json", "--dry-run")).toMatchObject({
      action: { kind: "guardian-pause" },
      keypair: "C:/g.json",
      dryRun: true,
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

  it("reads propose-admin, accept-admin and sweep-sol", () => {
    const proposed = parse("propose-admin", "--admin", pubkeyToBase58(next), "--dry-run");
    expect(proposed).toMatchObject({ action: { kind: "propose-admin" }, dryRun: true });
    expect(
      "action" in proposed &&
        proposed.action.kind === "propose-admin" &&
        pubkeyEquals(proposed.action.pendingAdmin, next),
    ).toBe(true);
    // The zero key, 32 ones in base58, is the cancel.
    const cancel = parse("propose-admin", "--admin", "11111111111111111111111111111111");
    expect(
      "action" in cancel &&
        cancel.action.kind === "propose-admin" &&
        pubkeyEquals(cancel.action.pendingAdmin, DEFAULT_PUBKEY),
    ).toBe(true);
    expect(parse("accept-admin", "--keypair", "C:/t.json")).toMatchObject({
      action: { kind: "accept-admin" },
      keypair: "C:/t.json",
    });
    const drop = "Cv8tARZ5dRzDwDYZqYVKWaYALnKkrB2Fv5GhoVPzFRyD";
    const sweep = parse("sweep-sol", "--drop", drop);
    expect(sweep).toMatchObject({ action: { kind: "sweep-sol" }, dryRun: false });
    expect(
      "action" in sweep &&
        sweep.action.kind === "sweep-sol" &&
        pubkeyToBase58(sweep.action.drop) === drop,
    ).toBe(true);
  });

  it("reads set-relayer", () => {
    const parsed = parse("set-relayer", "--relayer", pubkeyToBase58(next), "--dry-run");
    expect(parsed).toMatchObject({ action: { kind: "set-relayer" }, dryRun: true });
    expect(
      "action" in parsed &&
        parsed.action.kind === "set-relayer" &&
        pubkeyEquals(parsed.action.relayer, next),
    ).toBe(true);
  });

  it("reads set-guardian, the zero key as the clear", () => {
    const parsed = parse("set-guardian", "--guardian", pubkeyToBase58(guardian), "--dry-run");
    expect(parsed).toMatchObject({ action: { kind: "set-guardian" }, dryRun: true });
    expect(
      "action" in parsed &&
        parsed.action.kind === "set-guardian" &&
        pubkeyEquals(parsed.action.guardian, guardian),
    ).toBe(true);
    const clear = parse("set-guardian", "--guardian", "11111111111111111111111111111111");
    expect(
      "action" in clear &&
        clear.action.kind === "set-guardian" &&
        pubkeyEquals(clear.action.guardian, DEFAULT_PUBKEY),
    ).toBe(true);
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
      ["propose-admin"],
      ["propose-admin", "--admin", "not-a-key"],
      ["sweep-sol"],
      ["sweep-sol", "--drop", "not-a-key"],
      ["set-relayer"],
      ["set-relayer", "--relayer", "not-a-key"],
      ["set-relayer", "--binder", pubkeyToBase58(next)],
      ["set-guardian"],
      ["set-guardian", "--guardian", "not-a-key"],
      ["set-guardian", "--relayer", pubkeyToBase58(next)],
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

  it("set-relayer: the admin only, needs the migration, a new key is a send", () => {
    const action: AdminAction = { kind: "set-relayer", relayer: next };
    const bound = withHandle({ binder: BINDER, guardian });
    expect(check(action, bound).result).toBe("send");
    expect(check(action, bound, stranger).result).toBe("refuse");
    expect(check(action, bound, relayer).result).toBe("refuse");
    const needsMigration = check(action, old);
    expect(needsMigration.result).toBe("refuse");
    expect("reason" in needsMigration && needsMigration.reason).toContain("migrate-config");
    // The same key again: nothing to do.
    expect(check({ kind: "set-relayer", relayer }, bound).result).toBe("nothing");
  });

  it("set-guardian: the admin only, needs the migration, a new key is a send", () => {
    const action: AdminAction = { kind: "set-guardian", guardian: next };
    const bound = withHandle({ binder: BINDER, guardian });
    expect(check(action, bound).result).toBe("send");
    expect(check(action, bound, stranger).result).toBe("refuse");
    // The guardian cannot set the guardian.
    expect(check(action, bound, guardian).result).toBe("refuse");
    const needsMigration = check(action, old);
    expect(needsMigration.result).toBe("refuse");
    expect("reason" in needsMigration && needsMigration.reason).toContain("migrate-config");
    // The same key again: nothing to do.
    expect(check({ kind: "set-guardian", guardian }, bound).result).toBe("nothing");
  });

  it("set-guardian: zero clears, a send when one is set, nothing when none", () => {
    const clear: AdminAction = { kind: "set-guardian", guardian: DEFAULT_PUBKEY };
    expect(check(clear, withHandle({ binder: BINDER, guardian })).result).toBe("send");
    expect(check(clear, withHandle({ binder: BINDER })).result).toBe("nothing");
  });

  it("set-guardian: refuses the admin, the relayer and the binder", () => {
    const bound = withHandle({ binder: BINDER });
    for (const [key, role] of [
      [admin, "admin"],
      [relayer, "relayer"],
      [BINDER, "binder"],
    ] as const) {
      const out = check({ kind: "set-guardian", guardian: key }, bound);
      expect(out.result, role).toBe("refuse");
      expect("reason" in out && out.reason, role).toContain(role);
    }
  });

  it("set-relayer: refuses the zero key, the admin and the binder", () => {
    const bound = withHandle({ binder: BINDER });
    const zero = check({ kind: "set-relayer", relayer: DEFAULT_PUBKEY }, bound);
    expect(zero.result).toBe("refuse");
    expect("reason" in zero && zero.reason).toContain("ZeroAddress");
    const asAdmin = check({ kind: "set-relayer", relayer: admin }, bound);
    expect(asAdmin.result).toBe("refuse");
    expect("reason" in asAdmin && asAdmin.reason).toContain("admin");
    const asBinder = check({ kind: "set-relayer", relayer: BINDER }, bound);
    expect(asBinder.result).toBe("refuse");
    expect("reason" in asBinder && asBinder.reason).toContain("binder");
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

  it("guardian-pause: the admin or a non zero guardian, nothing to do when paused", () => {
    const action: AdminAction = { kind: "guardian-pause" };
    const live = withHandle({ binder: BINDER, guardian });
    expect(check(action, live).result).toBe("send");
    expect(check(action, live, guardian).result).toBe("send");
    expect(check(action, live, stranger).result).toBe("refuse");
    // No guardian set: the zero key lets nobody else through.
    expect(check(action, migrated, stranger).result).toBe("refuse");
    expect(check(action, { ...live, paused: true }, guardian).result).toBe("nothing");
    expect(check(action, old).result).toBe("refuse");
  });

  it("set-paused: works before and after the migration, nothing to do when equal", () => {
    expect(check({ kind: "set-paused", paused: true }, old).result).toBe("send");
    expect(check({ kind: "set-paused", paused: true }, migrated).result).toBe("send");
    expect(check({ kind: "set-paused", paused: false }, old).result).toBe("nothing");
  });

  it("propose-admin: the admin only, needs the migration, a new key is a send", () => {
    const propose = (pendingAdmin: Uint8Array): AdminAction => ({
      kind: "propose-admin",
      pendingAdmin,
    });
    expect(check(propose(next), migrated).result).toBe("send");
    expect(check(propose(next), migrated, stranger).result).toBe("refuse");
    expect(check(propose(next), migrated, next).result).toBe("refuse");
    const needsMigration = check(propose(next), old);
    expect(needsMigration.result).toBe("refuse");
    expect("reason" in needsMigration && needsMigration.reason).toContain("migrate-config");
    // A different key replaces the one pending: a send. The same key again: nothing to do.
    const third = randomSigner().publicKey;
    expect(check(propose(third), withHandle({ pendingAdmin: next })).result).toBe("send");
    expect(check(propose(next), withHandle({ pendingAdmin: next })).result).toBe("nothing");
  });

  it("propose-admin: refuses the relayer, the binder and the admin itself", () => {
    const bound = withHandle({ binder: BINDER });
    const relayerCheck = check({ kind: "propose-admin", pendingAdmin: relayer }, bound);
    expect(relayerCheck.result).toBe("refuse");
    expect("reason" in relayerCheck && relayerCheck.reason).toContain("relayer");
    const binderCheck = check({ kind: "propose-admin", pendingAdmin: BINDER }, bound);
    expect(binderCheck.result).toBe("refuse");
    expect("reason" in binderCheck && binderCheck.reason).toContain("binder");
    expect(check({ kind: "propose-admin", pendingAdmin: admin }, bound).result).toBe("refuse");
  });

  it("propose-admin with the zero key cancels: a send when something is pending, else nothing", () => {
    const cancel: AdminAction = { kind: "propose-admin", pendingAdmin: DEFAULT_PUBKEY };
    expect(check(cancel, withHandle({ pendingAdmin: next })).result).toBe("send");
    expect(check(cancel, migrated).result).toBe("nothing");
    // The zero binder of a fresh Config is not a reason to refuse the cancel.
    expect(check(cancel, withHandle({ binder: DEFAULT_PUBKEY, pendingAdmin: next })).result).toBe(
      "send",
    );
  });

  it("accept-admin: only the pending key signs, never the admin, nothing pending refuses", () => {
    const accept: AdminAction = { kind: "accept-admin" };
    const pending = withHandle({ pendingAdmin: next });
    expect(check(accept, pending, next).result).toBe("send");
    const byAdmin = check(accept, pending, admin);
    expect(byAdmin.result).toBe("refuse");
    expect("reason" in byAdmin && byAdmin.reason).toContain(pubkeyToBase58(next));
    expect(check(accept, pending, stranger).result).toBe("refuse");
    const none = check(accept, migrated, next);
    expect(none.result).toBe("refuse");
    expect("reason" in none && none.reason).toContain("NotPendingAdmin");
    expect(check(accept, old, next).result).toBe("refuse");
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

    const live = withHandle({ binder: BINDER, guardian });
    const livePaused = { ...live, paused: true };
    expect(checkReadBack({ kind: "guardian-pause" }, live, livePaused)).toEqual([]);
    expect(checkReadBack({ kind: "guardian-pause" }, live, live)).not.toEqual([]);
    expect(
      checkReadBack({ kind: "guardian-pause" }, live, { ...livePaused, defaultFeeBps: 200 }),
    ).not.toEqual([]);
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

  it("propose-admin: pending_admin landed, admin and the rest did not move", () => {
    const action: AdminAction = { kind: "propose-admin", pendingAdmin: next };
    const pending = withHandle({ pendingAdmin: next });
    expect(checkReadBack(action, migrated, pending)).toEqual([]);
    expect(checkReadBack(action, migrated, migrated)).not.toEqual([]);
    expect(checkReadBack(action, migrated, { ...pending, admin: next })).not.toEqual([]);
    expect(
      checkReadBack(action, migrated, withHandle({ pendingAdmin: next, binder: BINDER })),
    ).not.toEqual([]);
    // The cancel: back to zero.
    const cancel: AdminAction = { kind: "propose-admin", pendingAdmin: DEFAULT_PUBKEY };
    expect(checkReadBack(cancel, pending, migrated)).toEqual([]);
    expect(checkReadBack(cancel, pending, pending)).not.toEqual([]);
  });

  it("accept-admin: admin is the key that was pending, pending_admin zero, nothing else moved", () => {
    const action: AdminAction = { kind: "accept-admin" };
    const before = withHandle({ pendingAdmin: next });
    const after = { ...migrated, admin: next };
    expect(checkReadBack(action, before, after)).toEqual([]);
    expect(checkReadBack(action, before, before)).not.toEqual([]);
    expect(
      checkReadBack(action, before, { ...withHandle({ pendingAdmin: next }), admin: next }),
    ).not.toEqual([]);
    expect(checkReadBack(action, before, { ...migrated, admin: stranger })).not.toEqual([]);
    expect(checkReadBack(action, before, { ...after, relayer: stranger })).not.toEqual([]);
  });

  it("set-relayer: relayer is the new key, nothing else moved", () => {
    const action: AdminAction = { kind: "set-relayer", relayer: next };
    const bound = withHandle({ binder: BINDER });
    const after = { ...bound, relayer: next };
    expect(checkReadBack(action, bound, after)).toEqual([]);
    expect(checkReadBack(action, bound, bound)).not.toEqual([]);
    expect(checkReadBack(action, bound, { ...bound, relayer: stranger })).not.toEqual([]);
    expect(checkReadBack(action, bound, { ...after, admin: next })).not.toEqual([]);
    expect(checkReadBack(action, bound, { ...after, feeWallet: stranger })).not.toEqual([]);
    expect(
      checkReadBack(action, bound, { ...withHandle({ binder: next }), relayer: next }),
    ).not.toEqual([]);
    expect(
      checkReadBack(action, bound, {
        ...withHandle({ binder: BINDER, pendingAdmin: next }),
        relayer: next,
      }),
    ).not.toEqual([]);
  });

  it("set-guardian: guardian is the new key, nothing else moved", () => {
    const action: AdminAction = { kind: "set-guardian", guardian: next };
    const bound = withHandle({ binder: BINDER });
    const after = withHandle({ binder: BINDER, guardian: next });
    expect(checkReadBack(action, bound, after)).toEqual([]);
    expect(checkReadBack(action, bound, bound)).not.toEqual([]);
    expect(
      checkReadBack(action, bound, withHandle({ binder: BINDER, guardian: stranger })),
    ).not.toEqual([]);
    expect(checkReadBack(action, bound, { ...after, admin: next })).not.toEqual([]);
    expect(checkReadBack(action, bound, { ...after, paused: true })).not.toEqual([]);
    expect(
      checkReadBack(action, bound, withHandle({ binder: stranger, guardian: next })),
    ).not.toEqual([]);
    // The clear: guardian back to zero, nothing else moved.
    const clear: AdminAction = { kind: "set-guardian", guardian: DEFAULT_PUBKEY };
    expect(checkReadBack(clear, after, bound)).toEqual([]);
    expect(checkReadBack(clear, after, after)).not.toEqual([]);
  });

  it("other actions still fail when the relayer moved", () => {
    const action: AdminAction = { kind: "set-binder", binder: BINDER };
    expect(
      checkReadBack(action, migrated, { ...withHandle({ binder: BINDER }), relayer: next }),
    ).not.toEqual([]);
  });

  it("every other action fails when pending_admin moved", () => {
    const action: AdminAction = { kind: "set-min-fee", lamports: 2_500_000n };
    expect(
      checkReadBack(
        action,
        migrated,
        withHandle({ minFeeLamports: 2_500_000n, pendingAdmin: next }),
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

  it("shows the pending admin, or none", () => {
    expect(describeConfig(withHandle({ pendingAdmin: next }))).toContain(
      `pending admin ${pubkeyToBase58(next)}`,
    );
    expect(describeConfig(migrated)).toContain("pending admin none");
  });
});

describe("checkSweepSol, before sweep-sol sends", () => {
  const RENT = 2_804_160n;

  it("sends what is above the rent minimum of a closed drop", () => {
    expect(
      checkSweepSol({ closed: true, lamports: RENT + 10_000_000n, rentMinimum: RENT }),
    ).toEqual({ result: "send", amount: 10_000_000n });
    expect(checkSweepSol({ closed: true, lamports: RENT + 1n, rentMinimum: RENT })).toEqual({
      result: "send",
      amount: 1n,
    });
  });

  it("refuses a drop that is not closed, as the program would, NotClosed", () => {
    const open = checkSweepSol({ closed: false, lamports: RENT + 10_000_000n, rentMinimum: RENT });
    expect(open.result).toBe("refuse");
    expect("reason" in open && open.reason).toContain("NotClosed");
  });

  it("nothing to do at or below the rent minimum, NothingToSweep", () => {
    const at = checkSweepSol({ closed: true, lamports: RENT, rentMinimum: RENT });
    expect(at.result).toBe("nothing");
    expect("reason" in at && at.reason).toContain("NothingToSweep");
    expect(checkSweepSol({ closed: true, lamports: RENT - 1n, rentMinimum: RENT }).result).toBe(
      "nothing",
    );
  });
});

describe("checkSweepReadBack, after sweep-sol", () => {
  const RENT = 2_804_160n;
  const ok = {
    amount: 10_000_000n,
    rentMinimum: RENT,
    dropAfter: RENT,
    recipientBefore: 1_000_000_000n,
    recipientAfter: 1_010_000_000n,
    fee: 0n,
  };

  it("passes when the drop holds its rent minimum and the recipient gained the amount", () => {
    expect(checkSweepReadBack(ok)).toEqual([]);
  });

  it("takes off the fee when the signer is the refund recipient", () => {
    expect(checkSweepReadBack({ ...ok, recipientAfter: 1_009_995_000n, fee: 5_000n })).toEqual([]);
    expect(checkSweepReadBack({ ...ok, recipientAfter: 1_009_995_000n })).not.toEqual([]);
  });

  it("fails when the drop kept more or less than its rent minimum", () => {
    expect(checkSweepReadBack({ ...ok, dropAfter: RENT + 1n })).not.toEqual([]);
    expect(checkSweepReadBack({ ...ok, dropAfter: RENT - 1n })).not.toEqual([]);
  });

  it("fails when the recipient did not gain the amount", () => {
    expect(checkSweepReadBack({ ...ok, recipientAfter: ok.recipientBefore })).not.toEqual([]);
    expect(checkSweepReadBack({ ...ok, recipientAfter: 1_010_000_001n })).not.toEqual([]);
  });
});

/**
 * The owner tools refuse a reserved account key of the runtime wherever they
 * set a key. The list is; one shared check in `src/chain/svm/reserved.ts`.
 */
describe("reserved account keys in the owner tools", () => {
  const CLOCK = "SysvarC1ock11111111111111111111111111111111";
  const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

  it("isReservedAccountKey: every key of the list, and nothing else", () => {
    for (const key of RESERVED_ACCOUNT_KEYS) {
      expect(isReservedAccountKey(key.address), key.name).toBe(true);
      expect(isReservedAccountKey(pubkeyFromBase58(key.address)), key.name).toBe(true);
    }
    expect(isReservedAccountKey(pubkeyToBase58(admin))).toBe(false);
    expect(isReservedAccountKey(CONFIG)).toBe(false);
    expect(isReservedAccountKey(BINDER)).toBe(false);
  });

  it("names the key in a sentence for the tools", () => {
    expect(reservedAccountName(CLOCK)).toBe("clock sysvar");
    expect(reservedAccountName(pubkeyFromBase58(LOADER))).toBe("upgradeable BPF loader");
    expect(reservedAccountName(pubkeyToBase58(admin))).toBeNull();
  });

  const config = withHandle({ binder: BINDER });
  const clock = pubkeyFromBase58(CLOCK);

  it("checkAdminCall refuses a reserved key as relayer, binder, pending admin or guardian", () => {
    const actions: AdminAction[] = [
      { kind: "set-relayer", relayer: clock },
      { kind: "set-binder", binder: clock },
      { kind: "propose-admin", pendingAdmin: clock },
      { kind: "set-guardian", guardian: clock },
    ];
    for (const action of actions) {
      const out = checkAdminCall(action, config, admin);
      expect(out.result, action.kind).toBe("refuse");
      expect("reason" in out && out.reason, action.kind).toMatch(/Solana system account/);
    }
  });

  it("the zero key keeps its meaning: propose-admin zero is still the cancel", () => {
    const pending = withHandle({ binder: BINDER, pendingAdmin: next });
    expect(
      checkAdminCall({ kind: "propose-admin", pendingAdmin: DEFAULT_PUBKEY }, pending, admin),
    ).toEqual({ result: "send" });
  });
});

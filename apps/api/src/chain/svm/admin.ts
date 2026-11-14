/**
 * The Solana admin calls: the setters, the two fee setters, the two step admin handover and
 * `sweep-sol`, plus `set-relayer` and `set-guardian`. The logic of the admin command line,
 * kept here so it is tested without a chain: which call to build, whether to send it, and
 * whether the read back after it shows the change.
 *
 * Run by the admin only. The relayer never sends any of these: none of the
 * eleven is on its `ALLOWED_INSTRUCTIONS`.
 */
import type { ConfigAccount, ConfigHandleFields } from "./accounts.js";
import {
  acceptAdminInstruction,
  migrateConfigInstruction,
  proposeAdminInstruction,
  guardianPauseInstruction,
  revokeBinderInstruction,
  setBinderInstruction,
  setFeePerReceiverInstruction,
  setGuardianInstruction,
  setMaxFeeInstruction,
  setMinFeeInstruction,
  setPausedInstruction,
  setRelayerInstruction,
} from "./instructions.js";
import {
  DEFAULT_PUBKEY,
  pubkeyEquals,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "./pubkey.js";
import { reservedAccountName } from "./reserved.js";
import type { Instruction } from "./transaction.js";

/** mirrored so a wrong value is a sentence, not a simulation log. */
export const MAX_MIN_FEE_LAMPORTS = 25_000_000n;
/** The program's `MAX_MIN_FEE_PER_RECEIVER_LAMPORTS`, mirrored the same way. */
export const MAX_MIN_FEE_PER_RECEIVER_LAMPORTS = 3_000_000n;
/** The program's `MAX_SOL_FEE_LAMPORTS`, the ceiling of `set_max_fee`. */
export const MAX_SOL_FEE_LAMPORTS = 1_000_000_000n;

export const DEFAULT_RPC = "https://api.devnet.solana.com";

export type AdminAction =
  | { readonly kind: "migrate-config" }
  | { readonly kind: "set-binder"; readonly binder: Pubkey }
  | { readonly kind: "set-min-fee"; readonly lamports: bigint }
  | { readonly kind: "set-fee-per-receiver"; readonly lamports: bigint }
  | { readonly kind: "set-max-fee"; readonly lamports: bigint }
  | { readonly kind: "revoke-binder" }
  | { readonly kind: "guardian-pause" }
  | { readonly kind: "set-paused"; readonly paused: boolean }
  | { readonly kind: "propose-admin"; readonly pendingAdmin: Pubkey }
  | { readonly kind: "accept-admin" }
  | { readonly kind: "set-relayer"; readonly relayer: Pubkey }
  | { readonly kind: "set-guardian"; readonly guardian: Pubkey };

/** Not a `Config` call: it reads and checks the drop instead, so it is its own type. */
export interface SweepSolAction {
  readonly kind: "sweep-sol";
  readonly drop: Pubkey;
}

export interface AdminArgs {
  readonly action: AdminAction | SweepSolAction;
  /** `undefined` means the default, `~/.config/solana/id.json`; the script resolves it. */
  readonly keypair: string | undefined;
  readonly rpc: string;
  readonly dryRun: boolean;
}

export type AdminCheck =
  | { readonly result: "send" }
  | { readonly result: "nothing"; readonly reason: string }
  | { readonly result: "refuse"; readonly reason: string };

const USAGE =
  "usage: solana-admin.ts <migrate-config | set-binder --binder <pubkey> | " +
  "set-min-fee --lamports <n> | set-fee-per-receiver --lamports <n> | " +
  "set-max-fee --lamports <n> | revoke-binder | guardian-pause | " +
  "set-paused --paused true|false | " +
  "propose-admin --admin <pubkey> | accept-admin | set-relayer --relayer <pubkey> | " +
  "set-guardian --guardian <pubkey> | " +
  "sweep-sol --drop <address>> " +
  "[--keypair <path>] [--rpc <url>] [--dry-run]";

/** The command line, `process.argv.slice(2)`. Anything it does not know is an error. */
export function parseAdminArgs(argv: readonly string[]): AdminArgs | { readonly error: string } {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const rest = {
    keypair: value("keypair"),
    rpc: value("rpc") ?? DEFAULT_RPC,
    dryRun: argv.includes("--dry-run"),
  };

  const command = argv[0];
  switch (command) {
    case "migrate-config":
      return { action: { kind: "migrate-config" }, ...rest };
    case "revoke-binder":
      return { action: { kind: "revoke-binder" }, ...rest };
    case "guardian-pause":
      return { action: { kind: "guardian-pause" }, ...rest };
    case "set-binder": {
      const text = value("binder");
      if (text === undefined) return { error: "set-binder needs --binder <pubkey>" };
      try {
        return { action: { kind: "set-binder", binder: pubkeyFromBase58(text) }, ...rest };
      } catch {
        return { error: `--binder is not a base58 public key: ${text}` };
      }
    }
    case "set-min-fee":
    case "set-fee-per-receiver":
    case "set-max-fee": {
      const kind = command;
      const text = value("lamports");
      if (text === undefined || !/^\d+$/.test(text)) {
        return { error: `${kind} needs --lamports <a whole number>` };
      }
      return { action: { kind, lamports: BigInt(text) }, ...rest };
    }
    case "set-paused": {
      const text = value("paused");
      if (text !== "true" && text !== "false") {
        return { error: "set-paused needs --paused true or --paused false" };
      }
      return { action: { kind: "set-paused", paused: text === "true" }, ...rest };
    }
    case "accept-admin":
      return { action: { kind: "accept-admin" }, ...rest };
    case "set-relayer": {
      const text = value("relayer");
      if (text === undefined) return { error: "set-relayer needs --relayer <pubkey>" };
      try {
        return { action: { kind: "set-relayer", relayer: pubkeyFromBase58(text) }, ...rest };
      } catch {
        return { error: `--relayer is not a base58 public key: ${text}` };
      }
    }
    case "set-guardian": {
      const text = value("guardian");
      if (text === undefined) return { error: "set-guardian needs --guardian <pubkey>" };
      try {
        return { action: { kind: "set-guardian", guardian: pubkeyFromBase58(text) }, ...rest };
      } catch {
        return { error: `--guardian is not a base58 public key: ${text}` };
      }
    }
    case "propose-admin":
    case "sweep-sol": {
      const flag = command === "propose-admin" ? "admin" : "drop";
      const text = value(flag);
      if (text === undefined) return { error: `${command} needs --${flag} <pubkey>` };
      let key: Pubkey;
      try {
        key = pubkeyFromBase58(text);
      } catch {
        return { error: `--${flag} is not a base58 public key: ${text}` };
      }
      return command === "propose-admin"
        ? { action: { kind: "propose-admin", pendingAdmin: key }, ...rest }
        : { action: { kind: "sweep-sol", drop: key }, ...rest };
    }
    default:
      return { error: USAGE };
  }
}

/** The instruction for an action. `signer` is the key that signs: the admin, or the guardian. */
export function adminInstruction(action: AdminAction, signer: Pubkey): Instruction {
  switch (action.kind) {
    case "migrate-config":
      return migrateConfigInstruction({ admin: signer });
    case "set-binder":
      return setBinderInstruction({ admin: signer, binder: action.binder });
    case "set-min-fee":
      return setMinFeeInstruction({ admin: signer, lamports: action.lamports });
    case "set-fee-per-receiver":
      return setFeePerReceiverInstruction({ admin: signer, lamports: action.lamports });
    case "set-max-fee":
      return setMaxFeeInstruction({ admin: signer, lamports: action.lamports });
    case "revoke-binder":
      return revokeBinderInstruction({ signer });
    case "guardian-pause":
      return guardianPauseInstruction({ signer });
    case "set-paused":
      return setPausedInstruction({ admin: signer, paused: action.paused });
    case "propose-admin":
      return proposeAdminInstruction({ admin: signer, pendingAdmin: action.pendingAdmin });
    case "accept-admin":
      return acceptAdminInstruction({ pendingAdmin: signer });
    case "set-relayer":
      return setRelayerInstruction({ admin: signer, relayer: action.relayer });
    case "set-guardian":
      return setGuardianInstruction({ admin: signer, guardian: action.guardian });
  }
}

const refuse = (reason: string): AdminCheck => ({ result: "refuse", reason });

/** A refusal when `key` is a reserved account key, which nothing can sign for. */
function reservedRefusal(key: Pubkey, role: string): AdminCheck | null {
  const name = reservedAccountName(key);
  if (name === null) return null;
  return refuse(
    `the ${role} ${pubkeyToBase58(key)} is a Solana system account (the ${name}); ` +
      "no transaction can sign as it.",
  );
}
const nothing = (reason: string): AdminCheck => ({ result: "nothing", reason });
const NEEDS_MIGRATION = "Config is still the 116 byte layout. Run migrate-config first.";

/**
 * Before anything is simulated: send, nothing to do, or refuse with the reason. The program
 * checks the same rules; this says them in a sentence and spares a failed transaction.
 */
export function checkAdminCall(
  action: AdminAction,
  config: ConfigAccount,
  signer: Pubkey,
): AdminCheck {
  const isAdmin = pubkeyEquals(signer, config.admin);
  const handle = config.handle;

  // `accept_admin` is signed by the pending key, never by the admin.
  if (action.kind === "accept-admin") {
    if (handle === null) return refuse(NEEDS_MIGRATION);
    if (pubkeyEquals(handle.pendingAdmin, DEFAULT_PUBKEY)) {
      return refuse("no handover is pending. The program would answer NotPendingAdmin.");
    }
    return pubkeyEquals(signer, handle.pendingAdmin)
      ? { result: "send" }
      : refuse(
          `config.pending_admin is ${pubkeyToBase58(handle.pendingAdmin)}, the keypair is ` +
            `${pubkeyToBase58(signer)}. The program would answer NotPendingAdmin.`,
        );
  }

  // `revoke_binder` and `guardian_pause` also take the guardian. Everything
  // else is the admin only.
  if (action.kind === "revoke-binder" || action.kind === "guardian-pause") {
    const isGuardian =
      handle !== null &&
      !pubkeyEquals(handle.guardian, DEFAULT_PUBKEY) &&
      pubkeyEquals(signer, handle.guardian);
    if (!isAdmin && !isGuardian) {
      return refuse(
        `the keypair ${pubkeyToBase58(signer)} is neither config.admin nor the guardian.`,
      );
    }
  } else if (!isAdmin) {
    return refuse(
      `config.admin is ${pubkeyToBase58(config.admin)}, the keypair is ${pubkeyToBase58(signer)}. ` +
        "The program would answer NotAdmin.",
    );
  }

  switch (action.kind) {
    case "migrate-config":
      return handle === null
        ? { result: "send" }
        : nothing("Config is already migrated, 253 bytes.");
    case "set-paused":
      return config.paused === action.paused
        ? nothing(`paused is already ${String(action.paused)}.`)
        : { result: "send" };
    case "set-binder": {
      if (handle === null) return refuse(NEEDS_MIGRATION);
      if (pubkeyEquals(action.binder, DEFAULT_PUBKEY)) {
        return refuse("the binder cannot be the zero key.");
      }
      const reservedBinder = reservedRefusal(action.binder, "binder");
      if (reservedBinder !== null) return reservedBinder;
      // Two keys, two powers. The program does not check this; we do.
      if (pubkeyEquals(action.binder, config.relayer)) {
        return refuse("the binder is the relayer key. The binder is its own key.");
      }
      return pubkeyEquals(handle.binder, action.binder) && !handle.binderRevoked
        ? nothing(`the binder is already ${pubkeyToBase58(action.binder)}, not revoked.`)
        : { result: "send" };
    }
    case "set-min-fee":
      if (handle === null) return refuse(NEEDS_MIGRATION);
      if (action.lamports > MAX_MIN_FEE_LAMPORTS) {
        return refuse(
          `--lamports ${String(action.lamports)} is above the program cap ` +
            `${String(MAX_MIN_FEE_LAMPORTS)}`,
        );
      }
      return handle.minFeeLamports === action.lamports
        ? nothing(`the minimum fee is already ${String(action.lamports)} lamports.`)
        : { result: "send" };
    case "set-fee-per-receiver":
      if (handle === null) return refuse(NEEDS_MIGRATION);
      if (action.lamports > MAX_MIN_FEE_PER_RECEIVER_LAMPORTS) {
        return refuse(
          `--lamports ${String(action.lamports)} is above the program cap ` +
            `${String(MAX_MIN_FEE_PER_RECEIVER_LAMPORTS)}`,
        );
      }
      return handle.minFeePerReceiverLamports === action.lamports
        ? nothing(`the fee per receiver is already ${String(action.lamports)} lamports.`)
        : { result: "send" };
    case "set-max-fee":
      if (handle === null) return refuse(NEEDS_MIGRATION);
      if (action.lamports > MAX_SOL_FEE_LAMPORTS) {
        return refuse(
          `--lamports ${String(action.lamports)} is above the program cap ` +
            `${String(MAX_SOL_FEE_LAMPORTS)}`,
        );
      }
      return handle.maxFeeLamports === action.lamports
        ? nothing(`the max fee is already ${String(action.lamports)} lamports.`)
        : { result: "send" };
    case "revoke-binder":
      if (handle === null) return refuse(NEEDS_MIGRATION);
      return handle.binderRevoked ? nothing("the binder is already revoked.") : { result: "send" };
    case "guardian-pause":
      if (handle === null) return refuse(NEEDS_MIGRATION);
      return config.paused ? nothing("paused is already true.") : { result: "send" };
    case "propose-admin": {
      if (handle === null) return refuse(NEEDS_MIGRATION);
      const key = action.pendingAdmin;
      // The zero key cancels.
      if (pubkeyEquals(key, DEFAULT_PUBKEY)) {
        return pubkeyEquals(handle.pendingAdmin, DEFAULT_PUBKEY)
          ? nothing("no handover is pending, nothing to cancel.")
          : { result: "send" };
      }
      if (pubkeyEquals(key, config.admin)) return refuse("that key is already the admin.");
      const reservedAdmin = reservedRefusal(key, "new admin");
      if (reservedAdmin !== null) return reservedAdmin;
      // One key, one power. The program does not check this; we do.
      if (pubkeyEquals(key, config.relayer)) {
        return refuse("the new admin is the relayer key. The admin is its own key.");
      }
      if (pubkeyEquals(key, handle.binder)) {
        return refuse("the new admin is the binder key. The admin is its own key.");
      }
      return pubkeyEquals(handle.pendingAdmin, key)
        ? nothing(`${pubkeyToBase58(key)} is already pending.`)
        : { result: "send" };
    }
    case "set-relayer": {
      if (handle === null) return refuse(NEEDS_MIGRATION);
      const key = action.relayer;
      if (pubkeyEquals(key, DEFAULT_PUBKEY)) {
        return refuse("the relayer cannot be the zero key. The program would answer ZeroAddress.");
      }
      const reservedRelayer = reservedRefusal(key, "relayer");
      if (reservedRelayer !== null) return reservedRelayer;
      // One key, one power. The program does not check this; we do.
      if (pubkeyEquals(key, config.admin)) {
        return refuse("the relayer is the admin key. The relayer is its own key.");
      }
      if (pubkeyEquals(key, handle.binder)) {
        return refuse("the relayer is the binder key. The relayer is its own key.");
      }
      return pubkeyEquals(config.relayer, key)
        ? nothing(`the relayer is already ${pubkeyToBase58(key)}.`)
        : { result: "send" };
    }
    case "set-guardian": {
      if (handle === null) return refuse(NEEDS_MIGRATION);
      const key = action.guardian;
      // Zero clears the guardian. Any other key is its own.
      if (!pubkeyEquals(key, DEFAULT_PUBKEY)) {
        const reservedGuardian = reservedRefusal(key, "guardian");
        if (reservedGuardian !== null) return reservedGuardian;
        if (pubkeyEquals(key, config.admin)) {
          return refuse("the guardian is the admin key. The guardian is its own key.");
        }
        if (pubkeyEquals(key, config.relayer)) {
          return refuse("the guardian is the relayer key. The guardian is its own key.");
        }
        if (pubkeyEquals(key, handle.binder)) {
          return refuse("the guardian is the binder key. The guardian is its own key.");
        }
      }
      if (pubkeyEquals(handle.guardian, key)) {
        return nothing(
          pubkeyEquals(key, DEFAULT_PUBKEY)
            ? "no guardian is set, nothing to clear."
            : `the guardian is already ${pubkeyToBase58(key)}.`,
        );
      }
      return { result: "send" };
    }
  }
}

/** The handle fields, with zero for a 116 byte `Config`. */
const handleOf = (config: ConfigAccount): ConfigHandleFields =>
  config.handle ?? {
    binder: DEFAULT_PUBKEY,
    binderRevoked: false,
    guardian: DEFAULT_PUBKEY,
    minFeeLamports: 0n,
    minFeePerReceiverLamports: 0n,
    maxFeeLamports: 0n,
    pendingAdmin: DEFAULT_PUBKEY,
  };

/**
 * After a confirmed send: what is wrong in the `Config` read back. Empty means the change is
 * there and nothing else moved. The fields the action may change are left out of the "moved"
 * check; every other field must equal its value before.
 */
export function checkReadBack(
  action: AdminAction,
  before: ConfigAccount,
  after: ConfigAccount,
): string[] {
  const problems: string[] = [];
  const keyMoved = (name: string, a: Pubkey, b: Pubkey) => {
    if (!pubkeyEquals(a, b))
      problems.push(`${name} changed, ${pubkeyToBase58(a)} -> ${pubkeyToBase58(b)}`);
  };
  const valueMoved = (name: string, a: unknown, b: unknown) => {
    if (a !== b) problems.push(`${name} changed, ${String(a)} -> ${String(b)}`);
  };

  // The old fields: no admin call here touches them, except `paused` for set-paused and
  // guardian-pause, `admin` for accept-admin and `relayer` for set-relayer.
  if (action.kind === "accept-admin") {
    const was = handleOf(before).pendingAdmin;
    if (!pubkeyEquals(after.admin, was)) {
      problems.push(`admin is ${pubkeyToBase58(after.admin)}, not ${pubkeyToBase58(was)}`);
    }
  } else {
    keyMoved("admin", before.admin, after.admin);
  }
  if (action.kind === "set-relayer") {
    if (!pubkeyEquals(after.relayer, action.relayer)) {
      problems.push(`relayer is ${pubkeyToBase58(after.relayer)}, not the new key`);
    }
  } else {
    keyMoved("relayer", before.relayer, after.relayer);
  }
  keyMoved("fee wallet", before.feeWallet, after.feeWallet);
  valueMoved("default fee bps", before.defaultFeeBps, after.defaultFeeBps);
  valueMoved("chain id", before.chainId, after.chainId);
  valueMoved("bump", before.bump, after.bump);
  if (action.kind !== "set-paused" && action.kind !== "guardian-pause") {
    valueMoved("paused", before.paused, after.paused);
  }

  if (action.kind === "migrate-config") {
    const h = after.handle;
    if (h === null) {
      problems.push("Config is still 116 bytes");
      return problems;
    }
    if (!pubkeyEquals(h.binder, DEFAULT_PUBKEY)) problems.push("binder is not zero");
    if (h.binderRevoked) problems.push("binder_revoked is not false");
    if (!pubkeyEquals(h.guardian, DEFAULT_PUBKEY)) problems.push("guardian is not zero");
    if (h.minFeeLamports !== 0n) problems.push("min fee is not zero");
    return problems;
  }

  if (action.kind === "set-paused") {
    if (after.paused !== action.paused) problems.push(`paused is ${String(after.paused)}`);
  } else if (action.kind === "guardian-pause" && !after.paused) {
    problems.push("paused is not true");
  }
  if (action.kind !== "set-paused" && after.handle === null) {
    problems.push("Config is 116 bytes after the call");
    return problems;
  }

  const was = handleOf(before);
  const now = handleOf(after);
  const changes = {
    binder: action.kind === "set-binder",
    revoked: action.kind === "set-binder" || action.kind === "revoke-binder",
    minFee: action.kind === "set-min-fee",
    perReceiver: action.kind === "set-fee-per-receiver",
    maxFee: action.kind === "set-max-fee",
  };
  if (action.kind === "set-binder") {
    if (!pubkeyEquals(now.binder, action.binder)) problems.push("binder is not the new key");
    if (now.binderRevoked) problems.push("binder_revoked is still true");
  }
  if (action.kind === "set-min-fee" && now.minFeeLamports !== action.lamports) {
    problems.push(`min fee is ${String(now.minFeeLamports)}`);
  }
  if (action.kind === "set-fee-per-receiver" && now.minFeePerReceiverLamports !== action.lamports) {
    problems.push(`fee per receiver is ${String(now.minFeePerReceiverLamports)}`);
  }
  if (action.kind === "set-max-fee" && now.maxFeeLamports !== action.lamports) {
    problems.push(`max fee is ${String(now.maxFeeLamports)}`);
  }
  if (action.kind === "revoke-binder" && !now.binderRevoked) {
    problems.push("binder_revoked is not true");
  }
  if (action.kind === "propose-admin") {
    if (!pubkeyEquals(now.pendingAdmin, action.pendingAdmin)) {
      problems.push(`pending_admin is ${pubkeyToBase58(now.pendingAdmin)}`);
    }
  } else if (action.kind === "accept-admin") {
    if (!pubkeyEquals(now.pendingAdmin, DEFAULT_PUBKEY)) problems.push("pending_admin is not zero");
  } else {
    keyMoved("pending_admin", was.pendingAdmin, now.pendingAdmin);
  }
  if (!changes.binder) keyMoved("binder", was.binder, now.binder);
  if (!changes.revoked) valueMoved("binder_revoked", was.binderRevoked, now.binderRevoked);
  if (action.kind === "set-guardian") {
    if (!pubkeyEquals(now.guardian, action.guardian)) {
      problems.push(`guardian is ${pubkeyToBase58(now.guardian)}, not the new key`);
    }
  } else {
    keyMoved("guardian", was.guardian, now.guardian);
  }
  if (!changes.minFee) valueMoved("min fee", was.minFeeLamports, now.minFeeLamports);
  // Each moves only under its own setter.
  if (!changes.perReceiver) {
    valueMoved("fee per receiver", was.minFeePerReceiverLamports, now.minFeePerReceiverLamports);
  }
  if (!changes.maxFee) valueMoved("max fee", was.maxFeeLamports, now.maxFeeLamports);
  return problems;
}

/** One line for the script's `before` and `after`: public keys and numbers, never a secret. */
export function describeConfig(config: ConfigAccount): string {
  const h = config.handle;
  const head =
    `admin ${pubkeyToBase58(config.admin)}, relayer ${pubkeyToBase58(config.relayer)}, ` +
    `fee ${String(config.defaultFeeBps)} bps, paused ${String(config.paused)}`;
  if (h === null) return `${head}; 116 bytes, no handle fields`;
  return (
    `${head}; 253 bytes, binder ${pubkeyToBase58(h.binder)}, revoked ${String(h.binderRevoked)}, ` +
    `guardian ${pubkeyToBase58(h.guardian)}, min fee ${String(h.minFeeLamports)} lamports, ` +
    `fee per receiver ${String(h.minFeePerReceiverLamports)} lamports, ` +
    `max fee ${String(h.maxFeeLamports)} lamports, ` +
    `pending admin ${
      pubkeyEquals(h.pendingAdmin, DEFAULT_PUBKEY) ? "none" : pubkeyToBase58(h.pendingAdmin)
    }`
  );
}

export type SweepCheck =
  | { readonly result: "send"; readonly amount: bigint }
  | { readonly result: "nothing"; readonly reason: string }
  | { readonly result: "refuse"; readonly reason: string };

/**
 * before `sweep-sol` sends. `rentMinimum` is the cluster's rent minimum for the drop's
 * data length, read live, as the program reads its `Rent` sysvar.
 */
export function checkSweepSol(args: {
  readonly closed: boolean;
  readonly lamports: bigint;
  readonly rentMinimum: bigint;
}): SweepCheck {
  if (!args.closed) {
    return {
      result: "refuse",
      reason: "the drop is not closed. The program would answer NotClosed.",
    };
  }
  if (args.lamports <= args.rentMinimum) {
    return {
      result: "nothing",
      reason:
        `the drop holds ${String(args.lamports)} lamports, its rent minimum is ` +
        `${String(args.rentMinimum)}. The program would answer NothingToSweep.`,
    };
  }
  return { result: "send", amount: args.lamports - args.rentMinimum };
}

/**
 * after a confirmed `sweep-sol`: what is wrong, empty when right. The drop must hold
 * exactly its rent minimum and the refund recipient must have gained `amount`, less `fee` when
 * the signer is the refund recipient and paid the fee from it.
 */
export function checkSweepReadBack(args: {
  readonly amount: bigint;
  readonly rentMinimum: bigint;
  readonly dropAfter: bigint;
  readonly recipientBefore: bigint;
  readonly recipientAfter: bigint;
  readonly fee: bigint;
}): string[] {
  const problems: string[] = [];
  if (args.dropAfter !== args.rentMinimum) {
    problems.push(
      `the drop holds ${String(args.dropAfter)} lamports, not its rent minimum ` +
        `${String(args.rentMinimum)}`,
    );
  }
  const gained = args.recipientAfter - args.recipientBefore;
  const expected = args.amount - args.fee;
  if (gained !== expected) {
    problems.push(
      `the refund recipient gained ${String(gained)} lamports, not ${String(expected)}`,
    );
  }
  return problems;
}

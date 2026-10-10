/**
 * The EVM chain behind the `ChainAdapter` interface.
 *
 * A thin wrapper over the `ChainGateway` and the relayer that already existed. Nothing about the
 * EVM path changes: the relayer sends its fixed list of calls, seven since
 * the salt is still agreed with
 * the factory twice, `DropCreated` is still read back field by field. What moved here from
 * `drops/create.ts` is the part that only an EVM chain has — the salt and the CREATE2 prediction —
 * so the create flow could stop knowing about salts at all.
 *
 * `closeDrop` is refused: it is not a relayer call on the EVM, and the worker
 * reads `capabilities` before it asks. `refund` is allowed since, so
 * unclaimed money goes back by itself, and `cancelUnfunded` since, so money sent to
 * a drop that was never fully funded goes back too.
 */
import { explorerTxUrl, hasHandleContracts, type Chain } from "@dropchad/chains";
import { normalizeReceivers, type Receiver } from "@dropchad/shared";
import {
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import type {
  AdapterClaimItem,
  AdapterCreated,
  AdapterPrediction,
  ChainAdapter,
  ClaimBatchResult,
  DropOnChain,
  FundingInstructions,
  TxResult,
} from "../adapter.js";
import { UnsupportedOnChainError } from "../adapter.js";
import { decodeClaimed, decodeHandleClaimed, type ChainGateway } from "../gateway.js";
import { computeSalt, predictDropAddress } from "../predict.js";

/** Off chain and on chain disagreed about the address. Something is very wrong; nothing is created. */
export class PredictionMismatchError extends Error {
  constructor(what: string, ours: string, theirs: string) {
    super(`${what} mismatch: we computed ${ours}, the factory says ${theirs}`);
    this.name = "PredictionMismatchError";
  }
}

/** The event named a salt other than the one we computed. Only the EVM has a salt to check. */
export class SaltMismatchError extends Error {
  constructor(sent: Hex, emitted: Hex) {
    super(`DropCreated.salt is ${emitted}, we sent ${sent}`);
    this.name = "SaltMismatchError";
  }
}

/** `MAX_BATCH` on `DropV1`. A batch of 21 reverts with `BadBatchSize`. */
export const MAX_BATCH = 20;

/** the gas numbers of, from api config. */
export interface EvmGasModel {
  readonly createDrop: bigint;
  readonly activate: bigint;
  readonly claimBatchBase: bigint;
  readonly perAddressClaim: bigint;
  readonly perHandleClaim: bigint;
  /** a Robinhood token drop: estimates from the local V3 gas report. */
  readonly tokenCreateDrop: bigint;
  readonly tokenActivate: bigint;
  readonly perTokenHandleClaim: bigint;
}

/** The config defaults, for callers that build an adapter without a config. */
export const DEFAULT_EVM_GAS: EvmGasModel = {
  createDrop: 360_000n,
  activate: 90_000n,
  claimBatchBase: 86_000n,
  perAddressClaim: 50_000n,
  perHandleClaim: 130_000n,
  tokenCreateDrop: 400_000n,
  tokenActivate: 130_000n,
  perTokenHandleClaim: 160_000n,
};

export interface EvmAdapterOptions {
  readonly gateway: ChainGateway;
  /** The registry entry, for the key, the name, the symbol and the explorer. */
  readonly chain: Chain;
  readonly gas?: EvmGasModel;
}

export function createEvmAdapter(options: EvmAdapterOptions): ChainAdapter {
  const { gateway, chain } = options;
  const gas = options.gas ?? DEFAULT_EVM_GAS;
  const salts = new Map<string, Hex>();

  const parseAddress = (text: string): Address => {
    if (!isAddress(text, { strict: false })) throw new Error(`not a 0x address: ${text}`);
    return getAddress(text);
  };

  return {
    family: "evm",
    chainKey: chain.key,
    chainId: gateway.chainId,
    chainName: chain.name,
    nativeSymbol: chain.nativeSymbol,
    decimals: 18,
    relayerAddress: gateway.relayerAddress,
    nativeAsset: zeroAddress,
    // `refund` since, `cancelUnfunded` since
    // money left in a drop goes back by itself.
    capabilities: { refund: true, cancelUnfunded: true, close: false, handleClaims: true },

    parseAddress,

    normalizeReceivers: (receivers): Receiver<string>[] =>
      normalizeReceivers(
        receivers.map((r) => ({ recipient: parseAddress(r.recipient), amount: r.amount })),
      ),

    defaultFeeBps: () => gateway.defaultFeeBps(),
    minFee: () => gateway.minFeeAmount(),
    /** The V4 fields read zero before `DropFactoryV4`, so the V3 fee stays. */
    async feeConfig() {
      const [bps, minFee, minFeePerReceiver, maxFee] = await Promise.all([
        gateway.defaultFeeBps(),
        gateway.minFeeAmount(),
        gateway.minFeePerReceiver(),
        gateway.maxFeeAmount(),
      ]);
      return { bps, minFee, minFeePerReceiver, maxFee };
    },
    bindingDigest: (drop, index, xId, recipient) =>
      gateway.bindingDigest(getAddress(drop), index, xId, getAddress(recipient)),

    /** `claimBatch` of up to `MAX_BATCH` for address leaves, one `claimHandle` a handle. */
    async estimateRelayerCost({ addressLeaves, handleLeaves, token }) {
      const batches = BigInt(Math.ceil(addressLeaves / MAX_BATCH));
      // a token drop is handle mode only, with its own numbers.
      const units =
        token === true
          ? gas.tokenCreateDrop + gas.tokenActivate + BigInt(handleLeaves) * gas.perTokenHandleClaim
          : gas.createDrop +
            gas.activate +
            batches * gas.claimBatchBase +
            BigInt(addressLeaves) * gas.perAddressClaim +
            BigInt(handleLeaves) * gas.perHandleClaim;
      const unitPrice = await gateway.gasPrice();
      return { cost: units * unitPrice, unitPrice };
    },
    // False until the V2 set is recorded; from then the gateway is on
    // `DropFactoryV2` too, `evmFactoryFor`.
    handleModeReady: () => Promise.resolve(hasHandleContracts(chain)),

    /**
     * Steps 3 to 5 of the create flow: the salt off chain, `saltUsed` on the factory, and the
     * CREATE2 address agreed with the factory's own `predictDrop`. The salt is remembered per
     * commitment and nonce so `createDrop` can check it against the event.
     */
    async predictDrop(creatorCommitment, nonce) {
      const salt = computeSalt({
        chainId: gateway.chainId,
        factory: gateway.factory,
        creator: gateway.relayerAddress,
        creatorCommitment,
        nonce,
      });
      salts.set(`${creatorCommitment}:${nonce.toString()}`, salt);
      const predicted = predictDropAddress({
        factory: gateway.factory,
        implementation: gateway.implementation,
        salt,
      });
      // A used salt means that address is taken and the nonce has to move on.
      if (await gateway.saltUsed(salt)) return { address: predicted, taken: true };

      const factorySays = await gateway.predictDrop(creatorCommitment, nonce);
      if (getAddress(factorySays) !== predicted) {
        throw new PredictionMismatchError("drop address", predicted, getAddress(factorySays));
      }
      return { address: predicted, taken: false } satisfies AdapterPrediction;
    },

    async createDrop(params) {
      const salt = salts.get(`${params.creatorCommitment}:${params.nonce.toString()}`);
      if (salt === undefined)
        throw new Error("createDrop called before predictDrop for this nonce");

      const token = params.token;
      if (token !== undefined && gateway.version < 3) {
        throw new Error(`${chain.key} has no token drops before DropFactoryV3`);
      }
      const { result, event, nativeFee } = await gateway.createDrop({
        // Native ETH, or since V3 an allowed token.
        asset: token === undefined ? zeroAddress : getAddress(token.mint),
        merkleRoot: params.merkleRoot,
        manifestHash: params.manifestHash,
        totalEntitlements: params.totalEntitlements,
        leafCount: params.leafCount,
        refundRecipient: getAddress(params.refundRecipient),
        creatorCommitment: params.creatorCommitment,
        nonce: params.nonce,
        fundingPeriod: params.fundingPeriod,
        claimPeriod: params.claimPeriod,
        tokenFactory: zeroAddress,
        ...(token === undefined ? {} : { nativeFee: token.solFeeLamports }),
      });

      if (event.salt.toLowerCase() !== salt.toLowerCase()) {
        throw new SaltMismatchError(salt, event.salt);
      }

      return {
        txId: result.hash,
        drop: getAddress(event.drop),
        asset: getAddress(event.asset),
        merkleRoot: event.merkleRoot,
        manifestHash: event.manifestHash,
        totalEntitlements: event.totalEntitlements,
        leafCount: event.leafCount,
        refundRecipient: getAddress(event.refundRecipient),
        feeAmount: event.feeAmount,
        grossRequired: event.grossRequired,
        fundingDeadline: event.fundingDeadline,
        claimPeriod: event.claimPeriod,
        salt,
        // the drop itself holds the tokens; the ETH fee is `NativeFeeSet`.
        ...(token === undefined
          ? {}
          : {
              vault: getAddress(event.drop),
              solFeeLamports: nativeFee ?? -1n,
              accountBudgetLamports: 0n,
            }),
      } satisfies AdapterCreated;
    },

    /** The clone's whole balance is spendable: there is no rent on an EVM chain. */
    getSpendableBalance: (drop) => gateway.getBalance(getAddress(drop)),

    /**
     * `activate`'s own check read from the drop and the chain: a token drop needs the
     * token `>= grossRequired` and ETH `>= nativeFee`; a native drop ETH `>= grossRequired`.
     */
    async fundingStatus(drop) {
      const address = getAddress(drop);
      const [asset, grossRequired, eth] = await Promise.all([
        gateway.dropAsset(address),
        gateway.grossRequired(address),
        gateway.getBalance(address),
      ]);
      if (asset === zeroAddress) {
        return { funded: eth >= grossRequired, lamports: eth, tokenAmount: null };
      }
      const [tokenAmount, nativeFee] = await Promise.all([
        gateway.tokenBalance(asset, address),
        gateway.nativeFee(address),
      ]);
      return {
        funded: tokenAmount >= grossRequired && eth >= nativeFee,
        lamports: eth,
        tokenAmount,
      };
    },

    /** any ETH, or any of the drop's token. */
    async holdsAnything(drop) {
      const address = getAddress(drop);
      const [asset, eth] = await Promise.all([
        gateway.dropAsset(address),
        gateway.getBalance(address),
      ]);
      if (eth > 0n) return true;
      if (asset === zeroAddress) return false;
      return (await gateway.tokenBalance(asset, address)) > 0n;
    },

    async readDrop(drop): Promise<DropOnChain> {
      const address = getAddress(drop);
      const [status, claimDeadline, fundingDeadline] = await Promise.all([
        gateway.dropStatus(address),
        gateway.claimDeadline(address),
        gateway.fundingDeadline(address),
      ]);
      // The gateway has no `totalClaimed` or `claimedCount` reads and the worker never needed
      // them on this chain: those numbers come from our row and the indexer.
      return {
        status,
        claimDeadline,
        fundingDeadline,
        totalClaimed: 0n,
        claimedCount: 0,
        closed: false,
      };
    },

    async readClaimed(drop, indexes) {
      const address = getAddress(drop);
      const claimed = new Set<number>();
      // One `isClaimed` call per leaf, as before. The cursor in `drops.next_claim_index` keeps
      // this to one visit per leaf.
      for (const index of indexes) {
        if (await gateway.isClaimed(address, BigInt(index))) claimed.add(index);
      }
      return claimed;
    },

    claimsPerTx: () => MAX_BATCH,

    async activate(drop): Promise<TxResult> {
      const result = await gateway.activate(getAddress(drop));
      return { txId: result.hash, cost: result.costWei };
    },

    async claimBatch(drop, items: readonly AdapterClaimItem[]): Promise<ClaimBatchResult> {
      const address = getAddress(drop);
      const result = await gateway.claimBatch(
        address,
        items.map((item) => ({
          index: BigInt(item.index),
          recipient: getAddress(item.recipient),
          amount: item.amount,
          proof: item.proof,
        })),
      );
      // Progress comes out of the receipt, never out of what we asked for.
      const paid = decodeClaimed(result.receipt, address).map((claim) => ({
        index: claim.index,
        recipient: claim.recipient,
        amount: claim.amount,
      }));
      return { txId: result.hash, cost: result.costWei, paid };
    },

    /** the fifth relayer call. What was paid comes out of the receipt. */
    async claimHandle(drop, item) {
      const address = getAddress(drop);
      const result = await gateway.claimHandle(address, {
        index: BigInt(item.index),
        xId: item.xId,
        amount: item.amount,
        recipient: getAddress(item.recipient),
        proof: item.proof,
        signature: item.signature,
      });
      const [event] = decodeHandleClaimed(result.receipt, address);
      return {
        txId: result.hash,
        cost: result.costWei,
        paid:
          event === undefined
            ? null
            : { index: event.index, recipient: event.recipient, amount: event.amount },
      };
    },

    binderLive: () => gateway.binderLive(),
    liveBinder: () => gateway.liveBinder(),

    /** The `settle` job sends it after the claim deadline, once. */
    async refund(drop): Promise<TxResult> {
      const result = await gateway.refund(getAddress(drop));
      return { txId: result.hash, cost: result.costWei };
    },
    /** The `settle` job sends it after the funding deadline, once. */
    async cancelUnfunded(drop): Promise<TxResult> {
      const result = await gateway.cancelUnfunded(getAddress(drop));
      return { txId: result.hash, cost: result.costWei };
    },
    closeDrop: () => Promise.reject(new UnsupportedOnChainError(chain.key, "closeDrop")),

    /**
     * EIP 681, chain id pinned so a wallet on the wrong chain cannot silently send on it. A token
     * drop: `amount` is the ETH fee, and the token part is an ERC20 `transfer` to
     * the same drop address.
     */
    fundingInstructions({ drop, amount, fundingDeadline, token }): FundingInstructions {
      const address = getAddress(drop);
      const display = formatEther(amount);
      const chainId = String(gateway.chainId);
      return {
        ...(token === undefined
          ? {}
          : {
              token: {
                mint: getAddress(token.mint),
                vault: address,
                tokenProgram: token.tokenProgram,
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                amountBaseUnits: token.amount.toString(),
                amountDisplay: formatUnits(token.amount, token.decimals),
                paymentUri: `ethereum:${getAddress(token.mint)}@${chainId}/transfer?address=${address}&uint256=${token.amount.toString()}`,
              },
            }),
        family: "evm",
        address,
        chainId: gateway.chainId,
        asset: "native",
        symbol: chain.nativeSymbol,
        decimals: 18,
        amountBaseUnits: amount.toString(),
        amountDisplay: display,
        paymentUri: `ethereum:${address}@${String(gateway.chainId)}?value=${amount.toString()}`,
        fundingDeadline: fundingDeadline.toString(),
        amountWei: amount.toString(),
        amountEth: display,
      };
    },

    txUrl: (txId) => explorerTxUrl(chain, txId),
    // token drops only once `DropFactoryV3` creates the drops. The drop holds the tokens
    // itself, and an EVM chain has no account rent.
    ...(gateway.version >= 3
      ? {
          tokenVault: (drop: string) => getAddress(drop),
          tokenAccountRent: () => Promise.resolve(0n),
        }
      : {}),
  };
}

/**
 * The claim wallet kept in this browser only, `localStorage`, one for EVM
 * and one for Solana. Saved when the api takes the claim's address; the next claim's wallet
 * field starts with it, and the visitor can change it. Never sent anywhere for this.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClaimView } from "@/components/drops/ClaimView";
import type { ClaimItem } from "@/components/drops/claim";
import {
  CLAIM_WALLET_KEY,
  readClaimWallet,
  saveClaimWallet,
} from "@/components/drops/kept-address";

const SRC = join(__dirname, "..", "src");
const EVM_WALLET = "0x1111111111111111111111111111111111110001";
const SOL_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const EVM_DROP = "0x00000000000000000000000000000000000d0b01";
const SOL_DROP = "So1anaDrop111111111111111111111111111111111";

/** A plain `localStorage` stand in, on a stand in `window`. */
function fakeStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kept in this browser only", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = fakeStorage();
  });

  it("one key for EVM and one for Solana", () => {
    expect(CLAIM_WALLET_KEY.evm).not.toBe(CLAIM_WALLET_KEY.svm);
    saveClaimWallet("evm", EVM_WALLET);
    saveClaimWallet("svm", SOL_WALLET);
    expect(store.get(CLAIM_WALLET_KEY.evm)).toBe(EVM_WALLET);
    expect(store.get(CLAIM_WALLET_KEY.svm)).toBe(SOL_WALLET);
    expect(readClaimWallet("evm")).toBe(EVM_WALLET);
    expect(readClaimWallet("svm")).toBe(SOL_WALLET);
  });

  it("the last one of each wins; spaces around are dropped", () => {
    saveClaimWallet("evm", EVM_WALLET);
    saveClaimWallet("evm", ` ${EVM_WALLET.replace(/1$/, "2")} `);
    expect(readClaimWallet("evm")).toBe(EVM_WALLET.replace(/1$/, "2"));
  });

  it("never keeps or gives back a value that is not an address of that family", () => {
    saveClaimWallet("evm", SOL_WALLET);
    saveClaimWallet("svm", "not a wallet");
    expect(store.size).toBe(0);
    store.set(CLAIM_WALLET_KEY.evm, "junk");
    store.set(CLAIM_WALLET_KEY.svm, EVM_WALLET);
    expect(readClaimWallet("evm")).toBe("");
    expect(readClaimWallet("svm")).toBe("");
  });

  it("nothing kept: empty", () => {
    expect(readClaimWallet("evm")).toBe("");
  });
});

describe("storage that cannot be used", () => {
  it("no window (the server HTML): empty, and a save does nothing", () => {
    expect(readClaimWallet("evm")).toBe("");
    expect(() => saveClaimWallet("evm", EVM_WALLET)).not.toThrow();
  });

  it("storage that throws: empty, never an error", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("window", { localStorage: broken });
    vi.stubGlobal("localStorage", broken);
    expect(readClaimWallet("svm")).toBe("");
    expect(() => saveClaimWallet("svm", SOL_WALLET)).not.toThrow();
  });
});

describe("the claim page fills the wallet field", () => {
  const item = (patch: Partial<ClaimItem> = {}): ClaimItem => ({
    drop: EVM_DROP,
    chainKey: "robinhood-testnet",
    chainId: 46630,
    title: null,
    sender: { handle: "sender", displayName: "the sender", profileImageUrl: null },
    amount: "500000000000000000",
    symbol: "ETH",
    decimals: 18,
    index: 0,
    claimDeadline: "1791806400",
    state: "claimable",
    recipient: null,
    claimTxHash: null,
    ...patch,
  });
  const page = (claim: ClaimItem) =>
    renderToStaticMarkup(
      <ClaimView
        session={{ handle: "alice" }}
        claims={[claim]}
        freshLoginSecondsLeft={600}
        selected={claim.drop}
      />,
    );
  const field = (html: string) => /<input[^>]*id="claim-address"[^>]*>/.exec(html)?.[0] ?? "";

  beforeEach(() => {
    const store = fakeStorage();
    store.set(CLAIM_WALLET_KEY.evm, EVM_WALLET);
    store.set(CLAIM_WALLET_KEY.svm, SOL_WALLET);
  });

  it("a Robinhood drop: the kept EVM wallet, still an input to change", () => {
    const input = field(page(item()));
    expect(input).toContain(`value="${EVM_WALLET}"`);
    // The attributes, not the `disabled:` style names in the class.
    expect(input).not.toMatch(/\sreadonly(=|\s|>)/i);
    expect(input).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("a Solana drop: the kept Solana wallet", () => {
    const html = page(item({ drop: SOL_DROP, chainKey: "solana-devnet", chainId: 103 }));
    expect(field(html)).toContain(`value="${SOL_WALLET}"`);
  });

  it("nothing kept: the field stays empty, no new text", () => {
    vi.unstubAllGlobals();
    fakeStorage();
    const input = field(page(item()));
    expect(input).toContain('value=""');
  });
});

describe("where it is saved", () => {
  it("the claim page keeps the address only after the api took it", () => {
    const src = readFileSync(join(SRC, "components", "drops", "ClaimView.tsx"), "utf8");
    expect(src).toMatch(/if \(result\.ok\) \{\s*saveClaimWallet\(family, recipient\);/);
    expect(src).toContain("readClaimWallet(family)");
  });

  it("the module only talks to localStorage, never to the api or a cookie", () => {
    const src = readFileSync(join(SRC, "components", "drops", "kept-address.ts"), "utf8");
    expect(src).toContain("localStorage");
    expect(src).not.toMatch(/fetch\(|@\/lib\/api|document\.cookie|sessionStorage/);
  });
});

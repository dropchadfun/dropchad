/**
 * -2, the fetch with limits .
 *
 * - `https:` on port 443 only, no user or password. `ipfs://<path>` becomes
 *   `https://ipfs.io/ipfs/<path>`, one fixed gateway, then the same checks.
 * - The name is resolved here; every address must be public; the connection goes to exactly
 *   the address that was checked, no second lookup.
 * - At most 3 redirects, each hop checked again. No cookies. A compressed answer is refused.
 * - The byte limit is counted as the bytes arrive, whatever `Content-Length` says.
 * - The caller's signal stops everything, the 5 seconds of the logo.
 *
 * No socket is opened: `test/fake-web.ts` stands in for DNS and HTTPS.
 */
import { describe, expect, it } from "vitest";

import {
  createSafeFetch,
  isPublicAddress,
  normaliseLink,
  pinnedLookup,
  SafeFetchError,
} from "../src/net/safe-fetch.js";
import { fakeWeb, padTo, PNG } from "./fake-web.js";

const PUBLIC = "93.184.216.34";
const PUBLIC_6 = "2606:4700:4700::1111";
const MB = 1024 * 1024;

function setup() {
  const web = fakeWeb();
  const safeFetch = createSafeFetch(web.deps);
  const get = (link: string, maxBytes = MB, signal = new AbortController().signal) =>
    safeFetch(link, { maxBytes, signal });
  return { web, get };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SafeFetchError) return error.code;
    throw error;
  }
  throw new Error("expected a SafeFetchError, it resolved");
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// --- the link ----------------------------------------------------------------------------------

describe("the link, before any lookup", () => {
  it("ipfs:// becomes the one fixed gateway, https://ipfs.io/ipfs/", () => {
    expect(normaliseLink("ipfs://QmNnswE3ms7rLmUyg2knMZcowkVvxeLnaPE7M7cGRYRBt5").href).toBe(
      "https://ipfs.io/ipfs/QmNnswE3ms7rLmUyg2knMZcowkVvxeLnaPE7M7cGRYRBt5",
    );
    expect(normaliseLink("ipfs://QmDir/logo.png").href).toBe("https://ipfs.io/ipfs/QmDir/logo.png");
    expect(normaliseLink("https://example.com/a.json").href).toBe("https://example.com/a.json");
  });

  it("any other scheme is refused, with no lookup and no connection", async () => {
    const { web, get } = setup();
    for (const link of [
      "http://example.com/a.png",
      "ftp://example.com/a.png",
      "file:///etc/passwd",
      "data:image/png;base64,iVBORw0KGgo=",
      "javascript:alert(1)",
      "ws://example.com/",
      "ipns://example.com/",
    ]) {
      expect(await codeOf(get(link))).toBe("bad_scheme");
    }
    expect(await codeOf(get("not a link"))).toBe("bad_url");
    expect(await codeOf(get(""))).toBe("bad_url");
    expect(web.log.resolves).toEqual([]);
    expect(web.log.connects).toEqual([]);
  });

  it("port 443 only; a user or a password in the link is refused", async () => {
    const { web, get } = setup();
    expect(await codeOf(get("https://example.com:8443/a.png"))).toBe("bad_port");
    expect(await codeOf(get("https://example.com:80/a.png"))).toBe("bad_port");
    expect(await codeOf(get("https://user:pw@example.com/a.png"))).toBe("credentials");
    expect(await codeOf(get("https://user@example.com/a.png"))).toBe("credentials");
    expect(web.log.resolves).toEqual([]);
    expect(web.log.connects).toEqual([]);

    // `:443` written out is the same link.
    web.host("example.com", PUBLIC);
    web.page("https://example.com/a.png", { body: PNG });
    expect((await get("https://example.com:443/a.png")).bytes).toEqual(PNG);
  });
});

// --- the addresses -----------------------------------------------------------------------------

describe("public addresses only", () => {
  it("refuses loopback, private, link local, CGNAT, multicast, reserved and IPv4 inside IPv6", () => {
    for (const address of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "100.127.255.254",
      "127.0.0.1",
      "127.5.5.5",
      "169.254.169.254",
      "169.254.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:7f00:1",
      "::ffff:93.184.216.34",
      "64:ff9b::7f00:1",
      "2001:db8::1",
      "2002:7f00:1::1",
      "100::1",
      "not an address",
      "",
    ]) {
      expect([address, isPublicAddress(address)]).toEqual([address, false]);
    }
  });

  it("allows real public addresses, the edges of the private ranges included", () => {
    for (const address of [
      PUBLIC,
      "1.1.1.1",
      "8.8.8.8",
      "9.255.255.255",
      "11.0.0.1",
      "100.63.255.255",
      "100.128.0.1",
      "172.15.255.255",
      "172.32.0.1",
      "192.167.255.255",
      "192.169.0.1",
      PUBLIC_6,
      "2a00:1450:4001::200e",
    ]) {
      expect([address, isPublicAddress(address)]).toEqual([address, true]);
    }
  });

  it("a name that resolves to a private address: refused, no connection", async () => {
    const { web, get } = setup();
    web.host("evil.example", "169.254.169.254");
    expect(await codeOf(get("https://evil.example/latest/meta-data/"))).toBe("private_address");
    expect(web.log.connects).toEqual([]);
  });

  it("one good and one private address: refused, no connection", async () => {
    const { web, get } = setup();
    web.host("mixed.example", PUBLIC, "10.0.0.5");
    expect(await codeOf(get("https://mixed.example/a.png"))).toBe("private_address");
    web.host("mixed6.example", PUBLIC_6, "::1");
    expect(await codeOf(get("https://mixed6.example/a.png"))).toBe("private_address");
    expect(web.log.connects).toEqual([]);
  });

  it("an address written in the link is checked the same, with no lookup", async () => {
    const { web, get } = setup();
    for (const link of [
      "https://127.0.0.1/a.png",
      "https://[::1]/a.png",
      "https://[::ffff:127.0.0.1]/a.png",
      "https://2130706433/a.png", // the URL parser makes this 127.0.0.1
      "https://0x7f.1/a.png",
      "https://10.1/a.png",
      "https://192.168.0.1/a.png",
    ]) {
      expect([link, await codeOf(get(link))]).toEqual([link, "private_address"]);
    }
    expect(web.log.resolves).toEqual([]);
    expect(web.log.connects).toEqual([]);

    web.page(`https://${PUBLIC}/a.png`, { body: PNG });
    expect((await get(`https://${PUBLIC}/a.png`)).bytes).toEqual(PNG);
    expect(web.log.resolves).toEqual([]);
    expect(web.log.connects.map((c) => c.address)).toEqual([PUBLIC]);
  });

  it("a name that does not resolve: no_address", async () => {
    const { web, get } = setup();
    expect(await codeOf(get("https://nowhere.example/a.png"))).toBe("no_address");
    web.host("empty.example");
    expect(await codeOf(get("https://empty.example/a.png"))).toBe("no_address");
    expect(web.log.connects).toEqual([]);
  });

  it("connects to exactly the address it checked, one lookup, the name kept for TLS", async () => {
    const { web, get } = setup();
    web.host("cdn.example", PUBLIC);
    web.page("https://cdn.example/a.png", { body: PNG });
    const result = await get("https://cdn.example/a.png");
    expect(result.bytes).toEqual(PNG);
    expect(result.url.href).toBe("https://cdn.example/a.png");
    expect(web.log.resolves).toEqual(["cdn.example"]);
    expect(web.log.connects).toEqual([
      expect.objectContaining({ host: "cdn.example", address: PUBLIC }),
    ]);
  });

  it("sends no cookie and no authorization, and asks for no compression", async () => {
    const { web, get } = setup();
    web.host("cdn.example", PUBLIC);
    web.page("https://cdn.example/a.png", { body: PNG });
    await get("https://cdn.example/a.png");
    const headers = web.log.connects[0]?.headers ?? {};
    const names = Object.keys(headers).map((n) => n.toLowerCase());
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("authorization");
    expect(headers["accept-encoding"]).toBe("identity");
  });
});

describe("the real transport is pinned to the checked address", () => {
  it("pinnedLookup answers the checked address whatever name it is asked, both callback forms", () => {
    const lookup = pinnedLookup(PUBLIC, 4);
    const all: unknown[] = [];
    lookup("evil.example", { all: true }, (...args: unknown[]) => all.push(args));
    expect(all).toEqual([[null, [{ address: PUBLIC, family: 4 }]]]);
    const one: unknown[] = [];
    lookup("evil.example", {}, (...args: unknown[]) => one.push(args));
    expect(one).toEqual([[null, PUBLIC, 4]]);
  });
});

// --- redirects ---------------------------------------------------------------------------------

describe("redirects, at most 3, each hop checked again", () => {
  it("follows a good redirect to another host, and a relative one", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.host("b.example", "1.1.1.1");
    web.page("https://a.example/start", {
      status: 302,
      headers: { location: "https://b.example/next" },
    });
    web.page("https://b.example/next", { status: 301, headers: { location: "/img.png" } });
    web.page("https://b.example/img.png", { body: PNG });
    const result = await get("https://a.example/start");
    expect(result.bytes).toEqual(PNG);
    expect(result.url.href).toBe("https://b.example/img.png");
    expect(web.log.connects.map((c) => [c.href, c.address])).toEqual([
      ["https://a.example/start", PUBLIC],
      ["https://b.example/next", "1.1.1.1"],
      ["https://b.example/img.png", "1.1.1.1"],
    ]);
  });

  it("each of 301, 302, 303, 307 and 308 is followed", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const { web, get } = setup();
      web.host("a.example", PUBLIC);
      web.page("https://a.example/1", { status, headers: { location: "https://a.example/2" } });
      web.page("https://a.example/2", { body: PNG });
      expect((await get("https://a.example/1")).bytes).toEqual(PNG);
    }
  });

  it("a redirect to http, to a private address or to a non 443 port is refused", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.host("inside.example", "10.0.0.7");
    web.page("https://a.example/http", {
      status: 302,
      headers: { location: "http://a.example/img.png" },
    });
    web.page("https://a.example/inside", {
      status: 302,
      headers: { location: "https://inside.example/admin" },
    });
    web.page("https://a.example/literal", {
      status: 307,
      headers: { location: "https://127.0.0.1/admin" },
    });
    web.page("https://a.example/port", {
      status: 302,
      headers: { location: "https://a.example:6379/" },
    });
    expect(await codeOf(get("https://a.example/http"))).toBe("bad_scheme");
    expect(await codeOf(get("https://a.example/inside"))).toBe("private_address");
    expect(await codeOf(get("https://a.example/literal"))).toBe("private_address");
    expect(await codeOf(get("https://a.example/port"))).toBe("bad_port");
    // Only the first hop of each was ever connected.
    expect(web.log.connects.map((c) => c.host)).toEqual([
      "a.example",
      "a.example",
      "a.example",
      "a.example",
    ]);
  });

  it("a name that turns private on a later hop is caught: every hop is looked up and checked", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.page("https://a.example/1", {
      status: 302,
      headers: { location: "https://rebind.example/2" },
    });
    web.host("rebind.example", "127.0.0.1");
    expect(await codeOf(get("https://a.example/1"))).toBe("private_address");
    expect(web.log.connects).toHaveLength(1);
  });

  it("a redirect to ipfs:// goes to the fixed gateway", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.host("ipfs.io", "1.1.1.1");
    web.page("https://a.example/1", { status: 302, headers: { location: "ipfs://QmImg" } });
    web.page("https://ipfs.io/ipfs/QmImg", { body: PNG });
    expect((await get("https://a.example/1")).url.href).toBe("https://ipfs.io/ipfs/QmImg");
  });

  it("3 redirects are fine, a 4th is refused", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    for (let i = 1; i <= 4; i += 1) {
      web.page(`https://a.example/${i}`, {
        status: 302,
        headers: { location: `https://a.example/${i + 1}` },
      });
    }
    web.page("https://a.example/5", { body: PNG });
    expect((await get("https://a.example/2")).bytes).toEqual(PNG); // 2 -> 3 -> 4 -> 5
    const before = web.log.connects.length;
    expect(await codeOf(get("https://a.example/1"))).toBe("too_many_redirects");
    expect(web.log.connects.length - before).toBe(4);
  });

  it("a redirect with no location is a bad status", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.page("https://a.example/1", { status: 302 });
    expect(await codeOf(get("https://a.example/1"))).toBe("bad_status");
  });
});

// --- status, size, encoding --------------------------------------------------------------------

describe("status, size and encoding", () => {
  it("only 200 is an answer", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    for (const status of [204, 404, 500, 403, 304]) {
      web.page(`https://a.example/${status}`, { status, body: PNG });
      expect(await codeOf(get(`https://a.example/${status}`))).toBe("bad_status");
    }
  });

  it("a body up to the limit comes back whole, chunks joined", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.page("https://a.example/exact", { body: padTo(PNG, MB) });
    expect((await get("https://a.example/exact")).bytes).toHaveLength(MB);
    web.page("https://a.example/chunks", { body: [PNG.subarray(0, 4), PNG.subarray(4)] });
    expect((await get("https://a.example/chunks")).bytes).toEqual(PNG);
  });

  it("a Content-Length over the limit is refused before any byte is read", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.page("https://a.example/big", {
      headers: { "content-length": String(MB + 1) },
      endless: true,
    });
    expect(await codeOf(get("https://a.example/big"))).toBe("too_large");
    expect(web.log.chunksRead).toBe(0);
    expect(web.log.destroyed).toBe(1);
  });

  it("an endless body with no length stops just past the limit and closes", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.page("https://a.example/endless", { endless: true });
    expect(await codeOf(get("https://a.example/endless"))).toBe("too_large");
    expect(web.log.chunksRead).toBeLessThanOrEqual(17); // 1 MB is 16 chunks of 64 KB
    expect(web.log.destroyed).toBe(1);
  });

  it("a Content-Length that lies small does not help", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    web.page("https://a.example/liar", {
      headers: { "content-length": "100" },
      body: padTo(PNG, 200),
    });
    expect(await codeOf(get("https://a.example/liar", 150))).toBe("too_large");
  });

  it("a compressed answer is refused; identity is fine", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    for (const [i, encoding] of ["gzip", "br", "deflate", "zstd", "gzip, identity"].entries()) {
      web.page(`https://a.example/encoded-${i}`, {
        headers: { "content-encoding": encoding },
        body: PNG,
      });
      expect([encoding, await codeOf(get(`https://a.example/encoded-${i}`))]).toEqual([
        encoding,
        "compressed",
      ]);
    }
    web.page("https://a.example/identity", {
      headers: { "content-encoding": "identity" },
      body: PNG,
    });
    expect(text((await get("https://a.example/identity")).bytes)).toBe(text(PNG));
  });
});

// --- time --------------------------------------------------------------------------------------

describe("the caller's signal stops everything", () => {
  it("a server that never answers: timeout when the signal fires", async () => {
    const { web, get } = setup();
    web.host("slow.example", PUBLIC);
    web.page("https://slow.example/a.png", { hang: true });
    const started = Date.now();
    expect(await codeOf(get("https://slow.example/a.png", MB, AbortSignal.timeout(50)))).toBe(
      "timeout",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a body that stops coming: timeout, and the connection is closed", async () => {
    const { web, get } = setup();
    web.host("slow.example", PUBLIC);
    web.page("https://slow.example/a.png", { hangBody: true });
    expect(await codeOf(get("https://slow.example/a.png", MB, AbortSignal.timeout(50)))).toBe(
      "timeout",
    );
    expect(web.log.destroyed).toBe(1);
  });

  it("a signal already fired: timeout, no lookup, no connection", async () => {
    const { web, get } = setup();
    web.host("a.example", PUBLIC);
    const controller = new AbortController();
    controller.abort();
    expect(await codeOf(get("https://a.example/a.png", MB, controller.signal))).toBe("timeout");
    expect(web.log.resolves).toEqual([]);
    expect(web.log.connects).toEqual([]);
  });
});

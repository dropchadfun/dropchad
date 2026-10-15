/**
 * The api listens on `127.0.0.1` only. A local reverse proxy is the only way
 * in; before this the api listened on every address and only a firewall kept the port closed.
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { listenOptions } from "../src/listen.js";
import { TEST_ENV } from "./harness.js";

const base: NodeJS.ProcessEnv = { ...TEST_ENV };

describe("listen address", () => {
  it("defaults HOST to 127.0.0.1", () => {
    const { HOST, ...withoutHost } = base;
    expect(HOST).toBeUndefined();
    expect(loadConfig(withoutHost).HOST).toBe("127.0.0.1");
  });

  it("refuses an empty HOST", () => {
    expect(() => loadConfig({ ...base, HOST: "" })).toThrow(/HOST/);
  });

  it("passes the host and the port to serve", () => {
    const fetch = () => new Response("ok");
    expect(listenOptions({ HOST: "127.0.0.1", PORT: 4000 }, fetch)).toEqual({
      fetch,
      hostname: "127.0.0.1",
      port: 4000,
    });
  });

  it("really listens on 127.0.0.1, not on every address", async () => {
    const server = serve(listenOptions({ HOST: "127.0.0.1", PORT: 0 }, () => new Response("ok")));
    try {
      await new Promise<void>((resolve) => {
        if (server.listening) resolve();
        else server.once("listening", () => resolve());
      });
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("index.ts starts the server with listenOptions", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/index.ts"), "utf8");
    expect(source).toMatch(/serve\(\s*listenOptions\(config,/);
  });
});

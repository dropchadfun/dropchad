/**
 * Where the api listens: `127.0.0.1` by default, so a reverse proxy on
 * the same machine is the only way in. A firewall is the second layer, not the only one.
 */
import type { serve } from "@hono/node-server";

import type { Config } from "./config.js";

type ServeOptions = Parameters<typeof serve>[0];

export function listenOptions(
  config: Pick<Config, "HOST" | "PORT">,
  fetch: ServeOptions["fetch"],
): ServeOptions {
  return { fetch, hostname: config.HOST, port: config.PORT };
}

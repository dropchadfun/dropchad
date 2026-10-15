/**
 * `GET /api/dev/proof` — a dev only page for the testnet proof.
 *
 * It does what `scripts/create-testnet-drop.mjs` does, without copying cookies out of devtools:
 * the page is served from the api's own origin, so the browser sends `dc_session` by itself, and
 * the script reads `dc_csrf`, the one cookie that is not httpOnly, to echo it in the header.
 *
 * **Served only when `NODE_ENV` is `development` and the request host is `localhost`.** Anywhere
 * else it is the same `404 not_found` an unknown route gives, so a deployment does not even admit
 * the page exists.
 *
 * Plain HTML and one inline script. No framework, no build step, nothing shared with `apps/web`.
 * It shows no secret: the CSRF token is read and sent, never rendered.
 */
import { Hono } from "hono";

import type { AppEnv } from "../app.js";

/** Three addresses nobody has used, so their balance afterwards proves the payout. */
const TEST_RECEIVERS = [
  "0x1111111111111111111111111111111111110001",
  "0x2222222222222222222222222222222222220002",
  "0x3333333333333333333333333333333333330003",
] as const;

/** The testnet deployer. It holds the test ETH, so it is the natural refund address. */
const DEFAULT_REFUND = "0x4F1E2b8e5F1C0EB9e01f0d420F6Cf324d9de9E8B";

/** 0.0001 ETH per receiver, the same as the script. */
const AMOUNT_WEI = "100000000000000";

const RPC_URL = "https://rpc.testnet.chain.robinhood.com";

/** `localhost` only. `127.0.0.1` would not carry the login cookies anyway: they are host scoped. */
export function isLocalhost(url: string): boolean {
  return URL.parse(url)?.hostname === "localhost";
}

export function createDevRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/proof", (c) => {
    const { config } = c.var.deps;
    if (config.NODE_ENV !== "development" || !isLocalhost(c.req.url)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.html(PAGE);
  });

  return routes;
}

const RECEIVER_LINES = TEST_RECEIVERS.map((address) => `${address} ${AMOUNT_WEI}`).join("\n");

// The inline script below uses no template literals, so nothing in it collides with this one.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dropchad dev proof</title>
<style>
  body { background: #0B0B0D; color: #F5F5F7; font: 14px/1.5 system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 20px; }
  h2 { font-size: 16px; margin-top: 32px; }
  label { display: block; margin: 12px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #8A8A94; }
  input, textarea { width: 100%; box-sizing: border-box; background: #131317; color: #F5F5F7; border: 1px solid #2A2A32; border-radius: 8px; padding: 8px; font: 13px ui-monospace, Menlo, monospace; }
  textarea { height: 96px; }
  button { margin-top: 16px; background: #FFC61A; color: #0B0B0D; border: 0; border-radius: 8px; padding: 12px 24px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  pre { background: #131317; border: 1px solid #2A2A32; border-radius: 8px; padding: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
  a { color: #35E07E; }
  .dim { color: #8A8A94; }
  .err { color: #B04A4A; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<h1>dropchad dev proof</h1>
<p class="dim">Dev only. Creates one native drop on the testnet through this api, with the cookies this browser already holds.</p>

<h2>1. who is signed in</h2>
<pre id="me">reading /api/me ...</pre>

<h2>2. the drop</h2>
<label for="receivers">receivers, one per line: address amount_wei</label>
<textarea id="receivers">${RECEIVER_LINES}</textarea>
<label for="refund">refund address, a wallet you hold, never an exchange</label>
<input id="refund" value="${DEFAULT_REFUND}">
<label for="title">title, ours only, never on chain</label>
<input id="title" value="first api drop">
<br>
<button id="create">create drop</button>
<p id="status" class="dim"></p>

<div id="result" hidden>
<h2>3. response</h2>
<pre id="response"></pre>
</div>

<div id="after" hidden>
<h2>4. fund it</h2>
<p>drop address <code id="address"></code></p>
<p>PowerShell, from the deployer wallet. Close that shell afterwards.</p>
<pre id="cast"></pre>
<p>drop state: <a id="link" href="#" target="_blank"></a></p>

<h2>5. live</h2>
<pre id="log"></pre>
</div>

<script>
(function () {
  var RPC_URL = "${RPC_URL}";
  function $(id) { return document.getElementById(id); }

  function csrfToken() {
    var match = document.cookie.match(/(?:^|;\\s*)dc_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  fetch("/api/me", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (body) {
      if (!body.profile) {
        $("me").innerHTML = 'not signed in. <a href="/api/auth/x/start">sign in with X</a>, then come back here.';
        return;
      }
      $("me").textContent = JSON.stringify(body, null, 2);
    })
    .catch(function (e) { $("me").textContent = "could not read /api/me: " + e; });

  function parseReceivers(text) {
    var out = [];
    var lines = text.split(/\\r?\\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parts = line.split(/[\\s,]+/);
      if (parts.length !== 2) throw new Error("line " + (i + 1) + ': want "address amount", got "' + line + '"');
      out.push({ address: parts[0], amount: parts[1] });
    }
    return out;
  }

  function log(line) {
    $("log").textContent += new Date().toISOString().slice(11, 19) + "  " + line + "\\n";
  }

  function watch(address) {
    var path = "/api/drops/" + address + "/live";
    var source = new EventSource(path);
    var names = ["snapshot", "funding_seen", "activated", "claim_paid", "finished", "heartbeat"];
    names.forEach(function (name) {
      source.addEventListener(name, function (event) {
        log(name + "  " + event.data);
        if (name === "finished") { source.close(); log("stream closed"); }
      });
    });
    source.onopen = function () { log("connected to " + path); };
    source.onerror = function () { log("stream error, the browser reconnects by itself"); };
  }

  $("create").addEventListener("click", function () {
    var status = $("status");
    var button = $("create");
    status.className = "dim";

    var token = csrfToken();
    if (!token) { status.className = "err"; status.textContent = "no dc_csrf cookie. Sign in first."; return; }

    var receivers;
    try { receivers = parseReceivers($("receivers").value); }
    catch (e) { status.className = "err"; status.textContent = e.message; return; }

    var body = {
      asset: "native",
      receivers: receivers,
      refundRecipient: $("refund").value.trim(),
      title: $("title").value,
    };

    button.disabled = true;
    status.textContent = "posting to /api/drops. The relayer sends createDrop and waits for the receipt ...";

    fetch("/api/drops", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-dropchad-csrf": token },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().then(function (json) { return { status: r.status, json: json }; }); })
      .then(function (res) {
        $("result").hidden = false;
        $("response").textContent = "HTTP " + res.status + "\\n" + JSON.stringify(res.json, null, 2);
        if (res.status !== 201) {
          status.className = "err";
          status.textContent = "the api answered " + res.status + ", see the response";
          button.disabled = false;
          return;
        }
        status.textContent = "drop created";
        var address = res.json.drop.address;
        var amount = res.json.funding.amountWei;
        $("after").hidden = false;
        $("address").textContent = address;
        $("cast").textContent =
          '$env:DEPLOYER_KEY = "0x..."\\n' +
          "cast send " + address + " --value " + amount + " --rpc-url " + RPC_URL + " --private-key $env:DEPLOYER_KEY";
        var href = "/api/drops/" + address.toLowerCase();
        $("link").href = href;
        $("link").textContent = href;
        watch(address.toLowerCase());
      })
      .catch(function (e) {
        status.className = "err";
        status.textContent = "request failed: " + e;
        button.disabled = false;
      });
  });
})();
</script>
</body>
</html>
`;

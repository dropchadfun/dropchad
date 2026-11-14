#!/usr/bin/env node
/**
 * Generate `packages/shared/src/idl/dropchad.ts` from the Anchor build output.
 *
 * **The IDL is never hand copied**, the same rule as the ABIs. `contracts/solana/target/` is
 * gitignored build output, so the generated TypeScript is committed and this script produces it.
 * The api builds every Solana instruction from the discriminators and layouts in here, so a stale
 * IDL would mean sending bytes the program does not recognise.
 *
 *   node scripts/sync-idl.mjs           write the file
 *   node scripts/sync-idl.mjs --check   fail if the file is missing or stale
 *
 * Run `anchor build` first; `target/idl/dropchad.json` is what it writes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const idlPath = join(repoRoot, "contracts", "solana", "target", "idl", "dropchad.json");
const outDir = join(here, "..", "src", "idl");
const outFile = join(outDir, "dropchad.ts");

const check = process.argv.includes("--check");

async function readIdl() {
  let raw;
  try {
    raw = await readFile(idlPath, "utf8");
  } catch {
    throw new Error(
      `missing anchor idl: ${idlPath}\n` +
        `Run \`anchor build\` in contracts/solana first. target/ is gitignored, so a fresh clone\n` +
        `has to build the program before the IDL can be generated.`,
    );
  }
  const idl = JSON.parse(raw);
  if (typeof idl.address !== "string" || !Array.isArray(idl.instructions)) {
    throw new Error(`${idlPath} does not look like an anchor idl`);
  }
  return idl;
}

function render(idl) {
  return [
    "// GENERATED FILE — do not edit by hand.",
    "// Source: contracts/solana/target/idl/dropchad.json",
    "// Regenerate with: npm run sync:idl",
    "",
    `export const dropchadIdl = ${JSON.stringify(idl, null, 2)} as const;`,
    "",
  ].join("\n");
}

const rendered = render(await readIdl());

if (check) {
  let current = null;
  try {
    current = await readFile(outFile, "utf8");
  } catch {
    // missing counts as stale
  }
  if (current !== rendered) {
    console.error(`stale: ${outFile}\nRun \`npm run sync:idl\`.`);
    process.exit(1);
  }
  console.log("idl up to date");
} else {
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, rendered);
  console.log(`wrote ${outFile}`);
}

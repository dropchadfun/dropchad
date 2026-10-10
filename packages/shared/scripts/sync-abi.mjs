#!/usr/bin/env node
/**
 * Generate `packages/shared/src/abi/*.ts` from the foundry build output.
 *
 * **ABIs are never hand copied.** `contracts/evm/out/` is gitignored build output, so the
 * generated TypeScript is committed instead and this script is how it is produced.
 *
 *   node scripts/sync-abi.mjs           write the files
 *   node scripts/sync-abi.mjs --check   fail if a file is missing or stale
 *
 * `--check` is what CI runs. It catches the case where somebody edits a contract, rebuilds, and
 * forgets to re-run the sync, which would leave the indexer decoding events with an old ABI.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const foundryOut = join(repoRoot, "contracts", "evm", "out");
const abiDir = join(here, "..", "src", "abi");

/** contract name -> generated file name and exported const name. */
const CONTRACTS = [
  { contract: "DropV1", file: "drop-v1.ts", exportName: "dropV1Abi" },
  { contract: "DropFactoryV1", file: "drop-factory-v1.ts", exportName: "dropFactoryV1Abi" },
  { contract: "DropV2", file: "drop-v2.ts", exportName: "dropV2Abi" },
  { contract: "DropFactoryV2", file: "drop-factory-v2.ts", exportName: "dropFactoryV2Abi" },
  { contract: "BinderRegistry", file: "binder-registry.ts", exportName: "binderRegistryAbi" },
  { contract: "DropV3", file: "drop-v3.ts", exportName: "dropV3Abi" },
  { contract: "DropFactoryV3", file: "drop-factory-v3.ts", exportName: "dropFactoryV3Abi" },
  { contract: "DropFactoryV4", file: "drop-factory-v4.ts", exportName: "dropFactoryV4Abi" },
];

const check = process.argv.includes("--check");

/** Read `out/<Contract>.sol/<Contract>.json` and return its `abi` array. */
async function readArtifactAbi(contract) {
  const path = join(foundryOut, `${contract}.sol`, `${contract}.json`);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `missing foundry artifact: ${path}\n` +
        `Run \`forge build\` in contracts/evm first. contracts/evm/out is gitignored, so a fresh\n` +
        `clone has to build the contracts before the ABIs can be generated.`,
    );
  }
  const artifact = JSON.parse(raw);
  if (!Array.isArray(artifact.abi)) throw new Error(`${path} has no abi array`);
  return artifact.abi;
}

function render(exportName, contract, abi) {
  return [
    "// GENERATED FILE — do not edit by hand.",
    `// Source: contracts/evm/out/${contract}.sol/${contract}.json`,
    "// Regenerate with: npm run sync:abi",
    "",
    `export const ${exportName} = ${JSON.stringify(abi, null, 2)} as const;`,
    "",
  ].join("\n");
}

function renderIndex() {
  const lines = [
    "// GENERATED FILE — do not edit by hand.",
    "// Regenerate with: npm run sync:abi",
    "",
  ];
  for (const { file, exportName } of CONTRACTS) {
    lines.push(`export { ${exportName} } from "./${file.replace(/\.ts$/, ".js")}";`);
  }
  lines.push("");
  return lines.join("\n");
}

async function readIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(abiDir, { recursive: true });

  const wanted = new Map();
  for (const { contract, file, exportName } of CONTRACTS) {
    const abi = await readArtifactAbi(contract);
    wanted.set(file, render(exportName, contract, abi));
  }
  wanted.set("index.ts", renderIndex());

  const stale = [];
  for (const [file, contents] of wanted) {
    const path = join(abiDir, file);
    const existing = await readIfExists(path);
    if (existing === contents) continue;
    if (check) {
      stale.push(existing === null ? `${file} (missing)` : `${file} (stale)`);
    } else {
      await writeFile(path, contents, "utf8");
      console.log(`wrote src/abi/${file}`);
    }
  }

  // A file nobody generates any more must not linger and get imported.
  const present = await readdir(abiDir).catch(() => []);
  const orphans = present.filter((name) => !wanted.has(name));
  if (orphans.length > 0) {
    console.warn(`warning: unexpected files in src/abi: ${orphans.join(", ")}`);
  }

  if (check) {
    if (stale.length > 0) {
      console.error(`ABIs are out of date: ${stale.join(", ")}`);
      console.error("Run `npm run sync:abi` and commit the result.");
      process.exitCode = 1;
      return;
    }
    console.log("ABIs are up to date.");
  }
}

await main();

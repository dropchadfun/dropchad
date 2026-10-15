// Flat config, ESLint 9. One config for every workspace.
// Rule of the repo: zero eslint errors. Warnings are treated as errors in CI (`--max-warnings 0`).
import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * `eslint-config-next` ships four entries: the Next and React rules, a TypeScript parser entry,
 * a set of ignores, and the core web vitals rules. The parser entry is dropped because the
 * type-aware config below already parses every TypeScript file in the repo, and registering
 * `@typescript-eslint` twice is an error. The ignores are folded into the list below. What is
 * left is scoped to `apps/web`, the only Next app.
 */
const nextRules = nextCoreWebVitals
  .filter((entry) => entry.name === "next" || entry.name === "next/core-web-vitals")
  .map(({ languageOptions, settings, ...entry }) => ({
    ...entry,
    files: ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"],
    ...(languageOptions?.globals ? { languageOptions: { globals: languageOptions.globals } } : {}),
    // `version: "detect"` calls an API ESLint 10 removed. Pinned to the React in apps/web.
    ...(settings ? { settings: { ...settings, react: { version: "19.2" } } } : {}),
    // The app router has no `pages/`. Without this the rule prints a warning on every run.
    rules: { ...entry.rules, "@next/next/no-html-link-for-pages": ["error", "apps/web/src/app"] },
  }));

export default tseslint.config(
  {
    // Never linted: dependencies, foundry output, generated files, local data.
    ignores: [
      "**/node_modules/**",
      "contracts/**",
      "**/.ponder/**",
      "**/dist/**",
      "**/.data/**",
      "packages/shared/src/abi/**",
      "packages/shared/src/idl/dropchad.ts",
      // Written by `ponder codegen`, and it says "do not manually edit" at the top.
      "apps/indexer/ponder-env.d.ts",
      // Next.js build output and its generated type file.
      "apps/web/.next/**",
      "apps/web/out/**",
      "apps/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // We use `import type` explicitly, `verbatimModuleSyntax` enforces it.
      "@typescript-eslint/consistent-type-imports": "error",
      // An unused argument named with a leading underscore is deliberate.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Nothing in this repo may swallow a rejected promise.
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": "off",
    },
  },
  ...nextRules,
  {
    // The browser app. Next's own rules are above; this adds the DOM globals.
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Plain JS tooling scripts: node globals, and no type-aware linting because they are not in
    // any tsconfig.
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Keep the type-aware parser switched off, and add the node globals on top of it.
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
  {
    // CommonJS, because pm2 loads its config with `require`: `deploy/ecosystem.config.cjs`.
    files: ["**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);

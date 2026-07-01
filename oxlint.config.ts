import { defineConfig } from "oxlint";

export default defineConfig({
  // Base = Node / isomorphic TS (worker + packages). React added only where needed.
  plugins: ["typescript", "import", "unicorn"],
  env: { node: true, es2024: true },
  categories: {
    correctness: "error",
    suspicious: "warn",
  },
  rules: {
    "no-console": "warn", // pino owns real logging; console is a smell
    "import/no-cycle": "error",
    "typescript/no-explicit-any": "warn",
  },
  ignorePatterns: [
    "**/dist/**",
    "**/build/**",
    "**/.output/**",
    "**/.turbo/**",
    "**/routeTree.gen.ts", // TanStack Router generated (Phase 1)
    "**/*.gen.ts",
  ],
  overrides: [
    {
      // Browser + React surfaces
      files: ["apps/web/**", "packages/ui/**"],
      plugins: ["react", "jsx-a11y"],
      env: { browser: true },
      rules: { "no-console": "error" },
    },
    {
      // Tests
      files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
      plugins: ["vitest"],
      rules: { "typescript/no-explicit-any": "off", "no-console": "off" },
    },
    {
      // Scripts / config files
      files: ["**/scripts/**", "**/*.config.ts"],
      rules: { "no-console": "off" },
    },
  ],
  // options.typeAware / typeCheck are ROOT-ONLY (they error in a nested config).
  // Optional here since we already gate on `tsc --noEmit`; enabling needs oxlint-tsgolint:
  // options: { typeAware: true },
});

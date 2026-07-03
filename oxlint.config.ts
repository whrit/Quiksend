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
      rules: {
        "no-console": "error",
        // automatic JSX runtime (jsx: "react-jsx") — no React import needed
        "react/react-in-jsx-scope": "off",
        // inner handlers/components are idiomatic in React
        "unicorn/consistent-function-scoping": "off",
        // Label is a thin wrapper component; association is used at call sites
        "jsx-a11y/label-has-associated-control": "off",
      },
    },
    {
      // Server-only marker files (TanStack Start's execution-model pattern):
      // `import "@tanstack/react-start/server-only"` is a side-effect module that
      // instructs the Vite plugin to mock this module on the client. Not a lint
      // smell — it's the documented way to gate a file to server context.
      files: [
        "apps/web/src/**/*.server.ts",
        "apps/web/src/lib/canary-injection.ts",
        "apps/web/src/lib/effect-executor.ts",
        "apps/web/src/lib/mailbox-adapter.ts",
        "apps/web/src/lib/org-fn.ts",
        "apps/web/src/lib/protected-guard.ts",
        "apps/web/src/lib/timing.ts",
        "apps/web/src/lib/api/v1/helpers.ts",
        "apps/web/src/lib/api/v1/middleware.ts",
      ],
      rules: { "import/no-unassigned-import": "off" },
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

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
    // Serialize DB-touching tests. Tenancy + CRM upsert tests share a Postgres
    // and race in parallel forks (last-write-wins on truncate).
    fileParallelism: false,
  },
});

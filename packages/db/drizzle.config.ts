import { defineConfig } from "drizzle-kit";

// DATABASE_URL is injected via dotenv-cli (`-e ../../.env`) in the package scripts,
// so it reads the repo-root .env regardless of the current working directory.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
});

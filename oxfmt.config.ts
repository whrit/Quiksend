import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 100, // oxfmt's default; wider than Prettier's 80, better for typed TS
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",

  ignorePatterns: [
    "**/routeTree.gen.ts",
    "**/*.gen.ts",
    "**/.output/**",
    "**/dist/**",
    "CHANGELOG.md",
    "oxfmt.config.ts",
    "oxlint.config.ts",
    // Orchestration briefs — human-written specs for Cursor agents, not shippable code.
    // Their formatting drifts between waves and CI shouldn't fail on prose whitespace.
    "WAVE_CONTEXT.md",
    "wave*/**/*.md",
  ],

  // We use Tailwind + shadcn heavily — oxfmt can sort classes (replaces
  // prettier-plugin-tailwindcss). The sorting options are experimental and the exact
  // key follows an `experimental*` naming convention, so confirm it against
  // `oxfmt --init` output or the schema before committing:
  // experimentalSortTailwindClasses: true,

  overrides: [
    { files: ["*.md", "*.mdx"], options: { printWidth: 80 } }, // prose reads better narrower
  ],
});

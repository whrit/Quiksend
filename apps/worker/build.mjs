#!/usr/bin/env node
/**
 * esbuild bundle script for @quiksend/worker.
 * Bundles src/index.ts + workspace packages into dist/index.js.
 * Externalizes only runtime packages (pino, pino-pretty, thread-stream).
 * Workspace packages (@quiksend/*) are bundled, not externalized.
 */

import * as esbuild from "esbuild";

const result = await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/index.js",
  external: ["pino", "pino-pretty", "thread-stream"],
  logLevel: "info",
  minify: false,
});

console.log("Build complete:", result);

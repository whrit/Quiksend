#!/usr/bin/env node
/**
 * esbuild bundle script for @quiksend/db migrations.
 * Bundles src/migrate.ts into dist/migrate.js.
 * Externalizes only runtime packages.
 */

import * as esbuild from "esbuild";

const result = await esbuild.build({
  entryPoints: ["src/migrate.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/migrate.js",
  external: ["postgres"],
  logLevel: "info",
  minify: false,
});

console.log("Migration bundle complete:", result);

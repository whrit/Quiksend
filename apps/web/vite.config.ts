import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 3000 },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      // Tests colocated with route files (e.g. `apps/web/src/routes/api/v1/*.test.ts`)
      // are not routes. The router's `routeFileIgnorePrefix: "-"` doesn't cover them,
      // so filter every `.test.ts`/`.test.tsx` file under `src/routes/` here.
      router: { routeFileIgnorePattern: "\\.test\\.[tj]sx?$" },
    }),
    nitro(),
    // react's plugin must come after start's plugin
    viteReact(),
  ],
});

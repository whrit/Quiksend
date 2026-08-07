import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// Dev-server port. Defaults to 3000 (matches `BETTER_AUTH_URL` in `.env.example`),
// override via `WEB_PORT=3005` in `.env` or shell when 3000 is taken by another
// process on the host. `strictPort: true` makes a collision a hard error instead
// of silently drifting to the next free port — otherwise Better Auth callbacks
// and Nango webhook tunnels would keep hitting the wrong service.
const port = Number(process.env.WEB_PORT ?? process.env.PORT ?? 3000);

export default defineConfig({
  server: { port, strictPort: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      // Colocated non-route files under `src/routes/` (`*.test.[tj]sx`,
      // `*.helpers.[tj]sx`) are not routes. The router's `routeFileIgnorePrefix: "-"`
      // doesn't cover them, so filter both categories here so future colocated
      // tests/helpers don't need special renaming.
      router: { routeFileIgnorePattern: "\\.(test|helpers)\\.[tj]sx?$" },
    }),
    nitro(),
    // react's plugin must come after start's plugin
    viteReact(),
  ],
});

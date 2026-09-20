import { execSync } from "child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));

/* Build identity, baked in at build time. `__CB_BUILD__` is the short git
   SHA of the commit being built (or "dev" when git is unavailable). The
   app polls public/version.json and compares — when they differ, a newer
   deploy exists and the "new version ready" banner appears. */
function buildSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

// On Cloudflare, `wrangler pages dev` serves both the built site and the
// /functions endpoints together, so no dev proxy is required here.
export default defineConfig({
  plugins: [react()],
  define: {
    __CB_BUILD__: JSON.stringify(buildSha()),
    /* Base URL for the cinematic video CDN (R2). Empty = serve the clips
       from this origin's /assets/cinematic/ as today. Set at build time via
       VITE_VIDEO_CDN_BASE, or at runtime via window.__CB_VIDEO_CDN__
       (see docs/video-cdn.md). The find/replace map the frontend applies in
       CerebrumApp.jsx is docs/video-cdn-frontend-map.md. */
    __CB_VIDEO_CDN__: JSON.stringify(process.env.VITE_VIDEO_CDN_BASE || ""),
  },
  resolve: {
    alias: [
      /* Route the monolith's two static E2EE imports through lazy facades so
         vodozemac, bip39's wordlists and hash-wasm stop riding in the initial
         JS bundle. The facades re-export the same names; the real modules
         become on-demand chunks loaded on first Private Vault use. Node-side
         tests import the real modules directly and never see this alias. */
      {
        find: /^\.\/e2ee\/messaging\.js$/,
        replacement: resolve(here, "src/e2ee/lazyMessaging.js"),
      },
      {
        find: /^\.\/e2ee\/recovery\.js$/,
        replacement: resolve(here, "src/e2ee/lazyRecovery.js"),
      },
    ],
  },
  build: {
    /* react + react-dom change far less often than the app itself; give them
       a stable chunk so repeat visitors revalidate one small file instead of
       the whole application bundle. */
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
});

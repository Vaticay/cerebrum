import { execSync } from "child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  },
});

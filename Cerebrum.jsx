import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// On Cloudflare, `wrangler pages dev` serves both the built site and the
// /functions endpoints together, so no dev proxy is required here.
export default defineConfig({
  plugins: [react()],
});

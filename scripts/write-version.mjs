/* Writes public/version.json at build time (runs as the `prebuild` step).
   The app polls /version.json and compares `sha` against the baked-in
   __CB_BUILD__ — a mismatch means a newer deploy is live. */
import { execSync } from "child_process";
import { writeFileSync } from "fs";

function sha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

const payload = { sha: sha(), builtAt: new Date().toISOString() };
writeFileSync(new URL("../public/version.json", import.meta.url), JSON.stringify(payload) + "\n");
console.log("version.json:", JSON.stringify(payload));

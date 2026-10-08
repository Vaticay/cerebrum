/**
 * Build-time guard: no module-scope self-reads during initialization.
 *
 * On 2026-10-08 the production site went down with a forever boot spinner
 * because src/designSystem.jsx had:
 *   export const PRO = { emerald: PRO.emerald, ... }
 * Reading PRO inside its own initializer is a Temporal Dead Zone violation:
 * it throws during module evaluation, before React mounts. Vite bundles the
 * code fine (it never executes modules), so the build passed and the failure
 * only appeared at runtime.
 *
 * The existing scope-audit TDZ check does not cover this class: it only
 * looks for use-before-declaration inside function bodies, and only in
 * CerebrumApp.jsx / main.jsx / legalContent.js. This check closes the gap:
 * for every frontend module, any top-level const/let/var/class whose
 * initializer reads the binding being declared (outside a nested closure,
 * which runs later) fails the build.
 *
 * Run via `npm run build` (wired through `prebuild`).
 * Standalone: node scripts/check-module-tdz.mjs [dir]
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "scripts/check-module-tdz.mjs"));
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const targetDir = process.argv[2]
  ? (isAbsolute(process.argv[2]) ? process.argv[2] : join(root, process.argv[2]))
  : join(root, "src");

const problems = [];

function checkFile(file) {
  const src = readFileSync(file, "utf8");
  let ast;
  try {
    ast = parser.parse(src, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "classProperties", "optionalChaining",
        "nullishCoalescingOperator", "objectRestSpread", "dynamicImport"],
    });
  } catch (e) {
    // Unparseable here is vite's problem, not this check's; skip quietly.
    return;
  }
  traverse(ast, {
    Program(path) {
      for (const [name, binding] of Object.entries(path.scope.bindings)) {
        if (!["const", "let", "var"].includes(binding.kind) && binding.kind !== "class") continue;
        const bpath = binding.path;
        let initNode = null;
        if (bpath.isVariableDeclarator()) initNode = bpath.node.init;
        else if (bpath.isClassDeclaration() || bpath.isClassExpression()) initNode = bpath.node.superClass;
        if (!initNode) continue;
        for (const ref of binding.referencePaths || []) {
          if (ref.node.start < initNode.start || ref.node.end > initNode.end) continue;
          // Inside a nested function the reference runs after init; fine.
          if (ref.getFunctionParent() !== null) continue;
          const { line, column } = ref.node.loc.start;
          problems.push(
            `${file}: "${name}" is read inside its own initializer at line ${line}:${column}. ` +
            `This throws "Cannot access '${name}' before initialization" during module evaluation, ` +
            `before React mounts.`
          );
        }
      }
      path.skip();
    },
  });
}

for (const entry of readdirSync(targetDir)) {
  if (!/\.(jsx?|mjs|cjs|ts|tsx)$/.test(entry)) continue;
  checkFile(join(targetDir, entry));
}

if (problems.length) {
  console.error(`\ncheck-module-tdz: ${problems.length} module-init self-read${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("check-module-tdz: passed (no module-scope self-reads during initialization)");

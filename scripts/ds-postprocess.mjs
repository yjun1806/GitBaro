// Post-processes the `pnpm ds:bundle` output (vite.ds.config.ts) before it is published as the
// Design System artifact's components/bundle.js and components/bundle.css.
//
// 1. Strips every `@font-face` rule that Tailwind compiled from src/styles/globals.css — the
//    artifact already hosts Pretendard/D2Coding under its own fonts/, loaded by its own
//    tokens.css with the same font-family names, and Vite's copies would reference asset paths
//    that don't exist once bundle.css is served from the artifact.
// 2. Checks the format contract bundle.js must meet (no literal `</script`, no `eval`/`new
//    Function`, no dynamic `import(`) and reports both files' final byte size against the
//    artifact type's caps (bundle.js <= 6 MB, bundle.css <= 2 MB).
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const distDir = path.resolve(import.meta.dirname, "..", "dist-ds");
const jsPath = path.join(distDir, "bundle.js");
const cssPath = path.join(distDir, "bundle.css");

// ── bundle.css: drop @font-face blocks (declarations only, so braces never nest) ──
const css = readFileSync(cssPath, "utf8");
const stripped = css.replace(/@font-face\s*\{[^}]*\}/g, "");
if (stripped !== css) writeFileSync(cssPath, stripped);

// ── bundle.js: format contract checks ──
const js = readFileSync(jsPath, "utf8");
const problems = [];
if (js.includes("</script")) problems.push('contains a literal "</script"');
if (/\beval\s*\(/.test(js)) problems.push("calls eval(...)");
if (/\bnew\s+Function\s*\(/.test(js)) problems.push("calls new Function(...)");
if (/\bimport\s*\(/.test(js)) problems.push("uses a dynamic import(...)");
if (problems.length > 0) {
  console.error("ds:bundle: bundle.js fails the Design System bundle contract:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const jsBytes = statSync(jsPath).size;
const cssBytes = statSync(cssPath).size;
const fmt = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`ds:bundle: bundle.js  ${fmt(jsBytes)} (cap 6 MB)`);
console.log(`ds:bundle: bundle.css ${fmt(cssBytes)} (cap 2 MB)`);
if (jsBytes > 6 * 1024 * 1024) {
  console.error("ds:bundle: bundle.js exceeds the 6 MB cap");
  process.exit(1);
}
if (cssBytes > 2 * 1024 * 1024) {
  console.error("ds:bundle: bundle.css exceeds the 2 MB cap");
  process.exit(1);
}

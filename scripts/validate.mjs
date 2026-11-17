// Validación del frontend (sin dependencias): sintaxis de JS, manifest y referencias de index.html.
// Uso:  node scripts/validate.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "static";
let errores = 0;
const falla = (msg) => { console.error(`✗ ${msg}`); errores++; };
const ok = (msg) => console.log(`✓ ${msg}`);

for (const f of readdirSync(DIR).filter((f) => f.endsWith(".js"))) {
  try {
    execFileSync(process.execPath, ["--check", join(DIR, f)], { stdio: "pipe" });
    ok(`sintaxis ${f}`);
  } catch (e) {
    falla(`sintaxis ${f}: ${e.stderr}`);
  }
}

try {
  const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
  for (const icon of manifest.icons ?? []) {
    const file = icon.src.replace(/^\/static\//, "");
    existsSync(join(DIR, file)) ? ok(`manifest → ${file}`) : falla(`manifest apunta a ${icon.src}, que no existe`);
  }
} catch (e) {
  falla(`manifest.json no es JSON válido: ${e.message}`);
}

const html = readFileSync(join(DIR, "index.html"), "utf8");
if (!/^<!doctype html>/i.test(html)) falla("index.html sin <!doctype html>");
for (const [, ref] of html.matchAll(/(?:src|href)="\/static\/([^"?#]+)/g)) {
  existsSync(join(DIR, ref)) ? ok(`index.html → ${ref}`) : falla(`index.html apunta a /static/${ref}, que no existe`);
}
const css = readFileSync(join(DIR, "kut.css"), "utf8");
const abre = (css.match(/{/g) ?? []).length, cierra = (css.match(/}/g) ?? []).length;
abre === cierra ? ok(`kut.css: ${abre} bloques balanceados`) : falla(`kut.css: llaves desbalanceadas (${abre} { vs ${cierra} })`);

if (errores) { console.error(`\n${errores} error(es)`); process.exit(1); }
console.log("\nFrontend válido");

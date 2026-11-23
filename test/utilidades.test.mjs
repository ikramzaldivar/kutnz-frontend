// Funciones puras de app.js: contraseña, fechas, textos del panel y construcción de elementos.
// Zona fija para que las conversiones de fecha den lo mismo en cualquier máquina (CDMX no tiene horario de verano).
process.env.TZ = "America/Mexico_City";

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./harness.mjs";

const app = await loadApp();
const passwordProblem = app.get("passwordProblem");
const toLocalInput = app.get("toLocalInput");
const fromLocalInput = app.get("fromLocalInput");
const fmtDate = app.get("fmtDate");
const metaText = app.get("metaText");
const h = app.get("h");
const breakdown = app.get("breakdown");

// 2026-01-01T00:00:00Z = 31 dic 2025, 18:00 en CDMX.
const AÑO_NUEVO_UTC = 1767225600;

test("passwordProblem acepta una contraseña que cumple la política de Cognito", () => {
  assert.equal(passwordProblem("abcdefghi1"), "");
  assert.equal(passwordProblem("Contraseña segura 2026"), "");
});

test("passwordProblem dice todo lo que falta y cuántos caracteres lleva", () => {
  assert.equal(passwordProblem(""),
    "A tu contraseña le falta: al menos 10 caracteres (llevas 0), una letra minúscula, un número.");
});

test("passwordProblem revisa cada regla por separado", () => {
  assert.equal(passwordProblem("abcdefghij"), "A tu contraseña le falta: un número.");
  assert.equal(passwordProblem("ABCDEFGHI1"), "A tu contraseña le falta: una letra minúscula.");
  assert.equal(passwordProblem("abc1"), "A tu contraseña le falta: al menos 10 caracteres (llevas 4).");
});

test("passwordProblem exige exactamente 10 caracteres como mínimo", () => {
  assert.equal(passwordProblem("abcdefgh1"), "A tu contraseña le falta: al menos 10 caracteres (llevas 9).");
  assert.equal(passwordProblem("abcdefghi1"), "");
});

test("toLocalInput convierte segundos epoch a la hora local del <input type=datetime-local>", () => {
  assert.equal(toLocalInput(AÑO_NUEVO_UTC), "2025-12-31T18:00");
});

test("toLocalInput deja el campo vacío si el enlace no caduca", () => {
  assert.equal(toLocalInput(null), "");
  assert.equal(toLocalInput(undefined), "");
  assert.equal(toLocalInput(0), "");
});

test("fromLocalInput interpreta el valor en hora local y lo manda en ISO UTC", () => {
  assert.equal(fromLocalInput("2025-12-31T18:00"), "2026-01-01T00:00:00.000Z");
});

test("fromLocalInput manda null si el campo está vacío (= nunca caduca)", () => {
  assert.equal(fromLocalInput(""), null);
});

test("toLocalInput y fromLocalInput son inversas", () => {
  const ts = 1780000000; // múltiplo de 60: el input no tiene segundos
  assert.equal(Date.parse(fromLocalInput(toLocalInput(ts))) / 1000, ts - (ts % 60));
});

test("fmtDate muestra un guion cuando no hay fecha", () => {
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDate(0), "—");
});

test("fmtDate formatea en español de México y hora local", () => {
  const texto = fmtDate(AÑO_NUEVO_UTC);
  assert.match(texto, /31/);
  assert.match(texto, /dic/i);
  assert.match(texto, /2025/);
});

test("metaText muestra fecha de creación y clics", () => {
  const texto = metaText({ created_at: AÑO_NUEVO_UTC, clicks: 3 });
  assert.match(texto, /^Creado .+ · 3 clics$/);
});

test("metaText agrega el límite de clics y la caducidad cuando existen", () => {
  const texto = metaText({ created_at: AÑO_NUEVO_UTC, clicks: 3, max_clicks: 10, expires_at: AÑO_NUEVO_UTC });
  assert.match(texto, / · 3 \/ 10 clics · caduca /);
});

test("h() asigna clase, atributos y listeners", () => {
  const fn = () => {};
  const el = h("button", { class: "btn", type: "submit", onclick: fn, "data-code": "abc" });
  assert.equal(el.tagName, "BUTTON");
  assert.equal(el.className, "btn");
  assert.equal(el.getAttribute("type"), "submit");
  assert.equal(el.getAttribute("data-code"), "abc");
  assert.equal(el.getAttribute("onclick"), null);
  assert.equal(el.listeners.click[0], fn);
});

test("h() trata true como atributo booleano y omite false y null", () => {
  const el = h("input", { required: true, disabled: false, value: null, min: 1 });
  assert.equal(el.getAttribute("required"), "");
  assert.equal(el.getAttribute("disabled"), null);
  assert.equal(el.getAttribute("value"), null);
  assert.equal(el.getAttribute("min"), "1");
});

test("h() convierte texto en nodos, aplana arreglos y salta null", () => {
  const hijo = h("b", {}, "dos");
  const el = h("p", {}, "uno ", [hijo, null, [" tres"]], null);
  assert.equal(el.children.length, 3);
  assert.equal(el.children[1], hijo);
  assert.equal(el.textContent, "uno dos tres");
});

test("breakdown muestra las 6 entradas con más clics, de mayor a menor", () => {
  const datos = { a: 1, b: 7, c: 3, d: 9, e: 2, f: 5, g: 4, h: 8 };
  const el = breakdown("País", datos);
  const [titulo, ...filas] = el.children;
  assert.equal(titulo.textContent, "País");
  assert.deepEqual(filas.map((f) => f.textContent), ["d9", "h8", "b7", "f5", "g4", "c3"]);
  assert.equal(filas[0].children[2].getAttribute("style"), "--w:100%");
});

test("breakdown avisa cuando todavía no hay datos", () => {
  const el = breakdown("Navegador", {});
  assert.equal(el.children.length, 2);
  assert.equal(el.children[1].textContent, "Sin datos todavía");
});

// Botones del panel que llaman a la API: si la petición falla, el usuario debe ver el error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp, respond } from "./harness.mjs";

const conSesion = { kut_token: "token-1", kut_refresh: "refresh-1" };

const LINK = {
  code: "abc", short_url: "https://kut.nz/abc", target: "https://example.com", title: null,
  created_at: 1_700_000_000, expires_at: null, max_clicks: null, clicks: 0, has_password: false,
  disabled: true, disabled_by_admin: false, status: "desactivado",
};

// Busca dentro de un elemento el botón con ese texto.
function boton(el, texto) {
  if (el.tagName === "BUTTON" && el.textContent === texto) return el;
  for (const c of el.children ?? []) {
    const encontrado = boton(c, texto);
    if (encontrado) return encontrado;
  }
  return null;
}

// Simula el clic como lo hace el navegador (currentTarget = el botón).
const clic = (btn) => btn.listeners.click[0]({ currentTarget: btn });

test("act() muestra el error de la API y vuelve a habilitar el botón", async () => {
  const app = await loadApp({ storage: conSesion });
  const btn = { disabled: false };
  const ok = await app.get("act")(btn, async () => { throw new Error("Este enlace fue desactivado por un administrador."); });
  assert.equal(ok, false);
  assert.deepEqual(app.alerts, ["Este enlace fue desactivado por un administrador."]);
  assert.equal(btn.disabled, false);
});

test("act() deshabilita el botón mientras espera y no muestra nada si sale bien", async () => {
  const app = await loadApp({ storage: conSesion });
  const btn = { disabled: false };
  let duranteLaPeticion;
  const ok = await app.get("act")(btn, async () => { duranteLaPeticion = btn.disabled; });
  assert.equal(ok, true);
  assert.equal(duranteLaPeticion, true);
  assert.equal(btn.disabled, false);
  assert.deepEqual(app.alerts, []);
});

test("Reactivar en el panel muestra el 403 del backend en lugar de fallar en silencio", async () => {
  const app = await loadApp({ storage: conSesion });
  app.fetch = () => respond(403, { error: { message: "Este enlace fue desactivado por un administrador." } });
  const row = app.get("linkRow")(LINK);
  await clic(boton(row, "Reactivar"));
  const patch = app.calls.find((c) => c.method === "PATCH");
  assert.equal(patch.url, "/api/v1/links/abc");
  assert.equal(patch.body, '{"disabled":false}');
  assert.deepEqual(app.alerts, ["Este enlace fue desactivado por un administrador."]);
});

test("Borrar en el panel muestra el error si la API falla", async () => {
  const app = await loadApp({ storage: conSesion });
  app.fetch = () => respond(500, { error: { message: "Error interno" } });
  await clic(boton(app.get("linkRow")(LINK), "Borrar"));
  assert.ok(app.calls.some((c) => c.method === "DELETE" && c.url === "/api/v1/links/abc"));
  assert.deepEqual(app.alerts, ["Error interno"]);
});

test("Borrar no llama a la API si el usuario cancela", async () => {
  const app = await loadApp({ storage: conSesion });
  app.confirmAnswer = false;
  app.calls.length = 0;
  await clic(boton(app.get("linkRow")(LINK), "Borrar"));
  assert.equal(app.calls.length, 0);
  assert.deepEqual(app.alerts, []);
});

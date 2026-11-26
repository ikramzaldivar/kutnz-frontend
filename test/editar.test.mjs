// editChanges(): el PATCH de "Editar" solo lleva los campos que cambiaron.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./harness.mjs";

process.env.TZ = "America/Mexico_City";

const app = await loadApp();
const editChanges = app.get("editChanges");
const toLocalInput = app.get("toLocalInput");

const CADUCO = 1_700_000_000; // 14-nov-2023: ya pasó
const LINK = {
  code: "abc", target: "https://example.com", title: "Mi enlace",
  expires_at: CADUCO, max_clicks: 10, has_password: true,
};

// Valores del formulario tal como los llena editLink() al abrirlo, sin que el usuario toque nada.
const sinCambios = (l) => ({
  url: l.target, title: l.title || "", expires: toLocalInput(l.expires_at), max: String(l.max_clicks ?? ""),
  password: "", removePassword: false,
});

test("sin cambios no manda nada", () => {
  assert.deepEqual({ ...editChanges(LINK, sinCambios(LINK)) }, {});
});

test("cambiar solo el nombre de un enlace caducado no reenvía la caducidad", () => {
  const body = editChanges(LINK, { ...sinCambios(LINK), title: "Nuevo nombre" });
  assert.deepEqual({ ...body }, { title: "Nuevo nombre" });
});

test("cambiar solo el destino manda solo url", () => {
  const body = editChanges(LINK, { ...sinCambios(LINK), url: "https://iteso.mx/" });
  assert.deepEqual({ ...body }, { url: "https://iteso.mx/" });
});

test("vaciar la caducidad la quita (expires_at: null)", () => {
  const body = editChanges(LINK, { ...sinCambios(LINK), expires: "" });
  assert.deepEqual({ ...body }, { expires_at: null });
});

test("una caducidad nueva se manda en ISO", () => {
  const body = editChanges(LINK, { ...sinCambios(LINK), expires: "2030-01-01T12:00" });
  assert.equal(body.expires_at, "2030-01-01T18:00:00.000Z");
});

test("vaciar el máximo de clics lo quita y un número nuevo se manda como número", () => {
  assert.deepEqual({ ...editChanges(LINK, { ...sinCambios(LINK), max: "" }) }, { max_clicks: null });
  assert.deepEqual({ ...editChanges(LINK, { ...sinCambios(LINK), max: "25" }) }, { max_clicks: 25 });
});

test("contraseña: una nueva se manda; quitarla manda vacío; si no se toca, no va", () => {
  assert.equal(editChanges(LINK, { ...sinCambios(LINK), password: "secreta123" }).password, "secreta123");
  assert.equal(editChanges(LINK, { ...sinCambios(LINK), removePassword: true }).password, "");
  assert.equal("password" in editChanges(LINK, sinCambios(LINK)), false);
});

test("enlace sin nombre, sin caducidad ni límite: dejar los campos vacíos no manda nada", () => {
  const simple = { code: "xyz", target: "https://example.com", title: null, expires_at: null, max_clicks: null };
  assert.deepEqual({ ...editChanges(simple, sinCambios(simple)) }, {});
});

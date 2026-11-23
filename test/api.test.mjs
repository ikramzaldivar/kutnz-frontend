// Cliente de la API, sesión con Cognito y arranque de la app. fetch y localStorage son simulados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, ME, backend, loadApp, respond } from "./harness.mjs";

const COGNITO_URL = "https://cognito-idp.us-east-1.amazonaws.com/";
const conSesion = { kut_token: "token-viejo", kut_refresh: "refresh-1" };

// Carga la app con sesión y deja limpio el registro de llamadas del arranque.
async function appConSesion(storage = conSesion) {
  const app = await loadApp({ storage });
  app.calls.length = 0;
  return app;
}

const cognitoTarget = (call) => call.headers["X-Amz-Target"].replace("AWSCognitoIdentityProviderService.", "");

// ---------------- api() ----------------

test("api() manda el token en Authorization y no agrega Content-Type sin body", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(200, { data: [] });
  await app.get("api")("/api/v1/links");
  const [call] = app.calls;
  assert.equal(call.method, "GET");
  assert.equal(call.headers.Authorization, "Bearer token-viejo");
  assert.equal(call.headers["Content-Type"], undefined);
  assert.equal(call.body, undefined);
});

test("api() no manda Authorization si no hay sesión", async () => {
  const app = await loadApp();
  app.calls.length = 0;
  await app.get("api")("/api/v1/config");
  assert.equal(app.calls[0].headers.Authorization, undefined);
});

test("api() serializa el body como JSON y conserva los headers extra", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(201, { data: { code: "abc" } });
  const res = await app.get("api")("/api/v1/links", {
    method: "POST", body: { url: "https://example.com" }, headers: { "Idempotency-Key": "k1" },
  });
  const [call] = app.calls;
  assert.equal(res.data.code, "abc");
  assert.equal(call.method, "POST");
  assert.equal(call.headers["Content-Type"], "application/json");
  assert.equal(call.headers["Idempotency-Key"], "k1");
  assert.equal(call.body, '{"url":"https://example.com"}');
});

test("api() devuelve null en un 204", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(204);
  assert.equal(await app.get("api")("/api/v1/links/abc", { method: "DELETE" }), null);
});

test("api() usa el mensaje de error del backend y guarda el status", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(409, { error: { message: "Ese alias ya existe." } });
  await assert.rejects(app.get("api")("/api/v1/links", { method: "POST", body: {} }),
    { message: "Ese alias ya existe.", status: 409 });
});

test("api() da un mensaje genérico si la respuesta de error no es JSON", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(502);
  await assert.rejects(app.get("api")("/api/v1/links"), { message: "Error 502", status: 502 });
});

test("api() renueva el token ante un 401 y repite la petición una vez", async () => {
  const app = await appConSesion();
  app.fetch = (url, opts) => {
    if (url === COGNITO_URL) return respond(200, { AuthenticationResult: { AccessToken: "token-nuevo" } });
    return opts.headers.Authorization === "Bearer token-nuevo" ? respond(200, { data: "ok" }) : respond(401, {});
  };
  const res = await app.get("api")("/api/v1/links");
  assert.equal(res.data, "ok");
  assert.deepEqual(app.calls.map((c) => c.url), ["/api/v1/links", COGNITO_URL, "/api/v1/links"]);
  assert.equal(app.storage.get("kut_token"), "token-nuevo");
  // El refresh no regresa RefreshToken: se conserva el que había.
  assert.equal(app.storage.get("kut_refresh"), "refresh-1");

  const refresh = JSON.parse(app.calls[1].body);
  assert.equal(cognitoTarget(app.calls[1]), "InitiateAuth");
  assert.equal(refresh.AuthFlow, "REFRESH_TOKEN_AUTH");
  assert.equal(refresh.ClientId, CONFIG.cognito_client_id);
  assert.equal(refresh.AuthParameters.REFRESH_TOKEN, "refresh-1");
});

test("api() no reintenta en bucle si el 401 persiste después de renovar", async () => {
  const app = await appConSesion();
  app.fetch = (url) => url === COGNITO_URL
    ? respond(200, { AuthenticationResult: { AccessToken: "token-nuevo" } })
    : respond(401, { error: { message: "Sesión inválida" } });
  await assert.rejects(app.get("api")("/api/v1/links"), { status: 401 });
  assert.equal(app.calls.filter((c) => c.url === COGNITO_URL).length, 1);
  assert.equal(app.calls.filter((c) => c.url === "/api/v1/links").length, 2);
});

test("api() no intenta renovar si no hay refresh token", async () => {
  const app = await appConSesion({ kut_token: "token-viejo" });
  app.fetch = () => respond(401, {});
  await assert.rejects(app.get("api")("/api/v1/links"), { status: 401 });
  assert.deepEqual(app.calls.map((c) => c.url), ["/api/v1/links"]);
});

// ---------------- Cognito ----------------

test("cognito() llama al endpoint de la región con el X-Amz-Target correcto", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(200, { CodeDeliveryDetails: {} });
  await app.get("cognito")("ForgotPassword", { ClientId: "client-123", Username: "ana@example.com" });
  const [call] = app.calls;
  assert.equal(call.url, COGNITO_URL);
  assert.equal(call.method, "POST");
  assert.equal(call.headers["Content-Type"], "application/x-amz-json-1.1");
  assert.equal(cognitoTarget(call), "ForgotPassword");
  assert.equal(JSON.parse(call.body).Username, "ana@example.com");
});

test("cognito() traduce los errores conocidos y conserva el tipo", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(400, {
    __type: "com.amazonaws.cognito.identity.idp.model#NotAuthorizedException", message: "Incorrect username or password.",
  });
  await assert.rejects(app.get("cognito")("InitiateAuth", {}),
    { message: "Correo o contraseña incorrectos.", type: "NotAuthorizedException" });
});

test("cognito() usa el mensaje de AWS si el error no está traducido", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(400, { __type: "UserNotConfirmedException", message: "User is not confirmed." });
  await assert.rejects(app.get("cognito")("InitiateAuth", {}),
    { message: "User is not confirmed.", type: "UserNotConfirmedException" });
});

test("cognito() tiene un mensaje genérico si la respuesta no trae nada", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(500);
  await assert.rejects(app.get("cognito")("InitiateAuth", {}),
    { message: "No se pudo completar. Intenta de nuevo." });
});

test("refresh() no llama a Cognito en modo dev", async () => {
  const app = await loadApp({
    storage: { kut_token: "dev:ana", kut_refresh: "refresh-1" },
    fetch: (url) => url === "/api/v1/config" ? respond(200, { data: { ...CONFIG, auth_mode: "dev" } }) : backend(url),
  });
  app.calls.length = 0;
  assert.equal(await app.get("refresh")(), false);
  assert.equal(app.calls.length, 0);
});

test("refresh() devuelve false si Cognito rechaza el refresh token", async () => {
  const app = await appConSesion();
  app.fetch = () => respond(400, { __type: "NotAuthorizedException" });
  assert.equal(await app.get("refresh")(), false);
  assert.equal(app.storage.get("kut_token"), "token-viejo");
});

test("saveSession() guarda el refresh token solo cuando viene en la respuesta", async () => {
  const app = await appConSesion();
  const saveSession = app.get("saveSession");
  saveSession({ AccessToken: "a1", RefreshToken: "r2" });
  assert.equal(app.storage.get("kut_token"), "a1");
  assert.equal(app.storage.get("kut_refresh"), "r2");
  saveSession({ AccessToken: "a2" });
  assert.equal(app.storage.get("kut_token"), "a2");
  assert.equal(app.storage.get("kut_refresh"), "r2");
});

test("logout() cierra la sesión en Cognito, borra los tokens y vuelve a la portada", async () => {
  const app = await appConSesion({ ...conSesion, kut_me: JSON.stringify(ME) });
  app.fetch = () => respond(200, {});
  await app.get("logout")();
  assert.equal(cognitoTarget(app.calls[0]), "GlobalSignOut");
  assert.equal(JSON.parse(app.calls[0].body).AccessToken, "token-viejo");
  assert.equal(app.storage.size, 0);
  assert.deepEqual(app.assigned, ["/"]);
});

test("logout() borra la sesión aunque Cognito falle", async () => {
  const app = await appConSesion();
  app.fetch = () => { throw new TypeError("Failed to fetch"); };
  await app.get("logout")();
  assert.equal(app.storage.has("kut_token"), false);
  assert.deepEqual(app.assigned, ["/"]);
});

// ---------------- arranque ----------------

test("al arrancar sin sesión solo pide la configuración", async () => {
  const app = await loadApp();
  assert.deepEqual(app.calls.map((c) => c.url), ["/api/v1/config"]);
  assert.equal(app.get("ME"), null);
});

test("al arrancar con sesión confirma el usuario y lo guarda", async () => {
  const app = await loadApp({ storage: conSesion });
  assert.deepEqual(app.calls.map((c) => c.url), ["/api/v1/config", "/api/v1/me"]);
  assert.equal(app.get("ME").email, ME.email);
  assert.equal(JSON.parse(app.storage.get("kut_me")).email, ME.email);
});

test("al arrancar cierra la sesión si el servidor la rechaza y no se puede renovar", async () => {
  const app = await loadApp({
    storage: { ...conSesion, kut_me: JSON.stringify(ME) },
    fetch: (url) => {
      if (url === "/api/v1/me") return respond(401, {});
      if (url === COGNITO_URL) return respond(400, { __type: "NotAuthorizedException" });
      return backend(url);
    },
  });
  assert.equal(app.storage.size, 0);
  assert.equal(app.get("ME"), null);
});

test("al arrancar conserva la sesión si falla la red", async () => {
  const app = await loadApp({
    storage: { ...conSesion, kut_me: JSON.stringify(ME) },
    fetch: (url) => {
      if (url === "/api/v1/me") throw new TypeError("Failed to fetch");
      return backend(url);
    },
  });
  assert.equal(app.storage.get("kut_token"), "token-viejo");
  assert.equal(app.get("ME").email, ME.email); // sigue usando el usuario guardado
});

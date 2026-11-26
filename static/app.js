// kut.nz — frontend sin dependencias. Consume la misma API REST que cualquier cliente.
"use strict";

// Atajos del DOM: $ devuelve el primer elemento, $$ un arreglo, h() crea un elemento con atributos e hijos.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
};

let CONFIG = null;
let ME = null;

// ---------------- cuenta: login propio contra la API de Cognito (sin la página genérica) ----------------
// localStorage: la sesión sobrevive a recargas y pestañas nuevas (los tokens duran 1 h y se renuevan).
const store = localStorage;
const SESSION_KEYS = ["kut_token", "kut_refresh", "kut_me"];
const token = () => store.getItem("kut_token");
const clearSession = () => SESSION_KEYS.forEach((k) => store.removeItem(k));

const COGNITO_ERRORS = {
  NotAuthorizedException: "Correo o contraseña incorrectos.",
  UserNotFoundException: "Correo o contraseña incorrectos.",
  UsernameExistsException: "Ya existe una cuenta con ese correo. Intenta entrar.",
  InvalidPasswordException: "La contraseña no cumple los requisitos: mínimo 10 caracteres, una minúscula y un número.",
  CodeMismatchException: "El código no es correcto.",
  ExpiredCodeException: "El código expiró. Pide uno nuevo.",
  LimitExceededException: "Demasiados intentos. Espera unos minutos.",
  TooManyRequestsException: "Demasiados intentos. Espera unos minutos.",
  TooManyFailedAttemptsException: "Demasiados intentos. Espera unos minutos.",
  InvalidParameterException: "Revisa los datos que escribiste.",
};

async function cognito(action, body) {
  const r = await fetch(`https://cognito-idp.${CONFIG.cognito_region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const type = (data.__type || "").split("#").pop();
    const err = new Error(COGNITO_ERRORS[type] || data.message || "No se pudo completar. Intenta de nuevo.");
    err.type = type;
    throw err;
  }
  return data;
}

// Guarda los tokens de Cognito; el refresh token solo llega al iniciar sesión, no al renovar.
function saveSession(result) {
  store.setItem("kut_token", result.AccessToken);
  if (result.RefreshToken) store.setItem("kut_refresh", result.RefreshToken);
}

// Renueva el access token con el refresh token. Devuelve false si no hay sesión o en modo dev.
async function refresh() {
  const rt = store.getItem("kut_refresh");
  if (!rt || CONFIG.auth_mode === "dev") return false;
  try {
    const { AuthenticationResult } = await cognito("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: CONFIG.cognito_client_id, AuthParameters: { REFRESH_TOKEN: rt },
    });
    saveSession(AuthenticationResult);
    return true;
  } catch { return false; }
}

// Cierra la sesión en Cognito (si aplica) y borra los tokens locales.
async function logout() {
  if (CONFIG.auth_mode !== "dev" && token()) {
    await cognito("GlobalSignOut", { AccessToken: token() }).catch(() => {});
  }
  clearSession();
  location.assign("/");
}

// ----- ventana de cuenta -----
const AUTH = {
  signin: { title: "Hola de nuevo", sub: "Entra para administrar tus enlaces.", submit: "Entrar", fields: ["email", "password"], tabs: true },
  signup: { title: "Crea tu cuenta", sub: "Alias, caducidad, contraseña y métricas para tus enlaces.", submit: "Crear cuenta", fields: ["email", "password", "rules"], tabs: true },
  confirm: { title: "Revisa tu correo", sub: "", submit: "Confirmar", fields: ["code"] },
  forgot: { title: "Recupera tu cuenta", sub: "Te enviaremos un código para elegir una nueva contraseña.", submit: "Enviar código", fields: ["email"] },
  reset: { title: "Nueva contraseña", sub: "", submit: "Guardar contraseña", fields: ["code", "password", "rules"] },
};
let authMode = "signin";
let pendingPassword = "";

function setAuthMode(mode, { ok = "", error = "" } = {}) {
  authMode = mode;
  const m = AUTH[mode];
  const email = $("#a-email").value;
  $("#auth-title").textContent = m.title;
  $("#auth-sub").textContent = mode === "confirm" ? `Te enviamos un código a ${email}.`
    : mode === "reset" ? `Escribe el código que enviamos a ${email} y tu nueva contraseña.` : m.sub;
  $("#auth-submit").textContent = m.submit;
  $("#auth-tabs").hidden = !m.tabs;
  $$("#auth-tabs [data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
  $$("#auth-form [data-for]").forEach((el) => (el.hidden = !m.fields.includes(el.dataset.for)));
  $$(".auth-links [data-show]").forEach((el) => (el.hidden = !el.dataset.show.split(" ").includes(mode)));
  $("#a-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  if (mode === "signin" || mode === "signup" || mode === "reset") $("#a-password").value = "";
  $("#a-code").value = "";
  const e = $("#auth-error"); e.textContent = error; e.hidden = !error;
  const o = $("#auth-ok"); o.textContent = ok; o.hidden = !ok;
  if (CONFIG.auth_mode === "dev") $('[data-for="password"]').hidden = true; // en local basta el correo
  setTimeout(() => $(`#auth-form [data-for="${m.fields[0]}"] input`)?.focus(), 30);
}

// Después de entrar o confirmar la cuenta, ir a "Mis enlaces": así se nota que la sesión inició.
function afterLogin() {
  location.assign("/panel");
}

function login(mode = "signin") {
  setAuthMode(mode);
  $("#auth").showModal();
}

async function submitAuth(ev) {
  ev.preventDefault();
  const email = $("#a-email").value.trim().toLowerCase();
  const password = $("#a-password").value;
  const code = $("#a-code").value.trim();
  const btn = $("#auth-submit");
  $("#auth-error").hidden = true;
  if ((authMode === "signup" || authMode === "reset") && CONFIG.auth_mode !== "dev") {
    const problem = passwordProblem(password);
    if (problem) return showAuthError(problem);
  }
  btn.disabled = true;
  try {
    if (CONFIG.auth_mode === "dev") {
      store.setItem("kut_token", `dev:${email.split("@")[0]}`);
      return afterLogin();
    }
    const id = CONFIG.cognito_client_id;
    if (authMode === "signin") {
      try {
        const r = await cognito("InitiateAuth", {
          AuthFlow: "USER_PASSWORD_AUTH", ClientId: id, AuthParameters: { USERNAME: email, PASSWORD: password },
        });
        if (!r.AuthenticationResult) throw new Error("Tu cuenta requiere un paso adicional que esta versión no soporta.");
        saveSession(r.AuthenticationResult);
        return afterLogin();
      } catch (e) {
        if (e.type !== "UserNotConfirmedException") throw e;
        pendingPassword = password;
        await cognito("ResendConfirmationCode", { ClientId: id, Username: email });
        return setAuthMode("confirm", { ok: "Tu cuenta aún no está confirmada. Te mandamos un código nuevo." });
      }
    }
    if (authMode === "signup") {
      await cognito("SignUp", { ClientId: id, Username: email, Password: password,
        UserAttributes: [{ Name: "email", Value: email }] });
      pendingPassword = password;
      return setAuthMode("confirm");
    }
    if (authMode === "confirm") {
      await cognito("ConfirmSignUp", { ClientId: id, Username: email, ConfirmationCode: code });
      if (pendingPassword) {
        const r = await cognito("InitiateAuth", {
          AuthFlow: "USER_PASSWORD_AUTH", ClientId: id, AuthParameters: { USERNAME: email, PASSWORD: pendingPassword },
        });
        saveSession(r.AuthenticationResult);
        return afterLogin();
      }
      return setAuthMode("signin", { ok: "¡Cuenta confirmada! Ya puedes entrar." });
    }
    if (authMode === "forgot") {
      await cognito("ForgotPassword", { ClientId: id, Username: email });
      return setAuthMode("reset");
    }
    if (authMode === "reset") {
      await cognito("ConfirmForgotPassword", { ClientId: id, Username: email, ConfirmationCode: code, Password: password });
      return setAuthMode("signin", { ok: "Contraseña actualizada. Ya puedes entrar." });
    }
  } catch (e) {
    showAuthError(e.message);
  } finally { btn.disabled = false; }
}

function showAuthError(message) {
  const err = $("#auth-error");
  err.textContent = message;
  err.hidden = false;
  // Que el mensaje y el botón queden a la vista aunque la ventana haya crecido.
  const dlg = $("#auth");
  requestAnimationFrame(() => dlg.scrollTo({ top: dlg.scrollHeight, behavior: "smooth" }));
}

// Misma política que el user pool de Cognito: así el aviso es inmediato y dice qué falta.
function passwordProblem(pw) {
  const missing = [];
  if (pw.length < 10) missing.push(`al menos 10 caracteres (llevas ${pw.length})`);
  if (!/[a-z]/.test(pw)) missing.push("una letra minúscula");
  if (!/[0-9]/.test(pw)) missing.push("un número");
  return missing.length ? `A tu contraseña le falta: ${missing.join(", ")}.` : "";
}

$("#auth-form")?.addEventListener("submit", submitAuth);
$("#auth-close")?.addEventListener("click", () => $("#auth").close());
$$("#auth [data-mode]").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.mode)));
$("#auth-resend")?.addEventListener("click", async () => {
  try {
    await cognito("ResendConfirmationCode", { ClientId: CONFIG.cognito_client_id, Username: $("#a-email").value.trim().toLowerCase() });
    setAuthMode("confirm", { ok: "Te enviamos un código nuevo." });
  } catch (e) { setAuthMode("confirm", { error: e.message }); }
});

// ---------------- API ----------------
// Llama a la API con el token actual. Ante un 401 intenta renovar la sesión una sola vez y repite la petición.
async function api(path, { method = "GET", body, headers = {}, retry = true } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token()) opts.headers.Authorization = `Bearer ${token()}`;
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  if (r.status === 401 && token() && retry && await refresh()) return api(path, { method, body, headers, retry: false });
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error?.message || `Error ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// ---------------- navegación (SPA) ----------------
const VIEWS = { "/": "home", "/panel": "panel", "/admin": "admin" };

function navigate(path) {
  history.pushState(null, "", path);
  render();
}

function render() {
  const view = VIEWS[location.pathname] || "home";
  $$("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== view));
  if (view === "panel") { if (!ME) return login(); loadPanel(); startPanelPolling(); } else stopPanelPolling();
  if (view === "admin") { if (!ME?.is_admin) return navigate("/"); loadAdmin(); }
  window.scrollTo({ top: 0 });
}

document.addEventListener("click", (ev) => {
  const a = ev.target.closest("a[data-link]");
  if (a && a.origin === location.origin) { ev.preventDefault(); navigate(a.pathname); }
});
window.addEventListener("popstate", render);

// ---------------- utilidades de UI ----------------
// Las fechas de la API vienen en segundos epoch; los <input type="datetime-local"> usan hora local.
const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—";
const toLocalInput = (ts) => {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

function openModal(title, content) {
  $("#modal-title").textContent = title;
  $("#modal-content").replaceChildren(content);
  $("#modal").showModal();
}
$("#modal-close")?.addEventListener("click", () => $("#modal").close());

// Acción de un botón contra la API: lo deshabilita mientras espera (evita dobles clics) y, si falla,
// muestra el error en lugar de dejarlo solo en la consola. Devuelve true si salió bien.
async function act(btn, run) {
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  try {
    await run();
    return true;
  } catch (e) {
    alert(e.message);
    return false;
  } finally {
    btn.disabled = wasDisabled;
  }
}

async function copy(text, btn) {
  await navigator.clipboard.writeText(text);
  const old = btn.textContent;
  btn.textContent = "¡Copiado!";
  setTimeout(() => (btn.textContent = old), 1400);
}

// ---------------- portada: acortar ----------------
function showResult(link) {
  $("#result").hidden = false;
  $("#result-qr").src = link.qr_svg;
  $("#result-url").textContent = link.short_url;
  $("#result-target").textContent = `→ ${link.target}`;
  $("#dl-png").href = `${link.qr_png}?download=true`;
  $("#dl-svg").href = `${link.qr_svg}?download=true`;
  $("#preview-link").href = `/${link.code}+`;
  $("#copy").onclick = (e) => copy(link.short_url, e.currentTarget);
}

$("#shorten-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#shorten-error");
  err.hidden = true;
  const body = { url: $("#url").value.trim() };
  if (ME) {
    for (const k of ["alias", "title", "password"]) if ($(`#${k}`).value) body[k] = $(`#${k}`).value;
    if ($("#expires").value) body.expires_at = fromLocalInput($("#expires").value);
    if ($("#max_clicks").value) body.max_clicks = Number($("#max_clicks").value);
  }
  const btn = ev.submitter || $("#shorten-form [type=submit]");
  btn.disabled = true;
  try {
    const { data } = await api("/api/v1/links", { method: "POST", body, headers: { "Idempotency-Key": crypto.randomUUID() } });
    showResult(data);
    ev.target.reset();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally { btn.disabled = false; }
});

// ---------------- panel ----------------
let searchTimer;
$("#search")?.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadPanel, 250); });
$("#sort")?.addEventListener("change", loadPanel);

// El panel también se actualiza solo cada 10 s (clics y estado de cada enlace) mientras está visible.
const PANEL_REFRESH_MS = 10000;
let panelTimer = null;

function startPanelPolling() {
  stopPanelPolling();
  panelTimer = setInterval(() => {
    if (location.pathname !== "/panel") return stopPanelPolling();
    if (!document.hidden) loadPanel({ silent: true });
  }, PANEL_REFRESH_MS);
}

function stopPanelPolling() {
  clearInterval(panelTimer);
  panelTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && panelTimer) loadPanel({ silent: true });
});

async function loadPanel({ silent = false } = {}) {
  const q = new URLSearchParams({ q: $("#search").value, sort: $("#sort").value });
  const list = $("#links");
  try {
    const { data, count } = await api(`/api/v1/links?${q}`);
    $("#panel-count").textContent = `${count} enlace${count === 1 ? "" : "s"}`;
    const rows = $$(".link-row[data-code]", list);
    const sameLinks = rows.length === data.length && rows.every((r, i) => r.dataset.code === data[i].code);
    if (silent && sameLinks) {
      // Actualización en su lugar: no mueve la pantalla ni interrumpe un clic.
      rows.forEach((r, i) => r.patch(data[i]));
      return;
    }
    if (silent && $("#modal").open) return; // no redibujar debajo de una ventana abierta
    list.replaceChildren(...(data.length ? data.map(linkRow) : [h("div", { class: "card empty" },
      h("h3", {}, "Aún no tienes enlaces"), h("a", { class: "btn btn-yellow", href: "/", "data-link": true }, "Crear el primero"))]));
  } catch (e) {
    if (!silent) list.replaceChildren(h("p", { class: "error-msg" }, e.message)); // un fallo de fondo no borra la lista
  }
}

const metaText = (l) => `Creado ${fmtDate(l.created_at)} · ${l.clicks}${l.max_clicks ? ` / ${l.max_clicks}` : ""} clics`
  + (l.expires_at ? ` · caduca ${fmtDate(l.expires_at)}` : "");

function linkRow(l) {
  const ref = { l }; // los botones siempre usan los datos más recientes del enlace
  const badge = h("span", { class: `badge ${l.status}` }, l.status);
  const meta = h("div", { class: "meta" }, metaText(l));
  const toggle = h("button", { class: "btn btn-ghost btn-small", disabled: l.disabled_by_admin,
    onclick: (e) => act(e.currentTarget, async () => {
      await api(`/api/v1/links/${ref.l.code}`, { method: "PATCH", body: { disabled: !ref.l.disabled } });
      loadPanel();
    }) },
    l.disabled ? "Reactivar" : "Desactivar");
  const row = h("div", { class: "link-row", "data-code": l.code },
    h("div", {},
      h("div", {}, h("span", { class: "code" }, `kut.nz/${l.code}`), badge,
        l.has_password ? h("span", { class: "badge", title: "Con contraseña" }, "🔒") : null),
      l.title ? h("div", { class: "meta" }, l.title) : null,
      h("div", { class: "target" }, l.target),
      meta),
    h("div", { class: "row" },
      h("button", { class: "btn btn-ghost btn-small", onclick: (e) => copy(ref.l.short_url, e.currentTarget) }, "Copiar"),
      h("button", { class: "btn btn-sky btn-small", onclick: () => showQr(ref.l) }, "QR"),
      h("button", { class: "btn btn-sky btn-small", onclick: () => showStats(ref.l) }, "Métricas"),
      h("button", { class: "btn btn-ghost btn-small", onclick: () => editLink(ref.l) }, "Editar"),
      toggle,
      h("button", { class: "btn btn-ghost btn-small", onclick: (e) => {
        if (!confirm(`¿Borrar kut.nz/${ref.l.code}? Esta acción no se puede deshacer.`)) return;
        return act(e.currentTarget, async () => {
          await api(`/api/v1/links/${ref.l.code}`, { method: "DELETE" });
          loadPanel();
        });
      } }, "Borrar")));
  row.patch = (n) => {
    const moreClicks = n.clicks > ref.l.clicks;
    ref.l = n;
    badge.className = `badge ${n.status}`;
    badge.textContent = n.status;
    meta.textContent = metaText(n);
    toggle.textContent = n.disabled ? "Reactivar" : "Desactivar";
    toggle.disabled = n.disabled_by_admin;
    if (moreClicks) { meta.classList.remove("flash"); void meta.offsetWidth; meta.classList.add("flash"); }
  };
  return row;
}

function showQr(l) {
  openModal(`QR de kut.nz/${l.code}`, h("div", { style: "text-align:center" },
    h("img", { src: l.qr_svg, alt: `QR de ${l.short_url}`, style: "width:260px;height:260px" }),
    h("p", { class: "hint" }, "El QR apunta al enlace corto: sigue funcionando aunque cambies el destino."),
    h("div", { class: "row", style: "justify-content:center" },
      h("a", { class: "btn btn-dark btn-small", href: `${l.qr_png}?download=true` }, "Descargar PNG"),
      h("a", { class: "btn btn-sky btn-small", href: `${l.qr_svg}?download=true` }, "Descargar SVG"))));
}

function editLink(l) {
  const f = (id, label, input) => h("div", { class: "field" }, h("label", { for: id }, label), input);
  const form = h("form", {},
    h("div", { class: "grid-form" },
      f("e-url", "Destino", h("input", { id: "e-url", type: "url", value: l.target, required: true })),
      f("e-title", "Nombre", h("input", { id: "e-title", value: l.title || "" })),
      f("e-exp", "Caduca el (vacío = nunca)", h("input", { id: "e-exp", type: "datetime-local", value: toLocalInput(l.expires_at) })),
      f("e-max", "Máximo de clics (vacío = sin límite)", h("input", { id: "e-max", type: "number", min: 1, value: l.max_clicks ?? "" })),
      f("e-pwd", l.has_password ? "Nueva contraseña (vacío = conservar)" : "Contraseña (opcional)", h("input", { id: "e-pwd", type: "password" }))),
    l.has_password ? h("label", { style: "display:block;margin-top:10px" }, h("input", { id: "e-nopwd", type: "checkbox" }), " Quitar contraseña") : null,
    h("p", { class: "error-msg", id: "e-err", hidden: true }),
    h("p", {}, h("button", { class: "btn btn-dark" }, "Guardar cambios")));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body = { url: $("#e-url").value, title: $("#e-title").value,
      expires_at: fromLocalInput($("#e-exp").value), max_clicks: $("#e-max").value ? Number($("#e-max").value) : null };
    if ($("#e-pwd").value) body.password = $("#e-pwd").value;
    else if ($("#e-nopwd")?.checked) body.password = "";
    try {
      await api(`/api/v1/links/${l.code}`, { method: "PATCH", body });
      $("#modal").close(); loadPanel();
    } catch (e) { const er = $("#e-err"); er.textContent = e.message; er.hidden = false; }
  });
  openModal(`Editar kut.nz/${l.code}`, form);
}

function breakdown(title, obj) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return h("div", { class: "breakdown" }, h("h4", {}, title),
    entries.length ? entries.map(([k, v]) => h("div", { class: "meter" }, h("span", {}, k), h("b", {}, String(v)),
      h("i", { style: `--w:${(v / max) * 100}%` }))) : h("p", { class: "hint" }, "Sin datos todavía"));
}

// Métricas en vivo: mientras la ventana está abierta se vuelven a pedir cada 10 s.
// Se pausa si la pestaña no está visible y se detiene al cerrar la ventana (no gasta peticiones de más).
const STATS_REFRESH_MS = 10000;
let statsTimer = null;
let lastStats = null;

function stopStats() {
  clearInterval(statsTimer);
  statsTimer = null;
  lastStats = null;
}

async function showStats(l) {
  stopStats();
  openModal(`Métricas de kut.nz/${l.code}`, h("p", {}, "Cargando…"));
  const modal = $("#modal");
  modal.addEventListener("close", stopStats, { once: true });
  await refreshStats(l);
  statsTimer = setInterval(() => {
    if (!modal.open) return stopStats();
    if (!document.hidden) refreshStats(l);
  }, STATS_REFRESH_MS);
}

// Al volver a la pestaña, actualiza de inmediato en lugar de esperar al siguiente ciclo.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && statsTimer && lastStats) refreshStats(lastStats.link);
});

async function refreshStats(l) {
  let s;
  try {
    ({ data: s } = await api(`/api/v1/links/${l.code}/stats`));
  } catch (e) {
    // Un fallo momentáneo no borra lo que ya se ve; solo lo indica.
    const live = $("#live-status");
    if (live) live.textContent = "Sin conexión, reintentando…";
    else $("#modal-content").replaceChildren(h("p", { class: "error-msg" }, e.message));
    return;
  }
  if (!$("#modal").open) return;
  const prev = lastStats?.data;
  lastStats = { link: l, data: s };
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push([d, s.by_day[d] || 0]);
  }
  const max = Math.max(1, ...days.map((d) => d[1]));
  const kpi = (value, before, label) => h("div", { class: `kpi${before != null && value > before ? " bump" : ""}` },
    h("b", {}, String(value)), label);
  const hora = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("#modal-content").replaceChildren(h("div", {},
    h("p", { class: "live" }, h("span", { class: "live-dot", "aria-hidden": "true" }),
      h("span", { id: "live-status" }, `En vivo · actualizado a las ${hora}`)),
    h("div", { class: "kpis" },
      kpi(s.total, prev?.total, "clics totales"),
      kpi(s.unique_visitors, prev?.unique_visitors, "visitantes únicos (aprox.)"),
      kpi(Object.keys(s.country).length, prev && Object.keys(prev.country).length, "países")),
    h("h4", { style: "margin:0" }, "Clics por día (últimos 30 días)"),
    h("div", { class: "bars", role: "img", "aria-label": "Gráfica de clics por día" },
      days.map(([d, n]) => h("div", { style: `height:${(n / max) * 100}%`, title: `${d}: ${n}` }))),
    h("div", { class: "breakdowns" },
      breakdown("País", s.country), breakdown("Dispositivo", s.device), breakdown("Navegador", s.browser),
      breakdown("Sistema operativo", s.os), breakdown("Sitio de origen", s.referer)),
    h("p", { class: "hint" }, "Se actualiza sola cada 10 segundos. Los clics se procesan en segundo plano, así que pueden tardar unos segundos en aparecer. No guardamos IPs y filtramos bots conocidos.")));
}

// ---------------- admin ----------------
async function loadAdmin() {
  const { data } = await api("/api/v1/admin/reports");
  $("#reports").replaceChildren(...(data.length ? data.map((r) => h("div", { class: "link-row" },
    h("div", {}, h("span", { class: "code" }, `kut.nz/${r.code}`), h("div", { class: "meta" }, `${fmtDate(r.created_at)} · ${r.reason || "sin motivo"}`)),
    h("div", { class: "row" },
      h("a", { class: "btn btn-ghost btn-small", href: `/${r.code}+`, target: "_blank", rel: "noopener" }, "Ver destino"),
      h("button", { class: "btn btn-dark btn-small", onclick: (e) => {
        // e.currentTarget vale null después del await: se guarda el botón antes.
        const btn = e.currentTarget;
        return act(btn, async () => {
          await api(`/api/v1/admin/links/${r.code}/disable`, { method: "POST" });
          btn.textContent = "Desactivado";
        });
      } }, "Desactivar")))) : [h("p", { class: "hint" }, "No hay reportes.")]));
}

function adminForm(id, run) {
  $(id)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = $("input", ev.target);
    try { await run(input.value.trim()); input.value = ""; alert("Listo."); } catch (e) { alert(e.message); }
  });
}
adminForm("#block-domain", (domain) => api("/api/v1/admin/blocked-domains", { method: "POST", body: { domain } }));
adminForm("#block-user", (user_id) => api("/api/v1/admin/blocked-users", { method: "POST", body: { user_id } }));
adminForm("#disable-link", (code) => api(`/api/v1/admin/links/${code}/disable`, { method: "POST" }));

// ---------------- arranque ----------------
function applyAuthUI() {
  $$("[data-auth]").forEach((el) => {
    const need = el.dataset.auth;
    el.hidden = need === "in" ? !ME : need === "out" ? !!ME : !ME?.is_admin;
  });
  document.body.classList.add("auth-ready");
}

(async function init() {
  // Recarga sin parpadeo: si ya había sesión, pintamos el menú de inmediato con los datos guardados
  // y la confirmamos con el servidor por detrás.
  if (token()) {
    try { ME = JSON.parse(store.getItem("kut_me") || "null"); } catch { ME = null; }
    if (ME) applyAuthUI();
  }
  CONFIG = (await api("/api/v1/config")).data;
  if (location.pathname === "/auth/callback") history.replaceState(null, "", "/"); // ruta del login anterior
  if (token()) {
    try {
      ME = (await api("/api/v1/me")).data; // si el token venció, api() lo renueva con el refresh token
      store.setItem("kut_me", JSON.stringify(ME));
    } catch (e) {
      // Solo cerramos la sesión si el servidor la rechaza; un error de red no debe sacarte.
      if (e.status === 401 || e.status === 403) { clearSession(); ME = null; }
    }
  }
  applyAuthUI();
  $("#login")?.addEventListener("click", () => login("signin"));
  $$("[data-open-auth]").forEach((b) => b.addEventListener("click", () => login(b.dataset.openAuth)));
  $("#logout")?.addEventListener("click", logout);
  render();
})();

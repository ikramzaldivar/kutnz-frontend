// Carga static/app.js en un contexto aislado de node:vm con un DOM, localStorage y fetch mínimos.
// Así se prueba el archivo tal cual se publica, sin bundler ni dependencias.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../static/app.js", import.meta.url), "utf8");

export const CONFIG = {
  base_url: "https://kut.nz",
  host: "kut.nz",
  auth_mode: "cognito",
  cognito_domain: "kutnz.auth.us-east-1.amazoncognito.com",
  cognito_client_id: "client-123",
  cognito_region: "us-east-1",
};

export const ME = { id: "u1", email: "ana@example.com", is_admin: false };

// Respuesta con la forma que usa app.js (ok, status y json()). Sin body, json() falla como con un 502 de HTML.
export function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  };
}

// Lo que contesta el backend si la prueba no dice otra cosa.
export function backend(url) {
  if (url === "/api/v1/config") return respond(200, { data: CONFIG });
  if (url === "/api/v1/me") return respond(200, { data: ME });
  return respond(404, { error: { message: "No encontrado" } });
}

class FakeNode {}

class FakeText extends FakeNode {
  constructor(text) { super(); this.textContent = String(text); }
}

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.className = "";
    this.attributes = {};
    this.listeners = {};
    this.children = [];
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  append(...nodes) { this.children.push(...nodes); }
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Ejecuta app.js (incluido su arranque) y espera a que termine.
 * - fetch: manejador (url, opts) => respuesta; se puede cambiar después con app.fetch = ...
 * - storage: contenido inicial de localStorage.
 */
export async function loadApp({ fetch = backend, storage = {}, pathname = "/" } = {}) {
  const items = new Map(Object.entries(storage));
  const app = { fetch, calls: [], storage: items, assigned: [] };
  const noop = () => {};

  const ctx = vm.createContext({
    document: {
      hidden: false,
      body: { classList: { add: noop } },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: (tag) => new FakeElement(tag),
      createTextNode: (text) => new FakeText(text),
    },
    window: { addEventListener: noop, scrollTo: noop },
    location: { pathname, origin: "https://kut.nz", assign: (url) => app.assigned.push(url) },
    history: { pushState: noop, replaceState: noop },
    localStorage: {
      getItem: (k) => (items.has(k) ? items.get(k) : null),
      setItem: (k, v) => items.set(k, String(v)),
      removeItem: (k) => items.delete(k),
    },
    fetch: async (url, opts = {}) => {
      app.calls.push({ url, ...opts });
      return app.fetch(url, opts);
    },
    Node: FakeNode,
    URLSearchParams,
    crypto: globalThis.crypto,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: noop,
  });

  vm.runInContext(SRC, ctx, { filename: "static/app.js" });
  await settle();

  // Las declaraciones de nivel superior (const, let y function) se leen con su nombre.
  app.get = (name) => vm.runInContext(name, ctx);
  return app;
}

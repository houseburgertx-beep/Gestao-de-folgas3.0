import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const loader = source.slice(source.indexOf("function installDeferredCopilot("), source.indexOf("\ninstallDeferredCopilot();"));

function setup(load) {
  let handler;
  let removed = false;
  let clicks = 0;
  const attributes = new Map();
  const button = {
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    click: () => { clicks++; },
  };
  const context = {
    document: {
      addEventListener(type, callback, capture) { assert.equal(type, "click"); assert.equal(capture, true); handler = callback; },
      removeEventListener(type, callback, capture) { assert.equal(callback, handler); assert.equal(capture, true); removed = true; },
    },
    window: {},
    console: { warn() {} },
  };
  vm.runInNewContext(`${loader}\nthis.install = installDeferredCopilot;`, context);
  context.install(load);
  const tap = () => handler({ target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} });
  return { tap, attributes, get clicks() { return clicks; }, get removed() { return removed; } };
}

test("assistant stays off startup and the first tap survives lazy loading", async () => {
  let requested = 0;
  let initialize = 0;
  let release;
  const app = setup(() => { requested++; return new Promise((resolve) => { release = resolve; }); });
  assert.equal(requested, 0);
  const first = app.tap();
  await app.tap();
  assert.equal(requested, 1);
  assert.equal(app.attributes.get("aria-busy"), "true");
  release({ initCopilot() { initialize++; } });
  await first;
  assert.equal(initialize, 1);
  assert.equal(app.clicks, 1);
  assert.equal(app.removed, true);
  assert.equal(app.attributes.has("aria-busy"), false);
});

test("failed download leaves the assistant usable on the next tap", async () => {
  let attempts = 0;
  const app = setup(async () => {
    if (++attempts === 1) throw new Error("offline");
    return { initCopilot() {} };
  });
  await app.tap();
  assert.equal(app.removed, false);
  assert.equal(app.attributes.has("aria-busy"), false);
  await app.tap();
  assert.equal(app.clicks, 1);
  assert.equal(app.removed, true);
});

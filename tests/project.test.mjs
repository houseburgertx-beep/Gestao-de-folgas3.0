import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApi } from "../src/core/api.js";
import {
  dateRange,
  haversineMeters,
  minutesText,
  todayIso,
} from "../src/core/utils.js";

test("a API cobre todas as funções declaradas pela interface", async () => {
  const source = await readFile(
    new URL("../src/legacy/Scripts.html", import.meta.url),
    "utf8",
  );
  const block = source.match(/const FN = \{([\s\S]*?)\n  \};/)?.[1] || "";
  const declared = [...block.matchAll(/:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map(
    (match) => match[1],
  );
  const handlers = createApi(() => ({})).handlers;
  const missing = declared.filter((name) => typeof handlers[name] !== "function");
  assert.deepEqual(missing, []);
  assert.ok(Object.keys(handlers).length >= 90);
});

test("as regras do Realtime Database são JSON válido e começam bloqueadas", async () => {
  const rules = JSON.parse(
    await readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
  );
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.ok(rules.rules["gestao-folgas"].v2.access);
  assert.ok(rules.rules["gestao-folgas"].v2.tables);
});

test("o index preserva a interface sem marcação de template do Apps Script", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /Gestão de Folgas/);
  assert.match(html, /src\/main\.js/);
  assert.doesNotMatch(html, /<\?(?:=|!=)/);
  assert.match(html, /id="view-timeclock"/);
  assert.match(html, /id="view-house-arena"/);
});

test("utilitários de data, duração e geolocalização", () => {
  assert.equal(todayIso(new Date(2026, 6, 28, 12)), "2026-07-28");
  assert.deepEqual(dateRange("2026-07-28", "2026-07-30"), [
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
  ]);
  assert.equal(minutesText(125), "2h 05min");
  assert.equal(Math.round(haversineMeters(-3.73, -38.52, -3.73, -38.52)), 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../src/legacy/Scripts.html", import.meta.url),
  "utf8",
);
const html = await readFile(
  new URL("../src/legacy/Index.html", import.meta.url),
  "utf8",
);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function presenceHarness(employee = false) {
  const nodes = new Map();
  const $ = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        value: "",
        innerHTML: "",
        textContent: "",
        classList: { add() {}, remove() {} },
      });
    return nodes.get(key);
  };
  const state = {
    stores: [
      { LojaID: "l1", Nome: "Centro" },
      { LojaID: "l2", Nome: "Sul" },
    ],
    livePresenceData: {
      presence: Array.from({ length: 8 }, (_, i) => ({
        Nome: i === 0 ? "<img src=x onerror=alert(1)>" : `Pessoa ${i}`,
        Cargo: "Atendente",
        LojaID: i % 2 ? "l1" : "l2",
        status: i < 6 ? "trabalhando" : "intervalo",
        statusLabel: "Trabalhando",
        entryTime: "16:00",
        elapsedTexto: "2h",
      })),
    },
  };
  const body = source.slice(
    source.indexOf("  function renderLivePresence_()"),
    source.indexOf("  async function openWhatsAppScheduleDialog_"),
  );
  const render = new Function(
    "state",
    "$",
    "arr",
    "esc",
    "isEmployee",
    "idOf",
    "val",
    `${body};return renderLivePresence_;`,
  )(
    state,
    $,
    (x) => (Array.isArray(x) ? x : []),
    escape,
    () => employee,
    (o, type) => o[`${type}ID`],
    (o, key) => o[key],
  );
  return { state, $, render };
}
test("equipe começa com cinco pessoas, expande e filtra sem perder estado", () => {
  const { state, $, render } = presenceHarness();
  render();
  assert.equal(
    ($("#livePresenceGrid").innerHTML.match(/<details/g) || []).length,
    5,
  );
  assert.equal($("#presenceMore").hidden, false);
  $("#presenceMore").onclick();
  assert.equal(
    ($("#livePresenceGrid").innerHTML.match(/<details/g) || []).length,
    8,
  );
  $("#presenceStoreFilter").value = "l1";
  $("#presenceStoreFilter").onchange();
  assert.equal(
    ($("#livePresenceGrid").innerHTML.match(/<details/g) || []).length,
    4,
  );
  state.presenceFilter = "intervalo";
  render();
  assert.equal(
    ($("#livePresenceGrid").innerHTML.match(/<details/g) || []).length,
    1,
  );
  $("#presenceSearch").value = "inexistente";
  $("#presenceSearch").oninput();
  assert.match($("#livePresenceGrid").innerHTML, /Nenhuma pessoa/);
});
test("nomes da equipe são escapados e funcionário não recebe quadro gerencial", () => {
  const first = presenceHarness();
  first.render();
  assert.doesNotMatch(first.$("#livePresenceGrid").innerHTML, /<img/);
  assert.match(first.$("#livePresenceGrid").innerHTML, /&lt;img/);
  const second = presenceHarness(true);
  second.render();
  assert.equal(second.$("#livePresenceGrid").innerHTML, "");
});
test("navegação mantém destinos existentes e não duplica identificadores", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/data-view(?:-target)?="([^"]+)"/g))
    assert.ok(ids.includes(`view-${match[1]}`), match[1]);
});

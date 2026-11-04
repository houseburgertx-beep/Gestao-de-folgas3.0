import assert from "node:assert/strict";
import test from "node:test";
import { checkClockGeofence, chooseClockStoreLocation, coordinateNumber } from "../src/core/clock-geofence.js";
import { createClockHandlers } from "../src/core/api-clock.js";
import { clockAttemptStore } from "../src/core/clock-punch-recovery.js";
import { runtime } from "../src/core/runtime.js";

const center = { LojaID: "current-store", Latitude: -17, Longitude: -39, RaioMetros: 150, Ativo: true };
const position = (distance = 0, accuracy = 20) => ({ latitude: -17 + distance / 111195, longitude: -39, accuracy });
const requestId = "11223344-abcd-1234-abcd-123456789012";
const image = "data:image/jpeg;base64," + Buffer.alloc(1100, 1).toString("base64");

test("GPS aproximado só é aceito com círculo inteiro dentro do raio oficial configurado", () => {
  const broad = { ...center, RaioMetros: 10000 };
  assert.equal(checkClockGeofence(position(2000, 1500), broad).mode, "coarse-contained");
  assert.equal(checkClockGeofence(position(0, 5000), broad).mode, "coarse-contained");
  for (const [location, device] of [[center, position(0, 500)], [broad, position(9500, 600)], [broad, position(11000, 2000)], [broad, position(0, 5001)]]) {
    assert.throws(() => checkClockGeofence(device, location), (error) => error.code === "clock/location-imprecise" && error.geoValidated === false);
  }
  assert.equal(checkClockGeofence(position(230, 150), center).mode, "precise");
  assert.throws(() => checkClockGeofence(position(400, 350), center), { code: "clock/location-outside" });
});

test("cadastro decimal com vírgula funciona; coordenadas vazias, zero e raio infinito são configuração inválida", () => {
  assert.equal(coordinateNumber(" -17,123 "), -17.123);
  assert.equal(checkClockGeofence(position(), { ...center, Latitude: "-17,0", Longitude: "-39,0", RaioMetros: "150" }).distance, 0);
  for (const location of [{ ...center, Latitude: null }, { ...center, Longitude: " " }, { ...center, Latitude: 0, Longitude: 0 }, { ...center, RaioMetros: Infinity }]) {
    assert.throws(() => checkClockGeofence(position(), location), (error) => error.code === "clock/location-config" && error.geoValidated === false);
  }
  assert.throws(() => checkClockGeofence({ ...position(), latitude: false }, center), { code: "clock/location-invalid" });
});

test("seleção ignora primeira localização inativa ou antiga e nunca escolhe outra loja", () => {
  const locations = [
    { ...center, LocalPontoID: "inactive", Ativo: false, DataAtualizacao: "2026-11-04" },
    { ...center, LocalPontoID: "old", DataAtualizacao: "2026-01-01" },
    { ...center, LojaID: "other-store", LocalPontoID: "other", DataAtualizacao: "2026-12-01" },
    { ...center, LocalPontoID: "current", DataAtualizacao: "2026-11-03" },
  ];
  assert.equal(chooseClockStoreLocation(locations, "current-store").LocalPontoID, "current");
  assert.throws(() => chooseClockStoreLocation([locations[0]], "current-store"), { code: "clock/location-inactive" });
});

async function withClockFixture(run) {
  const names = ["auth", "requireProfile", "getById", "getByIdFromServer", "requestServerRecord", "createClockRecord", "listWhere", "list", "listPeriods", "create", "invalidateTableCache", "invoke"];
  const original = Object.fromEntries(names.map((name) => [name, runtime[name]]));
  const originalFetch = globalThis.fetch;
  const state = { profileStore: "current-store", employeeStore: "current-store", queryDenied: false, locations: [{ ...center, LocalPontoID: "real-location" }], officialStore: null, serverOffline: false };
  const records = [];
  const queries = [];
  runtime.auth = { currentUser: { uid: "geo-owner", getIdToken: async () => "test-token" } };
  runtime.requireProfile = async () => ({ UsuarioID: "geo-owner", FuncionarioID: "geo-employee", LojaID: state.profileStore, Ativo: true });
  runtime.getById = async (table) => table === "Funcionarios"
    ? { FuncionarioID: "geo-employee", LojaID: state.employeeStore, Ativo: true }
    : table === "Lojas" ? state.officialStore : null;
  runtime.listWhere = async (_, __, storeId) => {
    queries.push(storeId);
    if (storeId === state.employeeStore && state.queryDenied) throw Object.assign(new Error("Permission denied"), { code: "database/permission-denied" });
    return storeId === state.employeeStore ? state.locations : [{ ...center, LojaID: "old-store", Latitude: -10, Longitude: -40 }];
  };
  runtime.list = async () => [];
  runtime.listPeriods = async () => [...records];
  runtime.requestServerRecord = async (_, id) => {
    if (state.serverOffline) throw new Error("server offline");
    return { data: records.find((row) => row.RegistroPontoID === id) || null, etag: '"empty"' };
  };
  runtime.getByIdFromServer = async (_, id) => records.find((row) => row.RegistroPontoID === id) || null;
  runtime.createClockRecord = async (record) => { records.push(record); return record; };
  runtime.create = async (_, record) => record;
  runtime.invalidateTableCache = () => {};
  runtime.invoke = async () => {};
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, fileId: "confirmed-real-file" }));
  const payload = { ...position(), requestId, capturedAt: new Date().toISOString(), expectedAction: "ENTRADA", selfieDataUrl: image };
  try { await run({ state, records, queries, payload, handler: createClockHandlers().registerTimeClockPunch }); }
  finally {
    await clockAttemptStore.remove("geo-owner", requestId);
    Object.assign(runtime, original);
    globalThis.fetch = originalFetch;
  }
}

test("perfil de loja divergente explica o vínculo antes de enviar foto ou gravar em unidade não autorizada", () => withClockFixture(async ({ state, handler, payload, records, queries }) => {
  state.profileStore = "old-store";
  await assert.rejects(handler([payload]),error=>error.code==='clock/location-access'&&error.geoValidated===false);
  assert.equal(records.length,0);
  assert.equal(await clockAttemptStore.get("geo-owner",requestId),null);
  assert.deepEqual(queries,["old-store"]);
}));

test("sem centro cadastrado usa somente as coordenadas oficiais da própria unidade", () => withClockFixture(async ({ state, handler, payload, records }) => {
  state.locations = [];
  await assert.rejects(handler([payload]),error=>error.code==='clock/location-config');
  assert.equal(records.length,0);
  state.officialStore={...center,NomeLoja:'Unidade atual'};
  const result=await handler([payload]);assert.equal(result.data.LocalizacaoOrigem,'Lojas');assert.equal(records.length,1);
}));

test("recuperação de captura validada não depende de configuração GPS alterada depois", () => withClockFixture(async ({ state, handler, payload, records }) => {
  state.serverOffline = true;
  await assert.rejects(handler([payload]), /server offline/);
  assert.equal((await clockAttemptStore.get("geo-owner", requestId)).record.LocalPontoID, "real-location");
  state.serverOffline = false;
  state.locations = [{ ...center, Ativo: false }];
  const result = await handler([{ requestId }]);
  assert.equal(result.data.DataHora, payload.capturedAt);
  assert.equal(result.data.SelfieDriveFileID, "confirmed-real-file");
  assert.equal(records.length, 1);
}));

test("GPS aproximado contido registra modo, raio e horário real da leitura sem alterar a captura", () => withClockFixture(async ({ state, handler, payload }) => {
  state.locations[0].RaioMetros = 10000;
  payload.accuracy = 1500;
  payload.capturedAt = new Date(Date.now() - 120000).toISOString();
  payload.locationTimestamp = Date.now();
  const result = await handler([payload]);
  assert.equal(result.data.LocalizacaoValidacao, "coarse-contained");
  assert.equal(result.data.RaioValidadoMetros, 10000);
  assert.equal(result.data.DataHora, payload.capturedAt);
  assert.equal(result.data.LocalizacaoDataHora, new Date(payload.locationTimestamp).toISOString());
  assert.equal(result.data.LocalizacaoPosteriorCaptura, true);
}));

test("erro GPS definitivo informa que nenhuma geolocalização foi validada para renovar a captura", () => withClockFixture(async ({ state, handler, payload, records }) => {
  state.profileStore = "current-store";
  payload.accuracy = 1000;
  payload.locationTimestamp = Date.now();
  await assert.rejects(handler([payload]), (error) => {
    assert.equal(error.code, "clock/location-imprecise");
    assert.equal(error.geoValidated, false);
    assert.equal(error.capturedAt, payload.capturedAt);
    assert.equal(error.locationTimestamp, payload.locationTimestamp);
    return true;
  });
  assert.equal(records.length, 0);
  assert.equal(await clockAttemptStore.get("geo-owner", requestId), null);
}));

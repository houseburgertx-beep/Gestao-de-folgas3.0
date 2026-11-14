import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { FirebaseRuntime, tableCacheTtl } from "../src/core/runtime.js";
import {
  PUBLIC_AUTH_TABLES,
  STORE_SCOPED_FIELDS,
  EMPLOYEE_SCOPED_FIELDS,
  ID_FIELDS,
} from "../src/core/constants.js";

function createMemoryStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
  };
}

test("tableCacheTtl aplica janelas diferenciadas preservando 15s para ponto e notificacoes", () => {
  assert.equal(tableCacheTtl("RegistrosPonto"), 15000);
  assert.equal(tableCacheTtl("AjustesPonto"), 15000);
  assert.equal(tableCacheTtl("Notificacoes"), 15000);
  assert.equal(tableCacheTtl("Tarefas"), 90000);
  assert.equal(tableCacheTtl("Documentos"), 300000);
  assert.equal(tableCacheTtl("Funcionarios"), 300000);
  assert.equal(tableCacheTtl("Lojas"), 1800000);
  assert.equal(tableCacheTtl("Configuracoes"), 1800000);
});

test("cache persistente em navegador evita re-downloads ao recarregar e limpa ao gravar", async () => {
  const prevLocal = globalThis.localStorage;
  const prevSession = globalThis.sessionStorage;
  const local = createMemoryStorage();
  const session = createMemoryStorage();
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;

  try {
    const profile = { Perfil: "Administrador", FuncionarioID: "admin-1", LojaID: "" };
    const rt1 = new FirebaseRuntime();
    rt1.auth = { currentUser: { uid: "uid-1" } };

    let lojasReads = 0;
    let docsReads = 0;
    rt1.fetchScopedRows_ = async (table) => {
      if (table === "Lojas") {
        lojasReads += 1;
        return [{ LojaID: "loja-1", NomeLoja: "Loja Matriz" }];
      }
      if (table === "Documentos") {
        docsReads += 1;
        return [{ DocumentoID: "doc-1", Titulo: "Holerite" }];
      }
      return [];
    };

    const lojas1 = await rt1.list("Lojas", { profile });
    const docs1 = await rt1.list("Documentos", { profile });
    assert.equal(lojas1[0].LojaID, "loja-1");
    assert.equal(docs1[0].DocumentoID, "doc-1");
    assert.equal(lojasReads, 1);
    assert.equal(docsReads, 1);
    assert.equal(local.length, 1);
    assert.equal(session.length, 1);

    // Simula recarregamento de pagina (nova instancia de runtime)
    const rt2 = new FirebaseRuntime();
    rt2.auth = { currentUser: { uid: "uid-1" } };
    let rt2Reads = 0;
    rt2.fetchScopedRows_ = async () => {
      rt2Reads += 1;
      return [];
    };

    const lojas2 = await rt2.list("Lojas", { profile });
    const docs2 = await rt2.list("Documentos", { profile });
    assert.equal(lojas2[0].NomeLoja, "Loja Matriz");
    assert.equal(docs2[0].Titulo, "Holerite");
    assert.equal(rt2Reads, 0, "Nao deve baixar Lojas/Documentos novamente dentro do TTL persistente");

    // Invalida apenas Documentos: Lojas permanece no localStorage
    rt2.invalidateTableCache("Documentos");
    assert.equal(session.length, 0);
    assert.equal(local.length, 1);

    await rt2.list("Documentos", { profile });
    assert.equal(rt2Reads, 1);

    // Payload gigante (> 1.5 MB) nao estoura Web Storage e nao persiste lixo pesado
    rt2.invalidateTableCache("Documentos");
    rt2.fetchScopedRows_ = async () => [
      { DocumentoID: "doc-big", Payload: "x".repeat(1600000) },
    ];
    const big = await rt2.list("Documentos", { profile });
    assert.equal(big.length, 1);
    assert.equal(session.length, 0);

    // Logout / clear geral limpa todo cache persistente da raiz
    rt2.invalidateTableCache();
    assert.equal(local.length, 0);
  } finally {
    if (prevLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLocal;
    if (prevSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prevSession;
  }
});

test("fetchScopedRows_ restringe Tarefas e Documentos de gestores por loja/colaborador sem baixar tabela inteira", async () => {
  const source = await readFile(new URL("../src/core/runtime.js", import.meta.url), "utf8");
  const start = source.indexOf("  async fetchScopedRows_(table, profile)");
  const code = source
    .slice(start, source.indexOf("\n  async list(table", start))
    .replace("async fetchScopedRows_", "async function fetchScopedRows_");

  const requests = [];
  const context = {
    PUBLIC_AUTH_TABLES,
    STORE_SCOPED_FIELDS,
    EMPLOYEE_SCOPED_FIELDS,
    ID_FIELDS,
    uuid: () => "id-mock",
    isPermissionDenied: () => false,
    isAdminProfile: (p) => p.Perfil === "Administrador",
    isEmployeeProfile: (p) => p.Perfil === "Funcionário",
    isStoreReaderProfile: (p) => ["Gerente", "Responsável de loja"].includes(p.Perfil),
    get: async (request) => {
      requests.push(request);
      return [];
    },
    query: (path, ...conditions) => ({ path, conditions }),
    orderByChild: (field) => ({ field }),
    equalTo: (value) => ({ value }),
  };

  vm.runInNewContext(`${code}\nthis.read = fetchScopedRows_;`, context);
  const app = {
    appRef: (path) => path,
    recordsFromSnapshot: (_table, snapshot) => snapshot,
  };

  await context.read.call(app, "Tarefas", {
    Perfil: "Funcionário",
    FuncionarioID: "emp-1",
    LojaID: "loja-a",
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    path: "tables/Tarefas",
    conditions: [{ field: "LojaID" }, { value: "loja-a" }],
  });
  assert.deepEqual(requests[1], {
    path: "tables/Tarefas",
    conditions: [{ field: "FuncionarioID" }, { value: "emp-1" }],
  });

  requests.length = 0;
  await context.read.call(app, "Documentos", {
    Perfil: "Gerente",
    FuncionarioID: "mgr-1",
    LojaID: "loja-b",
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    path: "tables/Documentos",
    conditions: [{ field: "LojaID" }, { value: "loja-b" }],
  });
  assert.deepEqual(requests[1], {
    path: "tables/Documentos",
    conditions: [{ field: "FuncionarioID" }, { value: "mgr-1" }],
  });
});

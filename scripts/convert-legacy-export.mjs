import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , inputName, outputName = "firebase-tables-v2.json"] = process.argv;
if (!inputName) {
  console.error(
    "Uso: node scripts/convert-legacy-export.mjs export-firebase.json [saida.json]",
  );
  process.exit(1);
}

const decodeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.keys(value)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => value[key]);
};

const decodeValue = (value) => {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === "object") {
    if (value.__gfType === "date") return String(value.value || "");
    if (value.__gfType === "json") {
      try {
        return JSON.parse(value.value || "{}");
      } catch {
        return {};
      }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decodeValue(item)]),
    );
  }
  return value ?? "";
};

const idFields = {
  Configuracoes: "Chave",
  Lojas: "LojaID",
  Funcionarios: "FuncionarioID",
  Folgas: "FolgaID",
  Feriados: "FeriadoID",
  RegrasFolga: "RegraID",
  MovimentosSaldoFolgas: "MovimentoID",
  Auditoria: "AuditoriaID",
  Notificacoes: "NotificacaoID",
  RegrasOperacionais: "RegraOperacionalID",
  CienciasFolga: "CienciaID",
  TrocasFolga: "TrocaID",
  ArenaRanking: "RankingID",
  RegistrosPonto: "RegistroPontoID",
  AjustesPonto: "AjustePontoID",
  JornadasPonto: "JornadaPontoID",
  LocaisPonto: "LocalPontoID",
  BancoHoras: "BancoHorasID",
  Ferias: "FeriasID",
  Documentos: "DocID",
  Onboarding: "OnbID",
  Comunicados: "ComID",
  ComunicadosLeituras: "LeituraID",
  Enquetes: "EnqID",
  EnquetesVotos: "VotoID",
  Delegacoes: "DelID",
  Substituicoes: "SubID",
  FechamentosMensais: "FechamentoID",
  FolhaLinhas: "LinhaID",
  BancoHorasMovimentos: "MovID",
};

const safeKey = (value) =>
  encodeURIComponent(String(value)).replaceAll(".", "%2E");

const input = JSON.parse(await readFile(path.resolve(inputName), "utf8"));
const legacyRoot =
  input?.["gestao-folgas"]?.v1 || input?.v1 || input;
const legacyTables = legacyRoot?.tables || {};
const converted = {};
const warnings = [];

for (const table of Object.values(legacyTables)) {
  const name = String(table?.meta?.name || "").trim();
  if (!name) continue;
  if (name === "Usuarios") {
    warnings.push(
      "Usuarios: contas não foram importadas. Recrie os acessos no menu Controle de acesso para que o Firebase Authentication gere UIDs seguros.",
    );
    continue;
  }
  const headers = decodeArray(table.meta?.headers).map(decodeValue);
  const rows = Object.entries(table.rows || {})
    .map(([rowKey, item]) => ({
      rowKey,
      order: Number(item?.order || 0),
      values: decodeArray(item?.values).map(decodeValue),
    }))
    .sort((a, b) => a.order - b.order);
  const idField =
    idFields[name] ||
    headers.find((header) => /ID$/.test(String(header || ""))) ||
    "";
  if (!idField) {
    warnings.push(`${name}: tabela ignorada porque não foi encontrado um ID.`);
    continue;
  }
  converted[name] = {};
  rows.forEach((row, index) => {
    const record = Object.fromEntries(
      headers.map((header, column) => [
        String(header),
        row.values[column] ?? "",
      ]),
    );
    const id = record[idField] || `${name}-${index + 1}-${row.rowKey}`;
    record[idField] = String(id);
    converted[name][safeKey(id)] = record;
  });
}

await writeFile(
  path.resolve(outputName),
  JSON.stringify(converted, null, 2),
  "utf8",
);
console.log(
  `${Object.keys(converted).length} tabela(s) convertida(s) para ${outputName}.`,
);
warnings.forEach((warning) => console.warn(`ATENÇÃO: ${warning}`));

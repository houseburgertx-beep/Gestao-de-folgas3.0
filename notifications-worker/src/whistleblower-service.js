// Anonymous report access is restricted to this service. Firebase rules must deny
// direct anonymous/client writes; no report credentials are returned by consult.
const encoder = new TextEncoder();
const categories = ["Assédio moral", "Assédio sexual", "Discriminação", "Desvio ou Fraude", "Conduta inadequada", "Segurança no trabalho", "Outro"];
const success = (data) => ({ success: true, message: "", data });
const invalid = () => Object.assign(new Error("Protocolo ou PIN inválido."), { status: 403 });
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
export async function pinHash(pin, salt, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${salt}:${pin}`)));
}
export async function constantEqual(left, right) {
  const digest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
function field(payload, lower, upper, max = 10000) {
  const value = String(payload[lower] ?? payload[upper] ?? "").trim();
  if (value.length > max) throw Object.assign(new Error("Campo excede o tamanho permitido."), { status: 400 });
  return value;
}
function randomPIN() {
  // Rejection sampling avoids modulo bias for a six-digit one-time credential.
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, "0");
}
async function rateLimit(env, key, limit, now) {
  const bucket = Math.floor(now / 900000);
  const row = await env.DB.prepare("INSERT INTO integrity_limits(rate_key,bucket,attempts) VALUES(?,?,1) ON CONFLICT(rate_key,bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts")
    .bind(key, bucket).first();
  if (!row || row.attempts > limit) throw Object.assign(new Error("Muitas tentativas. Aguarde 15 minutos."), { status: 429 });
  await env.DB.prepare("DELETE FROM integrity_limits WHERE bucket<?").bind(bucket - 4).run();
}
export async function handleIntegrity({ route, request, payload, env, database, token, now = Date.now() }) {
  if (!env.INTEGRITY_PIN_SECRET || env.INTEGRITY_PIN_SECRET.length < 32) {
    throw Object.assign(new Error("Canal seguro ainda não configurado."), { status: 503 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Object.assign(new Error("Dados inválidos."), { status: 400 });
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  // Hash IPs with a private pepper. Do not persist a link from an IP to a report.
  const rateKey = await pinHash(ip, "integrity-rate", env.INTEGRITY_PIN_SECRET);
  await rateLimit(env, `ip:${rateKey}`, route === "/integrity/create" ? 5 : 30, now);
  const write = async (updates) => {
    const response = await fetch(`${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/tables.json`, {
      method: "PATCH", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(updates), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Object.assign(new Error("Não foi possível salvar. Tente novamente."), { status: 502 });
  };
  if (route === "/integrity/create") {
    const categoria = field(payload, "categoria", "Categoria", 100);
    const descricao = field(payload, "descricao", "Descricao");
    if (!categories.includes(categoria) || descricao.length < 10) throw Object.assign(new Error("Categoria ou descrição inválida (mínimo 10 caracteres)."), { status: 400 });
    const lojaId = field(payload, "lojaId", "LojaID", 120) || "GERAL";
    if (/[.#$\[\]\/]/.test(lojaId)) throw Object.assign(new Error("Loja inválida."), { status: 400 });
    const anonimo = payload.anonimo === true || payload.Anonimo === true;
    const nomeContato = anonimo ? "Anônimo" : field(payload, "nomeContato", "NomeContato", 200) || "Não informado";
    const protocolo = `DEN-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const pin = randomPIN();
    const salt = crypto.randomUUID();
    const dataCriacao = new Date(now).toISOString();
    const mensagemId = `MSG_${crypto.randomUUID()}`;
    const denuncia = {
      DenunciaID: protocolo, PinHash: await pinHash(pin, salt, env.INTEGRITY_PIN_SECRET), PinSalt: salt,
      Categoria: categoria, LojaID: lojaId, Descricao: descricao,
      Envolvidos: field(payload, "envolvidos", "Envolvidos", 1000) || "Não informado",
      Anonimo: anonimo, NomeContato: nomeContato,
      TelefoneContato: anonimo ? "" : field(payload, "telefoneContato", "TelefoneContato", 100),
      Status: "Recebida", DataCriacao: dataCriacao, UltimaAtualizacao: dataCriacao, ParecerComite: "",
    };
    const notificationId = `integrity-${crypto.randomUUID()}`;
    await write({
      [`Denuncias/${protocolo}`]: denuncia,
      [`Notificacoes/${notificationId}`]: { NotificacaoID: notificationId, LojaID: lojaId === "GERAL" ? "" : lojaId, Tipo: "Governança", Assunto: "Novo Relato no Canal de Integridade", Mensagem: "Novo relato recebido para triagem no canal seguro.", Status: "Pendente", DataCriacao: dataCriacao, RegistoRelacionadoID: protocolo },
      [`DenunciasMensagens/${mensagemId}`]: { MensagemID: mensagemId, DenunciaID: protocolo, LojaID: lojaId, AutorTipo: "Denunciante", AutorNome: anonimo ? "Denunciante Anônimo" : nomeContato, Texto: descricao, DataHora: dataCriacao },
    });
    // Only creation returns the PIN once, so the reporter can save it.
    return success({ protocolo, pin, categoria, status: "Recebida", dataCriacao, mensagem: "Relato registrado com sucesso. Guarde o protocolo e o PIN com segurança." });
  }
  const protocolo = field(payload, "protocolo", "Protocolo", 50).toUpperCase();
  const pin = field(payload, "pin", "PIN", 12);
  if (!/^DEN-[A-Z0-9]{6,32}$/.test(protocolo) || !/^\d{4,6}$/.test(pin)) throw invalid();
  await rateLimit(env, `protocol:${await pinHash(protocolo, "integrity-protocol", env.INTEGRITY_PIN_SECRET)}`, 5, now);
  const denuncia = await database(env, await token(), `tables/Denuncias/${protocolo}`);
  let verified = false;
  if (denuncia?.PinHash && denuncia.PinSalt) {
    verified = await constantEqual(await pinHash(pin, denuncia.PinSalt, env.INTEGRITY_PIN_SECRET), denuncia.PinHash);
  } else if (denuncia?.PIN !== undefined) {
    verified = await constantEqual(pin, String(denuncia.PIN).trim());
  } else {
    await pinHash(pin, "missing-report", env.INTEGRITY_PIN_SECRET);
  }
  if (!verified) throw invalid();
  if (!denuncia.PinHash || denuncia.PIN !== undefined) {
    const salt = crypto.randomUUID();
    await write({ [`Denuncias/${protocolo}/PinHash`]: await pinHash(pin, salt, env.INTEGRITY_PIN_SECRET), [`Denuncias/${protocolo}/PinSalt`]: salt, [`Denuncias/${protocolo}/PIN`]: null });
  }
  if (route === "/integrity/message") {
    const texto = field(payload, "texto", "Texto");
    if (texto.length < 2) throw Object.assign(new Error("Mensagem vazia."), { status: 400 });
    const mensagemId = `MSG_${crypto.randomUUID()}`;
    const dataHora = new Date(now).toISOString();
    await write({
      [`DenunciasMensagens/${mensagemId}`]: { MensagemID: mensagemId, DenunciaID: protocolo, LojaID: denuncia.LojaID || "GERAL", AutorTipo: "Denunciante", AutorNome: denuncia.Anonimo ? "Denunciante Anônimo" : denuncia.NomeContato || "Denunciante", Texto: texto, DataHora: dataHora },
      [`Denuncias/${protocolo}/UltimaAtualizacao`]: dataHora,
    });
    return success({ enviada: true, mensagemId, dataHora });
  }
  const messages = await database(env, await token(), "tables/DenunciasMensagens", { orderBy: "DenunciaID", equalTo: protocolo });
  const mensagens = Object.values(messages || {}).filter((m) => m.DenunciaID === protocolo).sort((a, b) => String(a.DataHora).localeCompare(String(b.DataHora))).map((m) => ({ mensagemId: m.MensagemID, autorTipo: m.AutorTipo, autorNome: m.AutorTipo === "Denunciante" ? "Você" : "Comitê de Ética / RH", texto: m.Texto, dataHora: m.DataHora }));
  return success({ protocolo, categoria: denuncia.Categoria, lojaId: denuncia.LojaID, status: denuncia.Status, dataCriacao: denuncia.DataCriacao, parecerComite: denuncia.ParecerComite || "", ultimaAtualizacao: denuncia.UltimaAtualizacao || denuncia.DataCriacao, mensagens });
}

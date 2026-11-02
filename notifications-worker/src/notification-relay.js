import { active } from "../../src/core/reminder-policy.js";
import { normalizeWhatsAppPhone, sendWhatsAppMessage } from "./whatsapp.js";
const managers = new Set(["Administrador", "Responsável de loja", "Gerente"]);
const automationKeys = { Folga: "aut_folga_nova", FolgaAprovada: "aut_folga_aprovada", FolgaRecusada: "aut_folga_recusada", Atestado: "aut_folga_nova", Troca: "aut_troca_folga", Ponto: "aut_ponto", Tarefa: "aut_tarefas", Tarefas: "aut_tarefas", Documentos: "aut_documentos", Documento: "aut_documentos", Comunicado: "aut_comunicados", Comunicados: "aut_comunicados", Aviso: "aut_comunicados", Avisos: "aut_comunicados", EspelhoPonto: "aut_espelho_ponto" };
export async function verifyCreatorNotificationEvent({ notice, profile, read }) {
  const id = String(notice.RegistoRelacionadoID || "");
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(id) || !profile.FuncionarioID || !profile.LojaID) return false;
  const tables = { Folga: ["Folgas"], Troca: ["TrocasFolga"], Ponto: ["AjustesPonto", "Documentos"],
    Documentos: ["Documentos"], Documento: ["Documentos"], Atestado: ["Folgas", "Documentos"], Tarefa: ["Tarefas"], Tarefas: ["Tarefas"] }[notice.Tipo] || [];
  for (const table of tables) {
    const event = await read(table, id);
    if (event && String(event.LojaID || "") === String(profile.LojaID) &&
      [event.FuncionarioID, event.FuncionarioOrigemID, event.FuncionarioDestinoID, event.ResponsavelID, event.RESPONSAVEL_ID, event.SolicitanteID]
        .some((employeeId) => employeeId && String(employeeId) === String(profile.FuncionarioID))) {
      if (!notice.DestinatarioID && !notice.Destinatario) return true;
      return notice.Tipo === "Troca" && !notice.Destinatario &&
        [event.FuncionarioOrigemID, event.FuncionarioDestinoID].some((employeeId) => employeeId && String(employeeId) === String(notice.DestinatarioID));
    }
  }
  return false;
}
export async function relayNotification({ env, uid, profile, notice, employees, access, gateway, automations = {}, creatorEventVerified = false, now = Date.now(), send = sendWhatsAppMessage }) {
  const isAdmin = profile.Perfil === "Administrador";
  const managerOfStore = managers.has(profile.Perfil) && profile.LojaID && String(notice.LojaID || "") === String(profile.LojaID);
  const creator = notice.CriadoPorUID === uid && profile.LojaID && String(notice.LojaID || "") === String(profile.LojaID);
  if (!notice.NotificacaoID || !(isAdmin || managerOfStore || creator)) return { status: 403, body: { error: "forbidden" } };
  const creatorOnly = creator && !isAdmin && !managerOfStore;
  const ownRecipient = (notice.DestinatarioID && String(notice.DestinatarioID) === String(profile.FuncionarioID || "")) ||
    (notice.Destinatario && String(notice.Destinatario).toLowerCase() === String(profile.Email || "").toLowerCase());
  if (creatorOnly && !ownRecipient && !creatorEventVerified) {
    return { status: 403, body: { error: "forbidden" } };
  }
  if (automations[automationKeys[notice.Tipo]] === false) return { status: 200, body: { success: true, skipped: true } };
  let recipients;
  if (notice.DestinatarioID || notice.Destinatario) {
    recipients = employees.filter((e) => (notice.DestinatarioID && String(e.FuncionarioID) === String(notice.DestinatarioID)) || (notice.Destinatario && String(e.Email || "").toLowerCase() === String(notice.Destinatario).toLowerCase()));
    if (!isAdmin) recipients = recipients.filter((e) => e.LojaID && String(e.LojaID) === String(profile.LojaID));
  } else if (notice.LojaID) {
    const targets = access.filter((p) => active(p.Ativo) && managers.has(p.Perfil) && (p.Perfil === "Administrador" || String(p.LojaID || "") === String(notice.LojaID)));
    recipients = targets.map((p) => ({ ...employees.find((e) => String(e.FuncionarioID) === String(p.FuncionarioID)), ...p }));
  } else recipients = [];
  const phones = new Set();
  let sent = 0, failed = 0;
  for (const employee of recipients.filter((e) => e.Ativo === undefined || active(e.Ativo)).slice(0, 3)) {
    const phone = normalizeWhatsAppPhone(employee.WhatsApp || employee.Telefone || employee.Celular);
    if (!phone || phones.has(phone.digits)) continue;
    phones.add(phone.digits);
    const eventKey = `wa_notice:${notice.NotificacaoID}`;
    const lock = await env.DB.prepare("INSERT INTO deliveries(event_key,endpoint,state,lease_until,expires_at) VALUES(?,?,'sending',?,?) ON CONFLICT(event_key,endpoint) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state!='sent' AND deliveries.lease_until<?")
      .bind(eventKey, phone.digits, now + 60000, now + 86400000, now).run();
    if (!lock.meta.changes) continue;
    const sensitive = creatorOnly || /atestado|document|governan|integridade|denuncia|denúncia/i.test(`${notice.Tipo} ${notice.Assunto}`);
    const text = sensitive ? "House 190: Você recebeu uma atualização. Consulte os detalhes com segurança no aplicativo oficial." : `House 190\n${String(notice.Assunto || "Nova atualização").slice(0, 200)}\n${String(notice.Mensagem || "").slice(0, 1400)}`;
    const result = await send(env, { phone: phone.digits, text, gwConfig: gateway });
    if (result.success) {
      sent++;
      await env.DB.prepare("UPDATE deliveries SET state='sent' WHERE event_key=? AND endpoint=?").bind(eventKey, phone.digits).run();
    } else failed++;
  }
  return { status: failed ? 502 : 200, body: { success: failed === 0, sent, failed } };
}

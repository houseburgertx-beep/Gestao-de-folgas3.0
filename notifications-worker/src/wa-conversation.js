const TTL = 20 * 60 * 1000;
const phrases = { folgas:'minhas folgas', horas:'banco de horas', escala:'meu horário', tarefas:'minhas tarefas', equipe:'quem está na escala' };
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const isConversationFollowUp = text => /^(?:e\s+)?(?:amanha|hoje|depois de amanha|ontem|meu saldo|o saldo|saldo|nesse dia|neste dia|e depois|minhas|as minhas)\s*[?.!]*$/.test(normalize(text));
export function resolveConversationFollowUp({text, previous, employeeId, storeId, now}) {
  if (!isConversationFollowUp(text) || !previous || previous.employeeId !== employeeId || previous.storeId !== storeId || !phrases[previous.intent] || !Number.isFinite(previous.at) || now - previous.at < 0 || now - previous.at > TTL) return text;
  const clean = normalize(text);
  if (/saldo/.test(clean) && !['folgas','horas'].includes(previous.intent)) return text;
  if (/nesse dia|neste dia|e depois|as minhas|minhas$/.test(clean)) return `${phrases[previous.intent]} ${previous.date || ''}`.trim();
  return `${phrases[previous.intent]} ${text}`;
}
export async function createWhatsAppConversationStore(env, token, phone, fetcher = fetch) {
  if (!env.WA_WEBHOOK_SECRET || !env.FIREBASE_DATABASE_URL || !env.FIREBASE_ROOT) return null;
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.WA_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(phone));
  const id = Array.from(new Uint8Array(signature), b=>b.toString(16).padStart(2,'0')).join('');
  const url = `${env.FIREBASE_DATABASE_URL}/${env.FIREBASE_ROOT}/workerPrivate/WhatsAppConversation/${id}.json`;
  const request = async (method,body) => {
    const response = await fetcher(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3500)});
    if (!response.ok) throw Error('conversation_storage_unavailable');
    return method === 'GET' ? response.json() : null;
  };
  return { load:()=>request('GET'),save:state=>request('PUT',state) };
}

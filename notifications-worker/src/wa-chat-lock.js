// Serialize messages for the same conversation across Worker instances.
export async function withChatLease(env,key,task,{waitMs=10000,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}={}) {
 if(!env.DB||!key)return task();
 const owner=crypto.randomUUID(),eventKey=`wa_chat:${key}`,deadline=now()+waitMs;
 let acquired=false;
 try {
  do {
   const timestamp=now();
   const result=await env.DB.prepare("INSERT INTO deliveries(event_key,endpoint,state,lease_until,expires_at) VALUES(?,'chat',?,?,?) ON CONFLICT(event_key,endpoint) DO UPDATE SET state=excluded.state,lease_until=excluded.lease_until,expires_at=excluded.expires_at WHERE deliveries.lease_until<?").bind(eventKey,owner,timestamp+90000,timestamp+86400000,timestamp).run();
   if(result?.meta?.changes){acquired=true;break;}
   if(now()>=deadline)break;
   await pause(300);
  }while(now()<deadline);
  if(!acquired)return {handled:true,authorized:true,action:'chat_busy',replyText:'Ainda estou concluindo sua mensagem anterior. Aguarde um instante e envie novamente esta pergunta.'};
  return await task();
 }catch{
  return {handled:true,authorized:true,action:'chat_lock_unavailable',replyText:'Não consegui organizar a sequência da conversa agora. Tente novamente em instantes; nenhuma nova operação foi enviada.'};
 }finally{
  if(acquired)await env.DB.prepare("UPDATE deliveries SET lease_until=0,state='sent' WHERE event_key=? AND endpoint='chat' AND state=?").bind(eventKey,owner).run().catch(()=>{});
 }
}

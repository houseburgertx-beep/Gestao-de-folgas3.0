// Signatures and document state must be acknowledged together by the server.
export async function documentServerRequest(runtime, path, {method='GET',body,ownerUid,timeoutMs=20000}={}) {
 const user=runtime.auth?.currentUser;
 if(!user?.uid||ownerUid&&user.uid!==ownerUid)throw Error('Sua sessão mudou. Entre novamente antes de assinar.');
 const controller=new AbortController();let timer;
 const assertOwner=()=>{if(controller.signal.aborted)throw Error('O servidor demorou a confirmar. Consulte o documento antes de tentar novamente.');if(runtime.auth?.currentUser?.uid!==user.uid)throw Error('Sua sessão mudou. Entre novamente antes de assinar.');};
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('O servidor demorou a confirmar. Consulte o documento antes de tentar novamente.'));},timeoutMs);});
 try{return await Promise.race([(async()=>{
  const token=await user.getIdToken();assertOwner();
  const root=runtime.root.split('/').map(encodeURIComponent).join('/');
  const url=new URL(`${runtime.config.databaseURL.replace(/\/+$/,'')}/${root}${path?`/${path}`:''}.json`);
  url.searchParams.set('auth',token);if(method==='PATCH')url.searchParams.set('print','silent');
  const response=await fetch(url.href,{method,headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'omit',signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw Error([401,403].includes(response.status)?'O servidor recusou a assinatura. Confira sua sessão e as permissões.':'Não foi possível confirmar o documento no servidor. Consulte o status antes de tentar novamente.');
  const data=method==='GET'?await response.json():null;assertOwner();return data;
 })(),deadline]);}finally{clearTimeout(timer);}
}
export async function readSigningDocument(runtime,id,ownerUid) {
 const key=await runtime.resolveStorageKey('Documentos',id);
 return documentServerRequest(runtime,`tables/Documentos/${encodeURIComponent(key)}`,{ownerUid});
}
export async function commitSignature(runtime,document,signature,changes,ownerUid) {
 const key=await runtime.resolveStorageKey('Documentos',document.DocumentoID||document.DocID);
 const signatureKey=signature.AssinaturaID;
 if(!/^[A-Za-z0-9_-]+$/.test(signatureKey))throw Error('Identificador da assinatura inválido.');
 const updates={[`tables/DocumentosAssinaturas/${signatureKey}`]:signature};
 for(const [field,value] of Object.entries(changes))updates[`tables/Documentos/${key}/${field}`]=value;
 await documentServerRequest(runtime,'',{method:'PATCH',body:updates,ownerUid});
 runtime.invalidateTableCache('Documentos');runtime.invalidateTableCache('DocumentosAssinaturas');
 return {...document,...changes};
}

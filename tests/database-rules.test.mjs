import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Real RTDB rules tests. Run against an isolated local Database Emulator:
// FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:19013 node --test tests/database-rules.test.mjs
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const namespace = 'demo-folgas-security-rules';
const base = '/gestao-folgas/v2';
const profile = (uid, Perfil = 'Funcionário', LojaID = 'store-a', Ativo = true) => ({
  UsuarioID: uid, FuncionarioID: `emp-${uid}`, Nome: uid, Email: `${uid}@example.test`, Perfil, LojaID, Ativo,
});
const jwt = (uid) => {
  const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: uid, user_id: uid, aud: namespace, iss: `https://securetoken.google.com/${namespace}`, iat: 0, exp: 4102444800, email: `${uid}@example.test`, email_verified: true, firebase: { sign_in_provider: 'password', identities: {} } })}.`;
};
const request = async (path, { uid, method = 'GET', data, query = {}, admin = false, headers = {} } = {}) => {
  const url = new URL(`http://${host}${path}.json`);
  url.searchParams.set('ns', namespace);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, JSON.stringify(value));
  if (uid) url.searchParams.set('auth', jwt(uid));
  const response = await fetch(url, {
    method, headers: { ...(admin ? { Authorization: 'Bearer owner' } : {}), 'Content-Type': 'application/json', ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.text();
  return { status: response.status, body, etag: response.headers.get('etag') };
};
const allowed = (result) => assert.equal(result.status, 200, result.body);
const denied = (result) => assert.equal(result.status, 401, result.body);

test('Firebase Database rules enforce roles, privacy, balances and document ownership', { skip: !host && 'requires local Firebase Database Emulator' }, async (t) => {
  assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/, 'use an isolated local emulator only');
  const rules = JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url), 'utf8'));
  allowed(await request('/.settings/rules', { admin: true, method: 'PUT', data: rules }));
  const access = Object.fromEntries(['alice', 'bob', 'inactive'].map((uid) => [uid, profile(uid, 'Funcionário', 'store-a', uid !== 'inactive')]));
  access.admin = profile('admin', 'Administrador');
  access.manager = profile('manager', 'Responsável de loja');
  access.othermanager = profile('othermanager', 'Gerente', 'store-b');
  const employee = { FuncionarioID: 'emp-alice', AuthUID: 'alice', Email: 'alice@example.test', Perfil: 'Funcionário', LojaID: 'store-a', Ativo: true, SaldoFolgas: 2, SaldoFolgasLancamentos: { original: { Delta: 2 } } };
  const doc = { DocID: 'doc-alice', DocumentoID: 'doc-alice', FuncionarioID: 'emp-alice', LojaID: 'store-a', Tipo: 'Holerite', Status: 'Pendente', ConteudoTexto: 'original', HashOriginalSHA256: 'original-hash' };
  const otherDoc = { ...doc, DocID: 'doc-bob', DocumentoID: 'doc-bob', FuncionarioID: 'emp-bob' };
  const complaint = { DenunciaID: 'DEN-1', PIN: '1234', LojaID: 'store-a', Descricao: 'Confidencial', Status: 'Recebida' };
  allowed(await request(base, { admin: true, method: 'PUT', data: { meta: { initialized: true }, access, tables: { Configuracoes: { WhatsAppGateway: { Chave: 'WhatsAppGateway', ApiKey: 'test-secret' }, GeminiConfig: { Chave: 'GeminiConfig', apiKey: 'test-ai-secret' }, Publico: { Chave: 'Publico', Valor: 'visivel' } }, Funcionarios: { 'emp-alice': employee }, Documentos: { 'doc-alice': doc, 'doc-bob': otherDoc }, Denuncias: { 'DEN-1': complaint, 'DEN-2': { ...complaint, DenunciaID: 'DEN-2', LojaID: 'store-b' }, 'DEN-G': { ...complaint, DenunciaID: 'DEN-G', LojaID: 'GERAL' } }, DenunciasMensagens: { 'msg-1': { MensagemID: 'msg-1', DenunciaID: 'DEN-1', Texto: 'privado' } }, Folgas: { own: { FuncionarioID: 'emp-inactive', LojaID: 'store-a', Status: 'Pendente' } } } } }));
  await t.test('atomic document signature commits both records and cannot be overwritten even by admin', async () => {
    const id='doc-atomic';
    allowed(await request(`${base}/tables/Documentos/${id}`,{admin:true,method:'PUT',data:{...doc,DocumentoID:id,DocID:id}}));
    const signature={AssinaturaID:'ASS_atomic',DocumentoID:id,FuncionarioID:'emp-alice',LojaID:'store-a',DataHoraAssinatura:'2026-11-03T12:00:00Z',AssinaturaRubricaBase64:'test-rubric'};
    const updates={
      'tables/DocumentosAssinaturas/ASS_atomic':signature,
      [`tables/Documentos/${id}/Status`]:'Assinado',
      [`tables/Documentos/${id}/AssinaturaID`]:'ASS_atomic',
    };
    denied(await request(base,{uid:'bob',method:'PATCH',data:updates}));
    assert.equal(JSON.parse((await request(`${base}/tables/Documentos/${id}`,{uid:'alice'})).body).Status,'Pendente');
    allowed(await request(base,{uid:'alice',method:'PATCH',data:updates}));
    assert.equal(JSON.parse((await request(`${base}/tables/Documentos/${id}`,{uid:'alice'})).body).Status,'Assinado');
    denied(await request(base,{uid:'admin',method:'PATCH',data:{...updates,'tables/DocumentosAssinaturas/ASS_atomic':{...signature,AssinaturaRubricaBase64:'replacement'}}}));
    assert.equal(JSON.parse((await request(`${base}/tables/DocumentosAssinaturas/ASS_atomic`,{uid:'alice'})).body).AssinaturaRubricaBase64,'test-rubric');
  });
  await t.test('medical retry preflight reads only absence and does not expose another employee file',async()=>{
    const hash='a'.repeat(64),documentId=`DOC_ATESTADO_${hash}`,leaveId=`ATESTADO_${hash}`;
    allowed(await request(`${base}/tables/Documentos/${documentId}`,{uid:'alice'}));
    allowed(await request(`${base}/tables/Folgas/${leaveId}`,{uid:'alice'}));
    denied(await request(`${base}/tables/Documentos/${documentId}`,{uid:'inactive'}));
    allowed(await request(`${base}/tables/Documentos/${documentId}`,{admin:true,method:'PUT',data:{...otherDoc,DocumentoID:documentId,DocID:documentId,Tipo:'Atestado Médico'}}));
    allowed(await request(`${base}/tables/Folgas/${leaveId}`,{admin:true,method:'PUT',data:{FolgaID:leaveId,FuncionarioID:'emp-bob',LojaID:'store-a',Status:'Pendente'}}));
    denied(await request(`${base}/tables/Documentos/${documentId}`,{uid:'alice'}));
    denied(await request(`${base}/tables/Folgas/${leaveId}`,{uid:'alice'}));
  });
  await t.test('employee can query only their own weekly recognition, not the full table or another employee',async()=>{
    allowed(await request(`${base}/tables/Reconhecimentos/award-alice`,{admin:true,method:'PUT',data:{ReconhecimentoID:'award-alice',FuncionarioID:'emp-alice',LojaID:'store-a',Ativo:true}}));
    allowed(await request(`${base}/tables/Reconhecimentos/award-bob`,{admin:true,method:'PUT',data:{ReconhecimentoID:'award-bob',FuncionarioID:'emp-bob',LojaID:'store-a',Ativo:true}}));
    denied(await request(`${base}/tables/Reconhecimentos`,{uid:'alice'}));
    const own=await request(`${base}/tables/Reconhecimentos`,{uid:'alice',query:{orderBy:'FuncionarioID',equalTo:'emp-alice'}});allowed(own);assert.ok(JSON.parse(own.body)['award-alice']);assert.equal(JSON.parse(own.body)['award-bob'],undefined);
    denied(await request(`${base}/tables/Reconhecimentos`,{uid:'alice',query:{orderBy:'FuncionarioID',equalTo:'emp-bob'}}));
    allowed(await request(`${base}/tables/Reconhecimentos`,{uid:'manager',query:{orderBy:'LojaID',equalTo:'store-a'}}));
  });
  await t.test('unprovisioned account cannot choose a role or employee identity', async () => {
    denied(await request(`${base}/access/outsider`, { uid: 'outsider', method: 'PUT', data: profile('outsider', 'Administrador') }));
    denied(await request(`${base}/access/outsider`, { uid: 'outsider', method: 'PUT', data: profile('outsider') }));
    denied(await request(`${base}/access/alice/Perfil`, { uid: 'alice', method: 'PUT', data: 'Administrador' }));
    allowed(await request(`${base}/access/new-user`, { uid: 'admin', method: 'PUT', data: profile('new-user') }));
    allowed(await request(`${base}/access/alice`, { uid: 'alice', method: 'PATCH', data: { AvatarID: 'avatar-02' } }));
  });
  await t.test('inactive accounts cannot read or write business data', async () => {
    denied(await request(`${base}/tables/Lojas`, { uid: 'inactive' }));
    denied(await request(`${base}/tables/Folgas/own`, { uid: 'inactive', method: 'PATCH', data: { Status: 'Cancelada' } }));
  });
  await t.test('employee may edit avatar but not balance, ledger or identity', async () => {
    for (const patch of [{ SaldoFolgas: 999 }, { SaldoFolgasLancamentos: {} }, { FuncionarioID: 'emp-bob' }, { Ativo: false }, { AuthUID: 'bob' }]) {
      denied(await request(`${base}/tables/Funcionarios/emp-alice`, { uid: 'alice', method: 'PATCH', data: patch }));
    }
    allowed(await request(`${base}/tables/Funcionarios/emp-alice`, { uid: 'alice', method: 'PATCH', data: { AvatarID: 'avatar-01' } }));
    allowed(await request(`${base}/tables/Funcionarios/emp-alice`, { uid: 'manager', method: 'PATCH', data: { SaldoFolgas: 3 } }));
    denied(await request(`${base}/tables/Funcionarios/emp-alice`, { uid: 'othermanager', method: 'PATCH', data: { LojaID: 'store-b', SaldoFolgas: 99 } }));
  });
  await t.test('complaints cannot be enumerated or modified by employees', async () => {
    denied(await request(`${base}/tables/Denuncias`, { uid: 'alice' }));
    denied(await request(`${base}/tables/Denuncias/DEN-1`, { uid: 'alice' }));
    denied(await request(`${base}/tables/DenunciasMensagens`, { uid: 'alice' }));
    denied(await request(`${base}/tables/Denuncias/DEN-1`, { uid: 'alice', method: 'PATCH', data: { Status: 'Arquivada' } }));
    allowed(await request(`${base}/tables/Denuncias`, { uid: 'manager', query: { orderBy: 'LojaID', equalTo: 'store-a' } }));
    allowed(await request(`${base}/tables/Denuncias`, { uid: 'manager', query: { orderBy: 'LojaID', equalTo: 'GERAL' } }));
    denied(await request(`${base}/tables/Denuncias`, { uid: 'manager', query: { orderBy: 'LojaID', equalTo: 'store-b' } }));
    allowed(await request(`${base}/tables/DenunciasMensagens`, { uid: 'manager', query: { orderBy: 'DenunciaID', equalTo: 'DEN-1' } }));
    denied(await request(`${base}/tables/DenunciasMensagens`, { uid: 'othermanager', query: { orderBy: 'DenunciaID', equalTo: 'DEN-1' } }));
    allowed(await request(`${base}/tables/Denuncias/DEN-1`, { uid: 'manager', method: 'PATCH', data: { Status: 'Em Análise' } }));
    denied(await request(`${base}/tables/Denuncias/DEN-1`, { uid: 'manager', method: 'PATCH', data: { Descricao: 'alterado' } }));
  });
  await t.test('signatures require the document owner and preserve original content', async () => {
    const signature = { AssinaturaID: 'sig-alice', DocumentoID: 'doc-alice', FuncionarioID: 'emp-alice', LojaID: 'store-a', DataHoraAssinatura: '2026-11-02', AssinaturaRubricaBase64: 'rubric' };
    denied(await request(`${base}/tables/Documentos/doc-alice`, { uid: 'bob', method: 'PATCH', data: { Status: 'Assinado' } }));
    denied(await request(`${base}/tables/Documentos/doc-alice`, { uid: 'manager', method: 'PATCH', data: { Status: 'Assinado' } }));
    denied(await request(`${base}/tables/DocumentosAssinaturas/sig-alice`, { uid: 'bob', method: 'PUT', data: signature }));
    denied(await request(`${base}/tables/Documentos/doc-alice`, { uid: 'alice', method: 'PATCH', data: { Status: 'Assinado', ConteudoTexto: 'forged' } }));
    allowed(await request(`${base}/tables/DocumentosAssinaturas/sig-alice`, { uid: 'alice', method: 'PUT', data: signature }));
    allowed(await request(`${base}/tables/Documentos/doc-alice`, { uid: 'alice', method: 'PATCH', data: { Status: 'Assinado', AssinaturaID: 'sig-alice', DataAssinatura: '2026-11-02', HashDocumentoFinalSHA256: 'signed', CodigoValidacao: 'ABC', ArquivoFinalBase64: 'pdf' } }));
    denied(await request(`${base}/tables/DocumentosAssinaturas/sig-alice`, { uid: 'alice', method: 'PATCH', data: { AssinaturaRubricaBase64: 'replacement' } }));
  });
  await t.test('own timeclock mirror supports creation, signing and contesting without taking ownership of another employee', async () => {
    const mirrorId = 'ESPELHO_2026-11_emp-alice';
    const mirror = { DocID: mirrorId, DocumentoID: mirrorId, FuncionarioID: 'emp-alice', LojaID: 'store-a', Tipo: 'Espelho de Ponto', MesReferencia: '2026-11', Status: 'Pendente', OrigemTipo: 'ESPELHO_PONTO', Titulo: 'Espelho', Descricao: 'mensal', NomeFuncionario: 'Alice', CPFFuncionario: '' };
    allowed(await request(`${base}/tables/Documentos/${mirrorId}`, { uid: 'alice', method: 'PUT', data: mirror }));
    denied(await request(`${base}/tables/Documentos/${mirrorId}`, { uid: 'bob', method: 'PATCH', data: { Status: 'Assinado' } }));
    allowed(await request(`${base}/tables/Documentos/${mirrorId}`, { uid: 'alice', method: 'PUT', data: { ...mirror, Status: 'Contestado', UltimoMotivoContestacao: 'Jornada divergente', DataContestacao: '2026-11-02', Descricao: 'contestado' } }));
    allowed(await request(`${base}/tables/Documentos/${mirrorId}`, { uid: 'alice', method: 'PUT', data: { ...mirror, Status: 'Assinado', CodigoValidacao: 'MIRROR', DataAssinatura: '2026-11-02', HashDocumentoFinalSHA256: 'hash', Descricao: 'assinado' } }));
    const signature = { AssinaturaID: `ASS_${mirrorId}`, DocumentoID: mirrorId, FuncionarioID: 'emp-alice', LojaID: 'store-a', DataHoraAssinatura: '2026-11-02', AssinaturaRubricaBase64: 'rubric' };
    allowed(await request(`${base}/tables/DocumentosAssinaturas/${signature.AssinaturaID}`, { uid: 'alice', method: 'PUT', data: signature }));
  });
  await t.test('raw legacy gateway and AI secrets remain private', async () => {
    denied(await request(`${base}/tables/Configuracoes`, { uid: 'alice' }));
    denied(await request(`${base}/tables/Configuracoes/WhatsAppGateway`, { uid: 'alice' }));
    denied(await request(`${base}/tables/Configuracoes/GeminiConfig`, { uid: 'alice' }));
    allowed(await request(`${base}/tables/Configuracoes/Publico`, { uid: 'alice' }));
    allowed(await request(`${base}/tables/Configuracoes/WhatsAppGateway`, { uid: 'admin' }));
  });
  await t.test('notifications cannot forge a different Firebase creator', async () => {
    const notice = { NotificacaoID: 'notice-1', DestinatarioID: 'emp-alice', LojaID: 'store-a', Tipo: 'Documentos', CriadoPorUID: 'bob' };
    denied(await request(`${base}/tables/Notificacoes/notice-1`, { uid: 'alice', method: 'PUT', data: notice }));
    allowed(await request(`${base}/tables/Notificacoes/notice-1`, { uid: 'alice', method: 'PUT', data: { ...notice, CriadoPorUID: 'alice' } }));
  });
  await t.test('employee event notifications preserve workflow without arbitrary broadcast', async () => {
    allowed(await request(`${base}/tables/AjustesPonto/adjust-own`, { admin: true, method: 'PUT', data: { FuncionarioID: 'emp-alice', LojaID: 'store-a', Status: 'Pendente' } }));
    const notice = { NotificacaoID: 'notice-adjust', DestinatarioID: '', LojaID: 'store-a', Tipo: 'Ponto', CriadoPorUID: 'alice', RegistoRelacionadoID: 'adjust-own' };
    allowed(await request(`${base}/tables/Notificacoes/notice-adjust`, { uid: 'alice', method: 'PUT', data: notice }));
    denied(await request(`${base}/tables/Notificacoes/notice-fake`, { uid: 'alice', method: 'PUT', data: { ...notice, NotificacaoID: 'notice-fake', RegistoRelacionadoID: 'missing' } }));
    denied(await request(`${base}/tables/Notificacoes/notice-foreign`, { uid: 'bob', method: 'PUT', data: { ...notice, NotificacaoID: 'notice-foreign', CriadoPorUID: 'bob' } }));
    denied(await request(`${base}/tables/Notificacoes/notice-cross-store`, { uid: 'alice', method: 'PUT', data: { ...notice, NotificacaoID: 'notice-cross-store', LojaID: 'store-b' } }));
  });
  await t.test('punch creation uses a server ETag without reading another employee record', async () => {
    const id = 'clock-cas-request-alice-0001';
    const path = `${base}/tables/RegistrosPonto/${id}`;
    const absent = await request(path, { uid: 'alice', headers: { 'X-Firebase-ETag': 'true' } });
    allowed(absent);
    assert.equal(absent.body, 'null');
    assert.ok(absent.etag, 'server must return an ETag for the missing record');
    denied(await request(path, { uid: 'inactive', headers: { 'X-Firebase-ETag': 'true' } }));
    const record = { RegistroPontoID: id, RequestID: id, FuncionarioID: 'emp-alice', LojaID: 'store-a', Data: '2026-11-01', DataHora: '2026-11-01T12:00:00.000Z', Latitude: -16.4, Longitude: -39.1, PrecisaoMetros: 20, TipoMarcacao: 'ENTRADA', Status: 'Válido', SelfieStorage: 'Google Drive', SelfieDriveFileID: 'drive-confirmed-file' };
    allowed(await request(path, { uid: 'alice', method: 'PUT', data: record, headers: { 'if-match': absent.etag } }));
    denied(await request(path, { uid: 'bob', headers: { 'X-Firebase-ETag': 'true' } }));
    allowed(await request(path, { uid: 'alice', headers: { 'X-Firebase-ETag': 'true' } }));
    const replay = await request(path, { uid: 'alice', method: 'PUT', data: record, headers: { 'if-match': absent.etag } });
    assert.equal(replay.status, 412, replay.body);
    const saved = await request(path, { uid: 'alice' });
    assert.deepEqual(JSON.parse(saved.body), record, 'conditional replay cannot overwrite the confirmed punch');
    for (const patch of [{ DataHora: 'invalid' }, { Latitude: 91 }, { Longitude: -181 }, { PrecisaoMetros: 351 }, { PrecisaoMetros: -1 }, { SelfieDriveFileID: '' }]) {
      const invalidId = `invalid-${Object.keys(patch)[0]}-${String(Object.values(patch)[0]).replace(/[^a-z0-9]/gi, '')}`;
      denied(await request(`${base}/tables/RegistrosPonto/${invalidId}`, { uid: 'alice', method: 'PUT', data: { ...record, RegistroPontoID: invalidId, RequestID: invalidId, ...patch } }));
    }
  });
  await t.test('coarse GPS requires the complete uncertainty area inside the official configured store area',async()=>{
    const location={LocalPontoID:'location-large',LojaID:'store-a',Latitude:-16.4,Longitude:-39.1,RaioMetros:10000,Ativo:true};
    allowed(await request(`${base}/tables/LocaisPonto/location-large`,{admin:true,method:'PUT',data:location}));
    const row={FuncionarioID:'emp-alice',LojaID:'store-a',Data:'2026-11-04',DataHora:'2026-11-04T12:00:00.000Z',TipoMarcacao:'ENTRADA',Status:'Válido',SelfieStorage:'Google Drive',SelfieDriveFileID:'real-file-receipt',Latitude:-16.4,Longitude:-39.1,PrecisaoMetros:1500,LocalPontoID:'location-large',LocalizacaoOrigem:'LocaisPonto',LocalizacaoValidacao:'coarse-contained'};
    const save=(id,delta={})=>request(`${base}/tables/RegistrosPonto/${id}`,{uid:'alice',method:'PUT',data:{...row,...delta,RegistroPontoID:id,RequestID:id}});
    allowed(await save('coarse-valid-location'));
    denied(await save('coarse-outside-location',{Latitude:-15,DistanciaLojaMetros:0,RaioValidadoMetros:999999}));
    denied(await save('coarse-invalid-location',{LocalPontoID:'made-up-location'}));
    denied(await save('coarse-too-imprecise',{PrecisaoMetros:6000}));
    allowed(await request(`${base}/tables/LocaisPonto/location-large/RaioMetros`,{admin:true,method:'PUT',data:150}));
    denied(await save('coarse-small-official-area'));
  });
  await t.test('WhatsApp navigation tokens remain private, scoped and immutable on access', async () => {
    const token = { TokenID: 'magic-alice', Token: 'magic-alice', FuncionarioID: 'emp-alice', FuncionarioStorageKey: 'emp-alice', NomeFuncionario: 'Alice', LojaID: 'store-a', Destino: 'documents', Tipo: 'ESPELHO_PONTO', DocID: 'doc-alice', ExpiraEm: '2026-12-01T12:00:00.000Z', Utilizado: false, Acessos: 0 };
    const path = `${base}/tables/WhatsAppMagicTokens/magic-alice`;
    denied(await request(path, { uid: 'bob', method: 'PUT', data: token }));
    allowed(await request(path, { uid: 'alice', method: 'PUT', data: token }));
    denied(await request(`${base}/tables/WhatsAppMagicTokens`, { uid: 'alice' }));
    denied(await request(path, { uid: 'bob' }));
    allowed(await request(path, { uid: 'alice' }));
    allowed(await request(path, { uid: 'manager' }));
    denied(await request(path, { uid: 'othermanager' }));
    const access = { Utilizado: true, Acessos: 1, UltimoAcessoEm: '2026-11-02T12:00:00.000Z' };
    denied(await request(path, { uid: 'bob', method: 'PATCH', data: access }));
    denied(await request(path, { uid: 'manager', method: 'PATCH', data: access }));
    denied(await request(path, { uid: 'alice', method: 'PATCH', data: { ...access, FuncionarioID: 'emp-bob' } }));
    denied(await request(path, { uid: 'alice', method: 'PATCH', data: { ...access, DocID: 'doc-bob' } }));
    denied(await request(path, { uid: 'alice', method: 'PATCH', data: { ...access, ExpiraEm: '2099-01-01T00:00:00.000Z' } }));
    allowed(await request(path, { uid: 'alice', method: 'PATCH', data: access }));
    allowed(await request(path, { uid: 'alice', method: 'PATCH', data: { ...access, Acessos: 2 } }));
    const managedToken = { ...token, TokenID: 'magic-managed', Token: 'magic-managed' };
    allowed(await request(`${base}/tables/WhatsAppMagicTokens/magic-managed`, { uid: 'manager', method: 'PUT', data: managedToken }));
    denied(await request(`${base}/tables/WhatsAppMagicTokens/magic-cross-store`, { uid: 'othermanager', method: 'PUT', data: { ...token, TokenID: 'magic-cross-store', Token: 'magic-cross-store', LojaID: 'store-b' } }));
  });
  await t.test('initial administrator setup requires a unique bootstrap owner and closes after initialization', async () => {
    allowed(await request(base, { admin: true, method: 'PUT', data: {} }));
    allowed(await request(`${base}/meta/bootstrapOwner`, { uid: 'first', method: 'PUT', data: 'first' }));
    denied(await request(`${base}/meta/bootstrapOwner`, { uid: 'second', method: 'PUT', data: 'second' }));
    denied(await request(`${base}/access/second`, { uid: 'second', method: 'PUT', data: profile('second', 'Administrador') }));
    allowed(await request(`${base}/access/first`, { uid: 'first', method: 'PUT', data: profile('first', 'Administrador') }));
    allowed(await request(`${base}/tables/Lojas/initial`, { uid: 'first', method: 'PUT', data: { LojaID: 'initial' } }));
    allowed(await request(`${base}/meta/initialized`, { uid: 'first', method: 'PUT', data: true }));
    denied(await request(`${base}/meta/bootstrapOwner`, { uid: 'second', method: 'PUT', data: 'second' }));
    denied(await request(`${base}/access/second`, { uid: 'second', method: 'PUT', data: profile('second', 'Administrador') }));
  });
  await t.test('SolicitacoesVale allows employee creation, blocks self-approval/spoofing, and scopes manager validation to own store', async () => {
    const vale = {
      ValeID: 'vale-alice-1',
      FuncionarioID: 'emp-alice',
      LojaID: 'store-a',
      Valor: 300,
      Motivo: 'Despesa médica',
      DataDesejada: '2026-11-14',
      Competencia: '2026-11',
      Status: 'Solicitado',
    };
    const valePath = `${base}/tables/SolicitacoesVale/vale-alice-1`;
    denied(await request(valePath, { uid: 'bob', method: 'PUT', data: vale }));
    denied(await request(valePath, { uid: 'alice', method: 'PUT', data: { ...vale, LojaID: 'store-b' } }));
    denied(await request(valePath, { uid: 'alice', method: 'PUT', data: { ...vale, Status: 'Pago' } }));
    denied(await request(valePath, { uid: 'alice', method: 'PUT', data: { ...vale, Valor: 0 } }));
    allowed(await request(valePath, { uid: 'alice', method: 'PUT', data: vale }));
    const ownRead = await request(`${base}/tables/SolicitacoesVale`, { uid: 'alice', query: { orderBy: 'FuncionarioID', equalTo: 'emp-alice' } });
    allowed(ownRead);
    assert.ok(JSON.parse(ownRead.body)['vale-alice-1']);
    denied(await request(valePath, { uid: 'alice', method: 'PATCH', data: { Status: 'Validado pelo Gerente' } }));
    denied(await request(valePath, { uid: 'othermanager', method: 'PATCH', data: { Status: 'Validado pelo Gerente' } }));
    denied(await request(valePath, { uid: 'manager', method: 'PATCH', data: { Status: 'Pago' } }));
    allowed(await request(valePath, { uid: 'manager', method: 'PATCH', data: { Status: 'Validado pelo Gerente', ValidadoGerentePor: 'manager' } }));
    allowed(await request(valePath, { uid: 'admin', method: 'PATCH', data: { Status: 'Pago' } }));
  });
});

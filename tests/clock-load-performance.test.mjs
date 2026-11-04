import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime } from '../src/core/runtime.js';
import { createClockHandlers } from '../src/core/api-clock.js';

const profile = { Perfil: 'Administrador', FuncionarioID: '', LojaID: '' };
const employee = id => ({ FuncionarioID: id, Nome: `Pessoa ${id}`, LojaID: 'store', Ativo: true });

test('quick status starts independent reads without waiting for the employee lookup', async t => {
  t.mock.method(runtime, 'requireProfile', async () => ({ ...profile, FuncionarioID: 'e1' }));
  const started = [];
  let resolveEmployee;
  t.mock.method(runtime, 'getById', () => { started.push('employee'); return new Promise(resolve => { resolveEmployee = resolve; }); });
  t.mock.method(runtime, 'listPeriods', async () => { started.push('records'); return []; });
  t.mock.method(runtime, 'list', async table => { started.push(table); return []; });
  const pending = createClockHandlers().getTimeClockQuickStatusWithSession([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['employee', 'records', 'JornadasPonto', 'Folgas']);
  resolveEmployee(employee('e1'));
  const result = await pending;
  assert.equal(result.data.nextAction, 'ENTRADA');
});

test('monthly clock builds per-day rows in linear scans while preserving totals, time off and justification', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-30T15:00:00Z') });
  t.mock.method(runtime, 'requireProfile', async () => profile);
  const employees = Array.from({ length: 20 }, (_, i) => employee(`e${i}`));
  const schedules = employees.map(emp => ({ FuncionarioID: emp.FuncionarioID, Ativa: true, VigenteDe: '2020-01-01', HoraEntrada: '08:00', HoraSaida: '17:00', DuracaoIntervaloMinutos: 60, DiasSemana: '0,1,2,3,4,5,6', BancoHorasAtivo: true }));
  let employeeIdReads = 0;
  const records = employees.flatMap(emp => Array.from({ length: 30 }, (_, index) => {
    const day = `2026-11-${String(index + 1).padStart(2, '0')}`;
    return [['ENTRADA','08:00'],['SAIDA_INTERVALO','12:00'],['RETORNO_INTERVALO','13:00'],['SAIDA_FINAL','17:00']].map(([type,time]) => ({
      get FuncionarioID() { employeeIdReads++; return emp.FuncionarioID; },
      RegistroPontoID: `${emp.FuncionarioID}-${day}-${type}`, Data: day, DataHora: `${day}T${time}:00-03:00`, TipoMarcacao: type, Status: 'Confirmado',
    }));
  }).flat());
  const justified = { JustificativaPontoID: 'j1', FuncionarioID: 'e0', Data: '2026-11-02', Status: 'Aprovada', Tipo: 'Atestado', Observacao: 'fixture' };
  const timeOff = { FuncionarioID: 'e1', DataInicio: '2026-11-03', DataFim: '2026-11-03', Status: 'Aprovada' };
  const tables = { Funcionarios: employees, JornadasPonto: schedules, JustificativasPonto: [justified], Folgas: [timeOff] };
  t.mock.method(runtime, 'list', async table => tables[table] || []);
  t.mock.method(runtime, 'listPeriods', async () => records);
  const result = (await createClockHandlers().getTimeClockDataWithSession([{ month: '2026-11' }])).data;
  // The former employees x days x records scans exceeded 1.4 million ID reads for this fixture.
  assert.ok(employeeIdReads < records.length * 25, `excessive scans: ${employeeIdReads} for ${records.length} records`);
  t.diagnostic(`${employeeIdReads} employee identity reads across ${records.length} monthly records`);
  assert.equal(result.records.length, 2400);
  assert.equal(result.days.length, 600);
  assert.equal(result.days.find(row => row.funcionarioId === 'e0' && row.data === '2026-11-02').justificativaId, 'j1');
  assert.equal(result.days.find(row => row.funcionarioId === 'e0' && row.data === '2026-11-02').saldoTexto, 'Justificado');
  assert.equal(result.days.find(row => row.funcionarioId === 'e1' && row.data === '2026-11-03').folga, true);
  assert.ok(result.days.every(row => row.trabalhadoMinutos === 480));
  assert.equal(result.summary.trabalhadoMinutos, 599 * 480);
});

test('a profile without its own employee does not download a store month for an empty quick status', async t => {
  t.mock.method(runtime, 'requireProfile', async () => profile);
  let calls = 0;
  for (const name of ['getById', 'list', 'listPeriods']) t.mock.method(runtime, name, async () => { calls++; return []; });
  const result = (await createClockHandlers().getTimeClockQuickStatusWithSession([])).data;
  assert.equal(calls, 0);
  assert.deepEqual(result.todayRecords, []);
  assert.equal(result.nextAction, '');
});

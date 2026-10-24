// Smoke test de Estoque (S26), Controle de prótese (S27) e Indicadores (S25).
//   node scripts/smoke-modulos.mjs [http://localhost:8090]
const BASE = process.argv[2] ?? 'http://localhost:8090'
let ok = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  OK   ' + name) } else { fail++; console.log('  FAIL ' + name + ' ' + extra) }
}
async function api(method, path, body, token, headers = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: r.status, body: json }
}
const show = (r) => `${r.status} ${JSON.stringify(r.body)?.slice(0, 240)}`
const s = Date.now()
const today = new Date().toLocaleDateString('en-CA')
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

let r = await api('POST', '/api/auth/signup', { name: 'Dra. Módulos', email: `mod+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Clínica Módulos' })
const O = r.body.token
const prof = (await api('GET', '/api/professionals', null, O)).body[0].id

console.log('[estoque]')
r = await api('POST', '/api/stock/products', { name: 'Luva de procedimento M', unit: 'cx', category: 'Descartáveis', minQty: 5, initialQty: 12, costCents: 3290 }, O)
check('cria produto com saldo inicial', r.status === 201 && Number(r.body.qty) === 12 && !r.body.low, show(r))
const luva = r.body
r = await api('POST', '/api/stock/products', { name: 'luva de procedimento m' }, O)
check('nome repetido (sem diferenciar maiúsculas) é recusado', r.status === 409, show(r))
r = await api('POST', `/api/stock/products/${luva.id}/movements`, { kind: 'saida', qty: 8, reason: 'Uso da semana' }, O)
check('saída baixa o saldo e acende o alerta de mínimo', r.status === 201 && Number(r.body.qty) === 4 && r.body.low === true, show(r))
r = await api('POST', `/api/stock/products/${luva.id}/movements`, { kind: 'saida', qty: 10 }, O)
check('saída maior que o saldo é recusada', r.status === 409 && r.body.code === 'STOCK_NEGATIVE', show(r))
r = await api('POST', `/api/stock/products/${luva.id}/movements`, { kind: 'ajuste', countedQty: 3 }, O)
check('ajuste exige motivo', r.status === 400, show(r))
r = await api('POST', `/api/stock/products/${luva.id}/movements`, { kind: 'ajuste', countedQty: 3, reason: 'Contagem: uma caixa rasgada' }, O)
check('ajuste pela contagem', r.status === 201 && Number(r.body.qty) === 3, show(r))
r = await api('POST', `/api/stock/products/${luva.id}/movements`, { kind: 'entrada', qty: 10, costCents: 3500 }, O)
check('entrada soma e atualiza o último custo', Number(r.body.qty) === 13 && r.body.costCents === 3500 && !r.body.low, show(r))
r = await api('GET', `/api/stock/products/${luva.id}/movements`, null, O)
check('histórico com saldo após cada movimento', r.body.length === 4 && Number(r.body[0].balance) === 13 && Number(r.body[1].qty) === -1, show(r))
r = await api('PATCH', `/api/stock/products/${luva.id}`, { name: 'Luva de procedimento M', isActive: false }, O)
r = await api('GET', '/api/stock/products', null, O)
check('desativado some da lista', r.body.length === 0, show(r))
r = await api('POST', `/api/stock/products/${luva.id}/movements`, { kind: 'entrada', qty: 1 }, O)
check('produto desativado não movimenta', r.status === 404, show(r))

console.log('[prótese]')
const pt = (await api('POST', '/api/patients', { name: 'Paulo Prótese' }, O)).body
r = await api('POST', '/api/prosthesis', { patientId: pt.id, professionalId: prof, description: 'Coroa em porcelana — 11', laboratory: 'Lab Sorriso', dueDate: addDays(today, 3), costCents: 45000 }, O)
check('cria pedido em pré-laboratório', r.status === 201 && r.body.stage === 'pre_lab' && r.body.patientName === 'Paulo Prótese', show(r))
const ord = r.body
r = await api('POST', `/api/prosthesis/${ord.id}/stage`, { stage: 'laboratorio', dueDate: addDays(today, -1), note: 'Enviado por motoboy' }, O)
check('anda de etapa; prazo vencido = atrasado', r.body.stage === 'laboratorio' && r.body.late === true, show(r))
r = await api('POST', `/api/prosthesis/${ord.id}/stage`, { stage: 'realizado', dueDate: addDays(today, -5) }, O)
check('realizado zera prazo e não fica atrasado', r.body.stage === 'realizado' && r.body.dueDate == null && r.body.late === false, show(r))
r = await api('GET', `/api/prosthesis/${ord.id}/events`, null, O)
check('histórico de etapas', r.body.map((e) => e.stage).join(',') === 'pre_lab,laboratorio,realizado' && r.body[1].note === 'Enviado por motoboy', show(r))
r = await api('POST', '/api/prosthesis', { patientId: pt.id, description: 'Protocolo inferior', laboratory: 'Lab Sorriso' }, O)
const ord2 = r.body
r = await api('GET', '/api/prosthesis/laboratories', null, O)
check('sugere laboratórios já usados', r.body[0] === 'Lab Sorriso', show(r))
r = await api('POST', `/api/prosthesis/${ord2.id}/cancel`, {}, O)
r = await api('GET', '/api/prosthesis', null, O)
check('cancelado sai do quadro', r.body.length === 1 && r.body[0].id === ord.id, show(r))
r = await api('POST', `/api/prosthesis/${ord2.id}/stage`, { stage: 'envio' }, O)
check('cancelado não anda', r.status === 404, show(r))

console.log('[indicadores]')
const accts = (await api('GET', '/api/financial-accounts', null, O)).body
const procs = (await api('GET', '/api/procedures', null, O)).body
const pB = (await api('POST', '/api/patients', { name: 'Bia Indicadores', birthDate: `1990-${today.slice(5)}`, phone: '(48) 90000-0001' }, O)).body
const tz = (h) => new Date(`${today}T${h}:00-03:00`).toISOString()
const a1 = (await api('POST', '/api/appointments', { kind: 'consulta', patientId: pB.id, professionalId: prof, startAt: tz('08:00'), endAt: tz('08:30') }, O)).body
const a2 = (await api('POST', '/api/appointments', { kind: 'consulta', patientId: pt.id, professionalId: prof, startAt: tz('09:00'), endAt: tz('09:30') }, O)).body
check('consultas de hoje criadas', !!a1.id && !!a2.id, JSON.stringify([a1, a2]).slice(0, 300))
await api('PATCH', `/api/appointments/${a1.id}`, { status: 'atendido' }, O)
await api('PATCH', `/api/appointments/${a2.id}`, { status: 'faltou' }, O)
const b1 = (await api('POST', `/api/patients/${pB.id}/budgets`, { professionalId: prof, firstDueDate: addDays(today, -10), items: [{ procedureId: procs[0].id, tooth: 11, priceCents: 50000 }] }, O)).body
await api('POST', `/api/budgets/${b1.id}/approve`, { firstDueDate: addDays(today, -10) }, O)
await api('POST', `/api/patients/${pt.id}/budgets`, { professionalId: prof, items: [{ procedureId: procs[0].id, tooth: 21, priceCents: 30000 }] }, O)
const [d1] = (await api('GET', `/api/patients/${pB.id}/debits`, null, O)).body
await api('POST', `/api/debits/${d1.id}/payments`, { amountCents: 20000, method: 'pix', financialAccountId: accts[0].id }, O, { 'Idempotency-Key': `ind-${s}` })
await api('POST', '/api/expenses', { description: 'Conta de luz', amountCents: 15000, dueDate: today, paid: true, financialAccountId: accts[0].id, method: 'pix' }, O)
r = await api('GET', `/api/insights/performance?from=${today.slice(0, 8)}01&to=${today}`, null, O)
const n = r.body.current
check('consultas, atendidas e faltas', n.appointments === 2 && n.attended === 1 && n.noShows === 1, show(r))
check('orçamentos criados × aprovados (conversão)', n.budgetsCreated === 2 && n.budgetsApproved === 1 && n.budgetsApprovedCents === 50000 && n.budgetsCreatedCents === 80000, show(r))
check('recebido e pago no período', n.receivedCents === 20000 && n.paidCents === 15000, show(r))
check('pacientes novos', n.newPatients === 2, show(r))
check('6 meses de receitas × despesas', r.body.months.length === 6 && r.body.months[5].receivedCents === 20000, show(r))
check('período anterior vazio para comparar', r.body.previous.appointments === 0, show(r))
check('por profissional', r.body.byProfessional[0].attended === 1 && r.body.byProfessional[0].no_shows === 1, show(r))
r = await api('GET', `/api/insights/performance?from=${today}&to=${addDays(today, -1)}`, null, O)
check('período invertido é recusado', r.status === 400, show(r))
r = await api('GET', '/api/insights/tasks', null, O)
check('aniversariante de hoje', r.body.birthdays.some((b) => b.name === 'Bia Indicadores' && b.today && b.turns === Number(today.slice(0, 4)) - 1990), show(r))
check('inadimplência: parcela vencida com saldo', r.body.debtors.some((d) => d.name === 'Bia Indicadores' && d.overdueCents === 30000 && d.daysLate === 10), show(r))
check('tratamento em aberto sem consulta marcada', r.body.withoutAppointment.some((p) => p.name === 'Bia Indicadores' && p.openTreatments === 1), show(r))

console.log('[permissões]')
const inv = (await api('POST', '/api/team/invitations', { email: `dent+${s}@exemplo.com`, role: 'dentist', doesAttend: true }, O)).body
const D = (await api('POST', `/api/public/invitations/${inv.token}/accept`, { name: 'Dr. Dente', password: 'senha-forte-123' })).body.token
check('dentista (padrão) não vê estoque', (await api('GET', '/api/stock/products', null, D)).status === 403)
check('dentista (padrão) usa prótese', (await api('GET', '/api/prosthesis', null, D)).status === 200)
check('dentista (padrão) não vê indicadores de desempenho', (await api('GET', `/api/insights/performance?from=${today}&to=${today}`, null, D)).status === 403)
check('dentista vê o painel do dia', (await api('GET', '/api/insights/tasks', null, D)).status === 200)

console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)

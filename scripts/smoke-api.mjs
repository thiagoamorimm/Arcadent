// Smoke test da fatia vertical, ponta a ponta pela API real (backend + Postgres rodando).
//   node scripts/smoke-api.mjs [http://localhost:8090]
// Cria 2 clínicas novas a cada execução (e-mails únicos) e prova:
// cadastro → consulta → conflito → orçamento no odontograma → aprovação idempotente →
// tratamentos + parcelas → recebimento idempotente → isolamento entre clínicas.
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

const stamp = Date.now()
console.log('[cadastro e login]')
let r = await api('POST', '/api/auth/signup', { name: 'Ana Prado', email: `ana+${stamp}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Clínica Sorriso Teste' })
check('cadastro cria clínica e devolve token', r.status === 201 && r.body.token, JSON.stringify(r.body))
const A = r.body.token
r = await api('POST', '/api/auth/signup', { name: 'Ana Prado', email: `ana+${stamp}@exemplo.com`, password: 'outra-senha-123', clinicName: 'X' })
check('e-mail repetido → 409 EMAIL_TAKEN', r.status === 409 && r.body.code === 'EMAIL_TAKEN', JSON.stringify(r.body))
r = await api('POST', '/api/auth/login', { email: `ana+${stamp}@exemplo.com`, password: 'errada' })
check('senha errada → 401', r.status === 401)
r = await api('POST', '/api/auth/login', { email: `ANA+${stamp}@exemplo.com`, password: 'senha-forte-123' })
check('login (e-mail sem diferenciar maiúsculas)', r.status === 200 && r.body.clinics.length === 1)
r = await api('GET', '/api/me', null, A)
check('/me com trial de 14 dias', r.status === 200 && r.body.subscription_status === 'trialing' && Math.round((Date.parse(r.body.trial_ends_at) - Date.now()) / 86400000) === 14, JSON.stringify(r.body))

console.log('\n[cadastros iniciais]')
const pros = (await api('GET', '/api/professionals', null, A)).body
const procs = (await api('GET', '/api/procedures', null, A)).body
const accounts = (await api('GET', '/api/financial-accounts', null, A)).body
check('dono aparece como profissional', pros.length === 1)
check('tabela de procedimentos semeada', procs.length >= 10)
check('contas financeiras semeadas', accounts.length === 2 && accounts[0].isDefault)
const prof = pros[0].id
const resina = procs.find((p) => p.name.includes('1 face'))
const canal = procs.find((p) => p.name.includes('multirradicular'))

console.log('\n[agenda]')
r = await api('POST', '/api/appointments', { professionalId: prof, newPatient: { name: 'Marina Lopes', phone: '(48) 99812-3301' }, startAt: '2026-11-03T12:00:00Z', endAt: '2026-11-03T12:30:00Z' }, A)
check('consulta com cadastro rápido de paciente', r.status === 201 && r.body.patientName === 'Marina Lopes', JSON.stringify(r.body))
const patientId = r.body.patientId
const apptId = r.body.id
r = await api('POST', '/api/appointments', { professionalId: prof, patientId, startAt: '2026-11-03T12:15:00Z', endAt: '2026-11-03T12:45:00Z' }, A)
check('horário sobreposto → 409 APPOINTMENT_CONFLICT', r.status === 409 && r.body.code === 'APPOINTMENT_CONFLICT', JSON.stringify(r.body))
r = await api('POST', '/api/appointments', { professionalId: prof, patientId, startAt: '2026-11-03T12:15:00Z', endAt: '2026-11-03T12:45:00Z', overlapAllowed: true }, A)
check('encaixe consciente passa', r.status === 201)
r = await api('GET', '/api/appointments?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z', null, A)
check('lista da semana traz as 2 consultas', r.status === 200 && r.body.length === 2)
r = await api('PATCH', `/api/appointments/${apptId}`, { status: 'confirmado' }, A)
check('muda status para confirmado', r.body.status === 'confirmado')

console.log('\n[orçamento → aprovação → tratamentos + débitos]')
r = await api('POST', `/api/patients/${patientId}/budgets`, {
  professionalId: prof, installments: 3, discountCents: 1000, firstDueDate: '2026-11-10',
  items: [{ procedureId: resina.id, tooth: 16, faces: ['O', 'M'] }, { procedureId: canal.id, tooth: 46 }],
}, A)
check('orçamento criado com itens por dente/face', r.status === 201 && r.body.items.length === 2 && r.body.items[0].faces.join('') === 'OM', JSON.stringify(r.body))
const budget = r.body
const expectedTotal = resina.priceCents + canal.priceCents - 1000
check('total = itens − desconto', budget.totalCents === expectedTotal, `${budget.totalCents} vs ${expectedTotal}`)
r = await api('POST', `/api/patients/${patientId}/budgets`, { professionalId: prof, items: [{ procedureId: resina.id, tooth: 99 }] }, A)
check('dente inválido → 400', r.status === 400 && r.body.code === 'TOOTH')
const [a1, a2] = await Promise.all([
  api('POST', `/api/budgets/${budget.id}/approve`, {}, A),
  api('POST', `/api/budgets/${budget.id}/approve`, {}, A),
])
check('duas aprovações simultâneas → ambas OK', a1.status === 200 && a2.status === 200, `${a1.status} ${a2.status}`)
const treatments = (await api('GET', `/api/patients/${patientId}/treatments`, null, A)).body
check('gera exatamente 2 tratamentos (sem duplicar)', treatments.length === 2, JSON.stringify(treatments.length))
const debits = (await api('GET', `/api/patients/${patientId}/debits`, null, A)).body
check('gera 3 parcelas', debits.length === 3)
check('parcelas somam o total exato', debits.reduce((s, d) => s + d.amountCents, 0) === expectedTotal)
check('vencimentos mensais', debits.map((d) => d.dueDate).join() === '2026-11-10,2026-12-10,2027-01-10')

console.log('\n[recebimento]')
const d1 = debits[0]
const key = 'smoke-' + stamp
const [p1, p2] = await Promise.all([
  api('POST', `/api/debits/${d1.id}/payments`, { amountCents: 10000, method: 'pix', financialAccountId: accounts[0].id }, A, { 'Idempotency-Key': key }),
  api('POST', `/api/debits/${d1.id}/payments`, { amountCents: 10000, method: 'pix', financialAccountId: accounts[0].id }, A, { 'Idempotency-Key': key }),
])
check('pagamento repetido (mesma chave) não duplica', [p1.status, p2.status].every((s) => s === 201 || s === 200) && p1.body.payment.id === p2.body.payment.id, `${p1.status} ${p2.status} ${JSON.stringify(p2.body)}`)
r = await api('GET', `/api/patients/${patientId}/debits`, null, A)
const after = r.body.find((d) => d.id === d1.id)
check('débito vira parcial com 100,00 pago', after.status === 'partial' && after.paidCents === 10000, JSON.stringify(after))
r = await api('POST', `/api/debits/${d1.id}/payments`, { amountCents: after.amountCents, method: 'dinheiro', financialAccountId: accounts[0].id }, A, { 'Idempotency-Key': key + '-b' })
check('receber acima do saldo → 422', r.status === 422 && r.body.code === 'OVERPAYMENT', JSON.stringify(r.body))
r = await api('POST', `/api/debits/${d1.id}/payments`, { amountCents: after.amountCents - after.paidCents, method: 'dinheiro', financialAccountId: accounts[0].id }, A, { 'Idempotency-Key': key + '-c' })
check('quitar o restante → paid', r.status === 201 && r.body.debit.status === 'paid', JSON.stringify(r.body))
r = await api('GET', `/api/patients/${patientId}`, null, A)
check('ficha mostra saldo devedor atualizado', r.body.balanceCents === expectedTotal - d1.amountCents, `${r.body.balanceCents}`)

console.log('\n[tratamentos]')
r = await api('POST', '/api/treatments/finish', { ids: [treatments[0].id] }, A)
check('finaliza tratamento', r.status === 200 && r.body[0].status === 'done')

console.log('\n[isolamento entre clínicas]')
r = await api('POST', '/api/auth/signup', { name: 'Beto Lima', email: `beto+${stamp}@exemplo.com`, password: 'senha-forte-456', clinicName: 'Clínica Outra' })
const B = r.body.token
r = await api('GET', `/api/patients/${patientId}`, null, B)
check('clínica B não vê paciente da A (404)', r.status === 404)
r = await api('GET', '/api/patients', null, B)
check('lista da clínica B vem vazia', r.body.total === 0)
r = await api('GET', `/api/patients/${patientId}/debits`, null, B)
check('débitos da A invisíveis para B', Array.isArray(r.body) && r.body.length === 0)
const profB = (await api('GET', '/api/professionals', null, B)).body[0].id
r = await api('POST', '/api/appointments', { professionalId: profB, patientId, startAt: '2026-11-04T12:00:00Z', endAt: '2026-11-04T12:30:00Z' }, B)
check('B não marca consulta com paciente da A', r.status >= 400, `${r.status}`)
r = await api('POST', `/api/debits/${debits[1].id}/payments`, { amountCents: 100, method: 'pix', financialAccountId: accounts[0].id }, B, { 'Idempotency-Key': 'x-' + stamp })
check('B não recebe débito da A (404)', r.status === 404, `${r.status}`)

console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)

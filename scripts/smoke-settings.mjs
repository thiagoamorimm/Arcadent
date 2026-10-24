// Smoke test de Ajustes + permissões, pela API real.
//   node scripts/smoke-settings.mjs [http://localhost:8090]
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
const s = Date.now()
const show = (r) => `${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`

console.log('[equipe e convites]')
let r = await api('POST', '/api/auth/signup', { name: 'Dona Clara', email: `clara+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Clínica Ajustes' })
const O = r.body.token
r = await api('GET', '/api/settings/permissions', null, O)
check('catálogo de permissões com grupos e presets', r.body.groups.length === 6 && r.body.groups.some((g) => g.key === 'clinica') && r.body.presets.secretary.length > 0)
const ownerMe = (await api('GET', '/api/me', null, O)).body
check('/me do dono traz todas as permissões', ownerMe.permissions.length > 25 && ownerMe.role === 'owner')

r = await api('POST', '/api/team/invitations', { email: `sec+${s}@exemplo.com`, name: 'Sérgio Recepção', role: 'secretary' }, O)
check('convite de secretária devolve token', r.status === 201 && r.body.token?.length > 30, show(r))
const secToken = r.body.token
r = await api('GET', `/api/public/invitations/${secToken}`)
check('prévia pública do convite (sem login)', r.status === 200 && r.body.clinicName === 'Clínica Ajustes' && !r.body.hasAccount, show(r))
r = await api('GET', '/api/public/invitations/token-que-nao-existe-de-jeito-nenhum')
check('token inválido → 404', r.status === 404)
r = await api('POST', `/api/public/invitations/${secToken}/accept`, { password: 'senha-sec-123' })
check('aceite cria conta e entra na clínica', r.status === 200 && r.body.clinicName === 'Clínica Ajustes', show(r))
const S = r.body.token
r = await api('POST', `/api/public/invitations/${secToken}/accept`, { password: 'senha-sec-123' })
check('convite usado de novo → 410', r.status === 410, show(r))
r = await api('POST', '/api/team/invitations', { email: `SEC+${s}@exemplo.com`, role: 'secretary' }, O)
check('convidar quem já é da equipe → 409', r.status === 409 && r.body.code === 'ALREADY_MEMBER', show(r))

const sMe = (await api('GET', '/api/me', null, S)).body
check('secretária recebe o preset', sMe.role === 'secretary' && sMe.permissions.includes('agenda.view_all') && !sMe.permissions.includes('config.team'))
check('secretária não vê a equipe (403)', (await api('GET', '/api/team', null, S)).status === 403)
check('secretária não cria tabela de preço (403)', (await api('POST', '/api/price-tables', { name: 'X' }, S)).status === 403)

const pros = (await api('GET', '/api/professionals', null, O)).body
const ownerProf = pros[0].id
r = await api('POST', '/api/appointments', { professionalId: ownerProf, newPatient: { name: 'Paciente Um' }, startAt: '2026-11-10T13:00:00Z', endAt: '2026-11-10T13:30:00Z' }, S)
check('secretária marca na agenda da dona (create_for_others)', r.status === 201, show(r))
const patientId = r.body.patientId

console.log('\n[permissão vale na hora, sem novo login]')
const team = (await api('GET', '/api/team', null, O)).body
const secMember = team.members.find((m) => m.role === 'secretary')
r = await api('PATCH', `/api/team/${secMember.id}`, { permissions: secMember.permissions.filter((p) => p !== 'agenda.create') }, O)
check('dona tira "marcar consultas" da secretária', r.status === 200 && !r.body.permissions.includes('agenda.create'), show(r))
r = await api('POST', '/api/appointments', { professionalId: ownerProf, patientId, startAt: '2026-11-10T14:00:00Z', endAt: '2026-11-10T14:30:00Z' }, S)
check('mesmo token da secretária agora leva 403', r.status === 403, show(r))
r = await api('PATCH', `/api/team/${secMember.id}`, { permissions: ['bogus.perm', 'agenda.create', 'agenda.view_all'] }, O)
check('código de permissão desconhecido é descartado', r.body.permissions.join() === 'agenda.create,agenda.view_all', r.body.permissions?.join())
r = await api('PATCH', `/api/team/${secMember.id}`, { isActive: false }, O)
check('dona desativa a secretária', r.status === 200 && r.body.isActive === false)
r = await api('GET', '/api/patients', null, S)
check('token da desativada → 401 na hora', r.status === 401 && r.body.code === 'MEMBERSHIP_INACTIVE', show(r))
const ownerMember = team.members.find((m) => m.role === 'owner')
check('dona não pode se desativar (409)', (await api('PATCH', `/api/team/${ownerMember.id}`, { isActive: false }, O)).status === 409)
check('dono não perde permissões (409)', (await api('PATCH', `/api/team/${ownerMember.id}`, { permissions: [] }, O)).status === 409)

console.log('\n[dentista vê só a própria agenda]')
r = await api('POST', '/api/team/invitations', { email: `den+${s}@exemplo.com`, name: 'Dr. Davi', role: 'dentist', doesAttend: true }, O)
const D = (await api('POST', `/api/public/invitations/${r.body.token}/accept`, { password: 'senha-den-123' })).body.token
const pros2 = (await api('GET', '/api/professionals', null, O)).body
check('dentista convidado aparece como profissional', pros2.length === 2)
r = await api('GET', '/api/appointments?from=2026-11-09T00:00:00Z&to=2026-11-16T00:00:00Z', null, D)
check('dentista não vê consultas da dona', r.status === 200 && r.body.length === 0, show(r))
r = await api('GET', '/api/appointments?from=2026-11-09T00:00:00Z&to=2026-11-16T00:00:00Z', null, O)
check('dona vê todas', r.body.length === 1)
r = await api('POST', '/api/appointments', { professionalId: ownerProf, patientId, startAt: '2026-11-11T13:00:00Z', endAt: '2026-11-11T13:30:00Z' }, D)
check('dentista não marca na agenda da dona (403)', r.status === 403)
r = await api('GET', `/api/patients/${patientId}/debits`, null, D)
check('dentista vê débitos (preset)', r.status === 200)

console.log('\n[tabelas de preço e procedimentos]')
let tables = (await api('GET', '/api/price-tables', null, O)).body
const particular = tables[0]
check('tabela Particular é a padrão', particular.isDefault && particular.procedureCount >= 10)
r = await api('POST', '/api/price-tables', { name: 'Convênio Sorriso', kind: 'convenio', copyFrom: particular.id }, O)
check('convênio copiando a Particular', r.status === 201 && r.body.procedureCount === particular.procedureCount, show(r))
const conv = r.body
r = await api('PATCH', `/api/price-tables/${conv.id}`, { name: 'Convênio Sorriso', isDefault: true }, O)
tables = (await api('GET', '/api/price-tables', null, O)).body
check('troca a tabela padrão (só uma padrão)', tables.filter((t) => t.isDefault).length === 1 && tables.find((t) => t.id === conv.id).isDefault)
r = await api('PATCH', `/api/price-tables/${conv.id}`, { name: 'Convênio Sorriso', isActive: false }, O)
check('não desativa a tabela padrão (409)', r.status === 409)
await api('PATCH', `/api/price-tables/${particular.id}`, { name: 'Particular', isDefault: true }, O)
r = await api('POST', `/api/price-tables/${particular.id}/procedures`, { name: 'Facetas em resina', tussCode: '85200999', priceCents: 45000, scope: 'tooth' }, O)
check('cria procedimento com TUSS', r.status === 201 && r.body.tussCode === '85200999', show(r))
const proc = r.body
r = await api('POST', `/api/price-tables/${particular.id}/procedures`, { name: 'X', tussCode: '12a' }, O)
check('TUSS com letra → 400', r.status === 400)
r = await api('PATCH', `/api/procedures/${proc.id}`, { priceCents: 48000 }, O)
check('reajusta preço', r.body.priceCents === 48000)
r = await api('GET', '/api/procedures?q=85200999', null, O)
check('busca do orçamento acha pelo TUSS', r.body.length === 1)
await api('PATCH', `/api/procedures/${proc.id}`, { isActive: false }, O)
r = await api('GET', '/api/procedures?q=Facetas', null, O)
check('desativado some da escolha no orçamento', r.body.length === 0)
r = await api('GET', `/api/price-tables/${particular.id}/procedures?includeInactive=true`, null, O)
check('mas continua listado em Ajustes', r.body.some((p) => p.id === proc.id && !p.isActive))

console.log('\n[rótulos]')
r = await api('POST', '/api/labels', { name: 'Prótese', color: '5' }, O)
check('cria rótulo', r.status === 201)
const lab = r.body
check('cor fora da paleta → 400', (await api('POST', '/api/labels', { name: 'X', color: '#ff0000' }, O)).status === 400)
r = await api('POST', '/api/appointments', { professionalId: ownerProf, patientId, labelId: lab.id, startAt: '2026-11-12T13:00:00Z', endAt: '2026-11-12T13:30:00Z' }, O)
const apptWithLabel = r.body.id
r = await api('GET', '/api/labels/manage', null, O)
check('mostra quantas consultas usam o rótulo', r.body.find((l) => l.id === lab.id).usage === 1)
check('exclui rótulo em uso (204)', (await api('DELETE', `/api/labels/${lab.id}`, null, O)).status === 204)
r = await api('GET', '/api/appointments?from=2026-11-12T00:00:00Z&to=2026-11-13T00:00:00Z', null, O)
check('consulta continua, só sem rótulo', r.body.find((a) => a.id === apptWithLabel)?.labelId == null)

console.log('\n[contas e categorias]')
let accounts = (await api('GET', '/api/financial-accounts/manage', null, O)).body
r = await api('POST', '/api/financial-accounts', { name: 'Banco Novo', kind: 'bank', isDefault: true }, O)
check('nova conta como padrão', r.status === 201 && r.body.isDefault)
accounts = (await api('GET', '/api/financial-accounts/manage', null, O)).body
check('só uma conta padrão', accounts.filter((a) => a.isDefault).length === 1)
const caixa = accounts.find((a) => a.name === 'Caixa da recepção')
const anyProc = (await api('GET', '/api/procedures', null, O)).body[0]
const budgetRes = await api('POST', `/api/patients/${patientId}/budgets`, { professionalId: ownerProf, items: [{ procedureId: anyProc.id }] }, O)
await api('POST', `/api/budgets/${budgetRes.body.id}/approve`, {}, O)
const debit = (await api('GET', `/api/patients/${patientId}/debits`, null, O)).body[0]
await api('POST', `/api/debits/${debit.id}/payments`, { amountCents: 1000, method: 'dinheiro', financialAccountId: caixa.id }, O, { 'Idempotency-Key': 'set-' + s })
r = await api('DELETE', `/api/financial-accounts/${caixa.id}`, null, O)
check('não exclui conta com movimento (409)', r.status === 409 && r.body.code === 'ACCOUNT_IN_USE', show(r))
r = await api('POST', '/api/financial-accounts', { name: 'Conta errada', kind: 'bank' }, O)
check('exclui conta sem uso (204)', (await api('DELETE', `/api/financial-accounts/${r.body.id}`, null, O)).status === 204)
const pastDate = new Date(Date.now() - 3 * 86400000).toISOString()
r = await api('POST', `/api/debits/${debit.id}/payments`, { amountCents: 100, method: 'pix', financialAccountId: caixa.id, paidAt: pastDate }, O, { 'Idempotency-Key': 'old-' + s })
check('dona registra com data passada', r.status === 201, show(r))
r = await api('POST', '/api/categories', { name: 'Aluguel', kind: 'expense' }, O)
check('categoria repetida → 409', r.status === 409 && r.body.code === 'CATEGORY_EXISTS', show(r))
r = await api('POST', '/api/categories', { name: 'Software', kind: 'expense' }, O)
check('cria categoria', r.status === 201)
r = await api('PATCH', `/api/categories/${r.body.id}`, { name: 'Sistemas e software' }, O)
check('renomeia categoria', r.body.name === 'Sistemas e software')
check('exclui categoria', (await api('DELETE', `/api/categories/${r.body.id}`, null, O)).status === 204)

console.log('\n[isolamento]')
const B = (await api('POST', '/api/auth/signup', { name: 'Outro', email: `outro+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Outra' })).body.token
check('outra clínica não edita procedimento da primeira', (await api('PATCH', `/api/procedures/${proc.id}`, { priceCents: 1 }, B)).status === 404)
check('outra clínica não vê as tabelas da primeira', (await api('GET', '/api/price-tables', null, B)).body.every((t) => t.id !== conv.id))
check('outra clínica não mexe na equipe da primeira', (await api('PATCH', `/api/team/${secMember.id}`, { isActive: true }, B)).status === 404)

console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)

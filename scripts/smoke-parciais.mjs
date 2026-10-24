// Smoke test dos must-haves que estavam parciais: débito avulso (parcelado) e cancelamentos,
// tratamento avulso, aprovação parcial/reprovação, responsável, anotação no dente, imagem na
// evolução, renovar sessão, recuperar senha, trocar de clínica, auditoria e modo leitura.
//   node scripts/smoke-parciais.mjs [http://localhost:8090]
// Precisa do backend com o perfil dev (caixa de saída de e-mail) e do container clinica-db.
import { execFileSync } from 'node:child_process'

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
const sql = (q) => execFileSync('docker', ['exec', 'clinica-db', 'psql', '-U', 'clinic_owner', '-d', 'clinica', '-tAc', q], { encoding: 'utf8' }).trim()
const s = Date.now()
const today = new Date().toISOString().slice(0, 10)
const addMonths = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const ownerEmail = `marta+${s}@exemplo.com`
let r = await api('POST', '/api/auth/signup', { name: 'Dra. Marta', email: ownerEmail, password: 'senha-forte-123', clinicName: 'Clínica Parciais' })
let O = r.body.token
const session1 = r.body
const prof = (await api('GET', '/api/professionals', null, O)).body[0].id
const procs = (await api('GET', '/api/procedures', null, O)).body
const accounts = (await api('GET', '/api/financial-accounts', null, O)).body
const byTooth = procs.find((p) => p.scope === 'tooth' || p.scope === 'face')
const mouth = procs.find((p) => p.scope === 'mouth' || p.scope === 'arch')
const pA = (await api('POST', '/api/patients', { name: 'Lucas Prado', birthDate: '2014-05-02' }, O)).body

console.log('[débito avulso]')
r = await api('POST', `/api/patients/${pA.id}/debits`, { description: 'Manutenção do aparelho', amountCents: 100000, installments: 3, firstDueDate: today }, O)
check('lança débito avulso em 3 parcelas', r.status === 201 && r.body.length === 3, show(r))
check('parcelas somam o total (resto na 1ª)', r.body.reduce((t, d) => t + d.amountCents, 0) === 100000 && r.body[0].amountCents === 33334 && r.body[1].amountCents === 33333, show(r))
check('vencimentos mês a mês', r.body[2].dueDate === addMonths(today, 2), show(r))
check('descrição numera as parcelas', r.body[1].description === 'Manutenção do aparelho — parcela 2/3', show(r))
const parcels = r.body
r = await api('POST', `/api/patients/${pA.id}/debits`, { description: 'x', amountCents: 2, installments: 3, firstDueDate: today }, O)
check('recusa valor menor que o nº de parcelas', r.status === 400, show(r))
r = await api('POST', `/api/debits/${parcels[2].id}/cancel`, {}, O)
check('cancela débito sem recebimento', r.status === 200 && r.body.status === 'canceled', show(r))
r = await api('GET', `/api/patients/${pA.id}/debits`, null, O)
check('cancelado some da lista do paciente', r.body.length === 2, show(r))
const key = `k-${s}`
r = await api('POST', `/api/debits/${parcels[0].id}/payments`, { amountCents: 10000, method: 'pix', financialAccountId: accounts[0].id }, O, { 'Idempotency-Key': key })
const payment = r.body.payment
r = await api('POST', `/api/debits/${parcels[0].id}/cancel`, {}, O)
check('não cancela débito que já recebeu', r.status === 409 && r.body.code === 'DEBIT_HAS_PAYMENTS', show(r))
r = await api('POST', `/api/payments/${payment.id}/cancel`, {}, O)
check('cancela recebimento: valor volta a ficar em aberto', r.status === 200 && r.body.paidCents === 0 && r.body.status === 'open', show(r))
r = await api('POST', `/api/payments/${payment.id}/cancel`, {}, O)
check('cancelar de novo é inofensivo', r.status === 200 && r.body.paidCents === 0, show(r))
r = await api('GET', `/api/patients/${pA.id}/payments`, null, O)
check('recebimento cancelado sai da lista', r.body.length === 0, show(r))
const p2 = (await api('POST', `/api/debits/${parcels[0].id}/payments`, { amountCents: 5000, method: 'dinheiro', financialAccountId: accounts[0].id }, O, { 'Idempotency-Key': key + 'b' })).body.payment
await api('POST', '/api/receipts', { paymentIds: [p2.id] }, O)
r = await api('POST', `/api/payments/${p2.id}/cancel`, {}, O)
check('recebimento com recibo exige cancelar o recibo antes', r.status === 409 && r.body.code === 'HAS_RECEIPT', show(r))

console.log('[tratamento avulso]')
r = await api('POST', `/api/patients/${pA.id}/treatments`, { procedureId: byTooth.id, professionalId: prof, teeth: [{ tooth: 36, faces: ['O'] }, { tooth: 46, faces: [] }], charge: true, priceCents: 15000 }, O)
check('lança tratamento avulso: um por dente', r.status === 201 && r.body.length === 2 && r.body.every((t) => t.status === 'open' && t.budgetNumber == null), show(r))
const avulsos = r.body
r = await api('GET', `/api/patients/${pA.id}/debits`, null, O)
const tDebits = r.body.filter((d) => d.description.startsWith(byTooth.name))
check('com "lançar débito": um débito por tratamento', tDebits.length === 2 && tDebits.every((d) => d.amountCents === 15000), show(r))
r = await api('POST', `/api/patients/${pA.id}/treatments`, { procedureId: byTooth.id, professionalId: prof, teeth: [], charge: false }, O)
check('procedimento por dente exige dente', r.status === 400, show(r))
r = await api('POST', `/api/patients/${pA.id}/treatments`, { procedureId: byTooth.id, professionalId: prof, teeth: [{ tooth: 19 }], charge: false }, O)
check('recusa dente inválido', r.status === 400, show(r))
r = await api('POST', `/api/patients/${pA.id}/treatments`, { procedureId: byTooth.id, professionalId: prof, teeth: [{ tooth: 56 }], charge: false }, O)
check('recusa decíduo inexistente (56: decíduos vão até 5)', r.status === 400, show(r))
r = await api('POST', `/api/patients/${pA.id}/treatments`, { procedureId: byTooth.id, professionalId: prof, teeth: [{ tooth: 55 }], charge: false }, O)
check('aceita decíduo 55', r.status === 201, show(r))
if (mouth) {
  r = await api('POST', `/api/patients/${pA.id}/treatments`, { procedureId: mouth.id, professionalId: prof, teeth: [], charge: false }, O)
  check('procedimento de boca toda dispensa dente', r.status === 201 && r.body.length === 1 && r.body[0].tooth == null, show(r))
}
r = await api('POST', `/api/treatments/${avulsos[1].id}/cancel`, {}, O)
check('cancela tratamento em aberto', r.status === 200 && r.body.status === 'canceled', show(r))
r = await api('GET', `/api/patients/${pA.id}/debits`, null, O)
check('débito do tratamento cancelado é cancelado junto', r.body.filter((d) => d.description.startsWith(byTooth.name)).length === 1, show(r))
await api('POST', '/api/treatments/finish', { ids: [avulsos[0].id] }, O)
r = await api('POST', `/api/treatments/${avulsos[0].id}/cancel`, {}, O)
check('não cancela tratamento finalizado', r.status === 409, show(r))

console.log('[tratamento: editar, excluir e histórico]')
const [tEd] = (await api('POST', `/api/patients/${pA.id}/treatments`, { procedureId: byTooth.id, professionalId: prof, teeth: [{ tooth: 14 }], charge: true, priceCents: 20000 }, O)).body
r = await api('PATCH', `/api/treatments/${tEd.id}`, { procedureId: byTooth.id, professionalId: prof, tooth: 15, faces: [], priceCents: 25000 }, O)
check('edita dente e valor', r.status === 200 && r.body.tooth === 15 && r.body.priceCents === 25000, show(r))
r = await api('GET', `/api/patients/${pA.id}/debits`, null, O)
check('débito avulso não pago acompanha o novo valor e o dente', r.body.some((d) => d.amountCents === 25000 && d.description.endsWith('dente 15')), show(r))
r = await api('PATCH', `/api/treatments/${tEd.id}`, { procedureId: byTooth.id, professionalId: prof, tooth: 59, priceCents: 1 }, O)
check('editar para dente inexistente é recusado', r.status === 400, show(r))
r = await api('GET', `/api/treatments/${tEd.id}/history`, null, O)
check('histórico: lançado e editado, com quem', r.body.map((h) => h.action).join() === 'treatment.create,treatment.update' && r.body[1].userName === 'Dra. Marta', show(r))
const upd = r.body[1]
check('histórico guarda antes e depois', JSON.parse(upd.before).tooth === 14 && JSON.parse(upd.after).tooth === 15 && JSON.parse(upd.after).priceCents === 25000, show(r))
r = await api('PATCH', `/api/treatments/${tEd.id}`, { procedureId: byTooth.id, professionalId: prof, tooth: 15, faces: [], priceCents: 25000 }, O)
r = await api('GET', `/api/treatments/${tEd.id}/history`, null, O)
check('salvar sem mudar nada não suja o histórico', r.body.length === 2, show(r))
r = await api('DELETE', `/api/treatments/${tEd.id}`, null, O)
check('exclui tratamento', r.status === 204)
r = await api('GET', `/api/patients/${pA.id}/treatments`, null, O)
check('excluído sai do odontograma (fica como cancelado)', r.body.find((t) => t.id === tEd.id)?.status === 'canceled', show(r))
r = await api('GET', `/api/patients/${pA.id}/debits`, null, O)
check('débito avulso não pago é cancelado junto', !r.body.some((d) => d.amountCents === 25000 && d.description.endsWith('dente 15')), show(r))
r = await api('GET', `/api/treatments/${tEd.id}/history`, null, O)
check('histórico registra a exclusão com como estava', r.body.at(-1).action === 'treatment.delete' && JSON.parse(r.body.at(-1).before).tooth === 15, show(r))
r = await api('PATCH', `/api/treatments/${tEd.id}`, { procedureId: byTooth.id, professionalId: prof, tooth: 16, priceCents: 1 }, O)
check('excluído não edita', r.status === 409, show(r))

console.log('[orçamento: aprovar parte / reprovar]')
const b = (await api('POST', `/api/patients/${pA.id}/budgets`, { professionalId: prof, installments: 2, firstDueDate: today, discountCents: 1000,
  items: [{ procedureId: byTooth.id, tooth: 11, priceCents: 20000 }, { procedureId: byTooth.id, tooth: 21, priceCents: 30000 }] }, O)).body
r = await api('POST', `/api/budgets/${b.id}/approve`, { itemIds: [b.items[0].id] }, O)
check('aprova só um item: status "parte"', r.status === 200 && r.body.status === 'partial', show(r))
check('total = item aprovado − desconto', r.body.totalCents === 19000, show(r))
check('item não aprovado marcado', r.body.items.find((i) => i.id === b.items[1].id).approved === false, show(r))
r = await api('GET', `/api/patients/${pA.id}/debits`, null, O)
const bDebits = r.body.filter((d) => d.budgetId === b.id)
check('parcelas sobre o total aprovado', bDebits.length === 2 && bDebits.reduce((t, d) => t + d.amountCents, 0) === 19000, show(r))
const b2 = (await api('POST', `/api/patients/${pA.id}/budgets`, { professionalId: prof, items: [{ procedureId: byTooth.id, tooth: 12 }] }, O)).body
r = await api('POST', `/api/budgets/${b2.id}/reject`, { reason: 'achou caro' }, O)
check('reprova com motivo', r.status === 200 && r.body.status === 'rejected', show(r))
r = await api('POST', `/api/budgets/${b2.id}/approve`, {}, O)
check('reprovado não aprova', r.status === 409, show(r))

console.log('[responsável]')
r = await api('PATCH', `/api/patients/${pA.id}`, { name: pA.name, birthDate: '2014-05-02', guardian: { name: 'Carla Prado', cpf: '123.456.789-09', phone: '(48) 99999-0000', relation: 'mãe' } }, O)
check('salva responsável', r.status === 200 && r.body.guardian?.name === 'Carla Prado' && r.body.guardian.relation === 'mãe', show(r))
r = await api('GET', `/api/patients/${pA.id}`, null, O)
check('responsável volta na ficha', r.body.guardian?.cpf === '123.456.789-09', show(r))
r = await api('PATCH', `/api/patients/${pA.id}`, { name: pA.name, guardian: { name: '  ' } }, O)
check('sem nome = sem responsável', r.status === 200 && !r.body.guardian, show(r))

console.log('[anotação no dente]')
r = await api('POST', `/api/patients/${pA.id}/tooth-notes`, { tooth: 36, note: 'Sensibilidade ao frio' }, O)
check('anota no dente', r.status === 201 && r.body.tooth === 36 && r.body.canDelete === true, show(r))
const note = r.body
r = await api('POST', `/api/patients/${pA.id}/tooth-notes`, { tooth: 99, note: 'x' }, O)
check('recusa dente inexistente', r.status === 400, show(r))
r = await api('GET', `/api/patients/${pA.id}/tooth-notes`, null, O)
check('lista as anotações com autor', r.body.length === 1 && r.body[0].authorName === 'Dra. Marta', show(r))
r = await api('DELETE', `/api/tooth-notes/${note.id}`, null, O)
check('autor apaga nas primeiras 24 h', r.status === 204, show(r))
check('apagada fica no audit_log', sql(`select count(*) from audit_log where action = 'tooth_note.delete' and entity_id = '${note.id}'`) === '1')

console.log('[imagem na evolução]')
const ev = (await api('POST', `/api/patients/${pA.id}/evolutions`, { body: 'Restauração do 36, sem intercorrências.' }, O)).body
const up = async (evolutionId, patientId = pA.id) => {
  const form = new FormData()
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'foto-36.png')
  if (evolutionId) form.append('evolutionId', evolutionId)
  const res = await fetch(`${BASE}/api/patients/${patientId}/files`, { method: 'POST', headers: { Authorization: 'Bearer ' + O }, body: form })
  return { status: res.status, body: await res.json() }
}
r = await up(ev.id)
check('anexa imagem à evolução', r.status === 201 && r.body.evolutionId === ev.id, show(r))
r = await api('GET', `/api/patients/${pA.id}/evolutions`, null, O)
check('evolução lista o anexo', r.body[0].files.length === 1 && r.body[0].files[0].fileName === 'foto-36.png', show(r))
r = await api('GET', `/api/patients/${pA.id}/files`, null, O)
check('anexo aparece também em Imagens', r.body.some((f) => f.evolutionId === ev.id), show(r))
const pOther = (await api('POST', '/api/patients', { name: 'Outro Paciente' }, O)).body
r = await up(ev.id, pOther.id)
check('não anexa evolução de outro paciente', r.status === 400, show(r))

console.log('[sessão: renovar e sair]')
check('login devolve token de renovação', typeof session1.refreshToken === 'string' && session1.refreshToken.length > 30)
r = await api('POST', '/api/auth/refresh', { refreshToken: session1.refreshToken, clinicId: session1.clinicId })
check('renova a sessão', r.status === 200 && r.body.token && r.body.refreshToken !== session1.refreshToken, show(r))
const s2 = r.body
r = await api('GET', '/api/me', null, s2.token)
check('token renovado funciona', r.status === 200 && r.body.clinic_id === session1.clinicId, show(r))
r = await api('POST', '/api/auth/refresh', { refreshToken: session1.refreshToken })
check('token já usado (dentro de 1 min) = corrida, não derruba', r.status === 409 && r.body.code === 'REFRESH_RACE', show(r))
sql(`update refresh_tokens set revoked_at = now() - interval '5 minutes' where token_hash = encode(sha256('${session1.refreshToken}'::bytea), 'hex')`)
r = await api('POST', '/api/auth/refresh', { refreshToken: session1.refreshToken })
check('reuso tardio = roubo: recusa', r.status === 401 && r.body.code === 'INVALID_REFRESH', show(r))
r = await api('POST', '/api/auth/refresh', { refreshToken: s2.refreshToken })
check('...e derruba todas as sessões do usuário', r.status === 401, show(r))
r = await api('POST', '/api/auth/login', { email: ownerEmail, password: 'senha-forte-123' })
O = r.body.token
const s3 = r.body
r = await api('POST', '/api/auth/logout', { refreshToken: s3.refreshToken })
check('sair revoga o token de renovação', r.status === 204 && (await api('POST', '/api/auth/refresh', { refreshToken: s3.refreshToken })).status === 401)

console.log('[recuperar senha]')
r = await api('POST', '/api/auth/forgot', { email: `ninguem+${s}@exemplo.com` })
check('e-mail sem conta: mesma resposta', r.status === 204, show(r))
r = await api('POST', '/api/auth/forgot', { email: ownerEmail.toUpperCase() })
check('e-mail com conta: 204', r.status === 204, show(r))
let mail = (await api('GET', `/api/public/dev/outbox?to=${encodeURIComponent(ownerEmail)}`)).body
check('link chega na caixa de saída', mail.length === 1 && /redefinir-senha\?token=/.test(mail[0].body), show({ status: 200, body: mail }))
const firstToken = mail[0].body.match(/token=([\w-]+)/)[1]
await api('POST', '/api/auth/forgot', { email: ownerEmail })
mail = (await api('GET', `/api/public/dev/outbox?to=${encodeURIComponent(ownerEmail)}`)).body
const resetToken = mail[0].body.match(/token=([\w-]+)/)[1]
r = await api('POST', '/api/auth/reset', { token: firstToken, password: 'outra-senha-456' })
check('pedir de novo invalida o link anterior', r.status === 400 && r.body.code === 'INVALID_RESET', show(r))
r = await api('POST', '/api/auth/reset', { token: resetToken, password: 'curta' })
check('senha curta recusada', r.status === 400, show(r))
const before = (await api('POST', '/api/auth/login', { email: ownerEmail, password: 'senha-forte-123' })).body
r = await api('POST', '/api/auth/reset', { token: resetToken, password: 'outra-senha-456' })
check('redefine e já entra', r.status === 200 && r.body.token && r.body.refreshToken, show(r))
O = r.body.token
check('outras sessões caem', (await api('POST', '/api/auth/refresh', { refreshToken: before.refreshToken })).status === 401)
check('link é de uso único', (await api('POST', '/api/auth/reset', { token: resetToken, password: 'mais-uma-789' })).status === 400)
check('senha antiga não entra', (await api('POST', '/api/auth/login', { email: ownerEmail, password: 'senha-forte-123' })).status === 401)
check('senha nova entra', (await api('POST', '/api/auth/login', { email: ownerEmail, password: 'outra-senha-456' })).status === 200)

console.log('[trocar de clínica]')
const other = (await api('POST', '/api/auth/signup', { name: 'Dr. Rui', email: `rui+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Odonto Rui' })).body
const inv = (await api('POST', '/api/team/invitations', { email: ownerEmail, role: 'dentist', doesAttend: true }, other.token)).body
r = await api('POST', `/api/public/invitations/${inv.token}/accept`, { password: 'outra-senha-456' })
check('aceita convite de outra clínica com a conta que já tem', r.status === 200, show(r))
r = await api('GET', '/api/me', null, O)
check('/me lista as duas clínicas', r.body.clinics?.length === 2, show(r))
r = await api('POST', '/api/auth/switch', { clinicId: other.clinicId }, O)
check('troca para a outra clínica', r.status === 200 && r.body.clinicId === other.clinicId, show(r))
const OR = r.body.token
r = await api('GET', `/api/patients/${pA.id}`, null, OR)
check('na outra clínica, paciente da primeira não aparece', r.status === 404, show(r))
r = await api('GET', '/api/me', null, OR)
check('papel muda junto (dentista lá)', r.body.role === 'dentist', show(r))
r = await api('POST', '/api/auth/switch', { clinicId: '00000000-0000-0000-0000-000000000000' }, O)
check('não troca para clínica sem vínculo', r.status === 403, show(r))

console.log('[auditoria]')
r = await api('GET', `/api/audit?patientId=${pA.id}`, null, O)
const acts = new Set(r.body.items?.map((i) => i.action))
check('trilha por paciente', r.status === 200 && ['patient.view', 'debit.cancel', 'payment.cancel', 'treatment.create', 'budget.approve_partial', 'budget.reject'].every((a) => acts.has(a)), show(r))
check('nome do paciente e detalhe resolvidos', r.body.items.every((i) => i.patientName === 'Lucas Prado'), show(r))
const views = r.body.items.filter((i) => i.action === 'patient.view').length
await api('GET', `/api/patients/${pA.id}`, null, O)
r = await api('GET', `/api/audit?patientId=${pA.id}&action=patient.view`, null, O)
check('ficha aberta de novo em 30 min não duplica', r.body.items.length === views, show(r))
r = await api('GET', '/api/audit?action=payment.', null, O)
check('filtra por tipo (prefixo)', r.body.items.length > 0 && r.body.items.every((i) => i.action.startsWith('payment.')), show(r))
r = await api('GET', '/api/audit', null, OR)
check('dentista sem gestão de equipe não vê', r.status === 403, show(r))
r = await api('GET', '/api/audit', null, other.token)
check('cada clínica vê só a sua trilha', r.status === 200 && r.body.items.every((i) => i.patientId !== pA.id), show(r))

console.log('[modo leitura]')
sql(`update subscriptions set trial_ends_at = now() - interval '1 day' where clinic_id = '${session1.clinicId}'`)
r = await api('GET', '/api/me', null, O)
check('/me avisa modo leitura', r.body.read_only === true, show(r))
r = await api('GET', `/api/patients/${pA.id}/debits`, null, O)
check('leitura continua liberada', r.status === 200, show(r))
r = await api('POST', '/api/patients', { name: 'Novo' }, O)
check('gravação bloqueada (402 READ_ONLY)', r.status === 402 && r.body.code === 'READ_ONLY', show(r))
r = await api('POST', '/api/auth/switch', { clinicId: other.clinicId }, O)
check('trocar de clínica continua possível', r.status === 200, show(r))
r = await api('POST', '/api/patients', { name: 'Paciente na clínica do Rui' }, r.body.token)
check('a outra clínica (em teste) grava normal', r.status === 201, show(r))
sql(`update subscriptions set status = 'active', current_period_end = now() + interval '30 days' where clinic_id = '${session1.clinicId}'`)
r = await api('POST', '/api/patients', { name: 'Novo' }, O)
check('assinatura ativa: volta a gravar', r.status === 201, show(r))

console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)

// Smoke test do financeiro: fluxo de caixa (receitas, despesas, receita sem vínculo, totais),
// recibo numerado (sequência sem buraco nem repetição, cancelamento) e PDFs de recibo e orçamento.
//   node scripts/smoke-financeiro.mjs [http://localhost:8090]
const BASE = process.argv[2] ?? 'http://localhost:8090'
let ok = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  OK   ' + name) } else { fail++; console.log('  FAIL ' + name + ' ' + extra) }
}
async function api(method, path, body, token, headers = {}, raw = false) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (raw) return { status: r.status, type: r.headers.get('content-type'), bytes: new Uint8Array(await r.arrayBuffer()) }
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: r.status, body: json }
}
const show = (r) => `${r.status} ${JSON.stringify(r.body)?.slice(0, 220)}`
const isPdf = (r) => r.status === 200 && r.type?.startsWith('application/pdf') && String.fromCharCode(...r.bytes.slice(0, 5)) === '%PDF-'
const s = Date.now()
const today = new Date().toISOString().slice(0, 10)
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const monthStart = today.slice(0, 8) + '01'
const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1)

let r = await api('POST', '/api/auth/signup', { name: 'Dra. Fernanda', email: `fer+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Clínica Financeiro' })
const O = r.body.token
const prof = (await api('GET', '/api/professionals', null, O)).body[0].id
const procs = (await api('GET', '/api/procedures', null, O)).body
const accounts = (await api('GET', '/api/financial-accounts', null, O)).body
const cats = (await api('GET', '/api/categories', null, O)).body
const catExp = cats.find((c) => c.kind === 'expense' && c.name === 'Aluguel')
const catInc = cats.find((c) => c.kind === 'income')
const caixa = accounts[0], banco = accounts[1]

const pA = (await api('POST', '/api/patients', { name: 'Paulo Andrade', cpf: '111.222.333-44' }, O)).body
const pB = (await api('POST', '/api/patients', { name: 'Beatriz Lima' }, O)).body
const mkBudget = async (pid, procName, inst) => {
  const proc = procs.find((p) => p.name.startsWith(procName))
  const b = (await api('POST', `/api/patients/${pid}/budgets`, { professionalId: prof, installments: inst, firstDueDate: today, items: [{ procedureId: proc.id, tooth: 16 }] }, O)).body
  await api('POST', `/api/budgets/${b.id}/approve`, {}, O)
  return b
}
const bA = await mkBudget(pA.id, 'Tratamento de canal — multi', 3) // 1400,00 em 3x
await mkBudget(pB.id, 'Extração', 1) // 300,00
const debitsA = (await api('GET', `/api/patients/${pA.id}/debits`, null, O)).body
const debitB = (await api('GET', `/api/patients/${pB.id}/debits`, null, O)).body[0]
const pay = async (debitId, cents, method, acc) => (await api('POST', `/api/debits/${debitId}/payments`, { amountCents: cents, method, financialAccountId: acc }, O, { 'Idempotency-Key': `${debitId}-${cents}-${Math.random()}` })).body.payment
const pay1 = await pay(debitsA[0].id, debitsA[0].amountCents, 'pix', banco.id)
const pay2 = await pay(debitsA[1].id, 20000, 'dinheiro', caixa.id)
const payB = await pay(debitB.id, debitB.amountCents, 'cartao_credito', banco.id)

console.log('[despesas]')
r = await api('POST', '/api/expenses', { description: 'Aluguel de outubro', amountCents: 250000, dueDate: addDays(today, -2), categoryId: catExp.id }, O)
check('lança despesa a pagar (vencida)', r.status === 201 && r.body.status === 'atrasado', show(r))
const rent = r.body
r = await api('POST', '/api/expenses', { description: 'Resina composta', amountCents: 38990, dueDate: today, categoryId: catExp.id, paid: true, financialAccountId: banco.id, method: 'pix' }, O)
check('lança despesa já paga', r.status === 201 && r.body.status === 'pago', show(r))
const resin = r.body
r = await api('POST', '/api/expenses', { description: 'X', amountCents: 100, dueDate: today, categoryId: catInc.id }, O)
check('categoria de receita numa despesa → 400', r.status === 400 && r.body.code === 'CATEGORY')
r = await api('POST', '/api/expenses', { description: 'X', amountCents: 100, dueDate: today, paid: true }, O)
check('paga sem conta → 400', r.status === 400)
const [p1, p2] = await Promise.all([
  api('POST', `/api/expenses/${rent.id}/pay`, { financialAccountId: banco.id, method: 'transferencia' }, O),
  api('POST', `/api/expenses/${rent.id}/pay`, { financialAccountId: banco.id, method: 'transferencia' }, O),
])
check('pagar a despesa 2x ao mesmo tempo não muda nada', p1.status === 200 && p2.status === 200 && p1.body.paidAt === p2.body.paidAt, `${show(p1)} | ${show(p2)}`)
r = await api('DELETE', `/api/expenses/${rent.id}`, null, O)
check('não exclui despesa paga (409)', r.status === 409 && r.body.code === 'EXPENSE_PAID')
r = await api('POST', `/api/expenses/${rent.id}/unpay`, null, O)
check('desfaz pagamento', r.body.status === 'atrasado' && !r.body.paidAt, show(r))
r = await api('PATCH', `/api/expenses/${rent.id}`, { description: 'Aluguel de outubro (sala 2)', amountCents: 260000, dueDate: addDays(today, -2), categoryId: catExp.id }, O)
check('edita despesa', r.body.amountCents === 260000 && r.body.description.includes('sala 2'))
const tmp = (await api('POST', '/api/expenses', { description: 'Lançada por engano', amountCents: 1000, dueDate: today }, O)).body
check('exclui despesa não paga', (await api('DELETE', `/api/expenses/${tmp.id}`, null, O)).status === 204)

console.log('\n[receita sem vínculo]')
r = await api('POST', '/api/income', { description: 'Sublocação da sala 3', amountCents: 80000, dueDate: today, categoryId: catInc.id }, O)
check('lança receita sem paciente', r.status === 201 && r.body.type === 'receita_sem_vinculo' && r.body.patientId == null, show(r))
const income = r.body
const payInc = await pay(income.id, 80000, 'transferencia', banco.id)
check('recebe pela mesma rota de pagamento', !!payInc?.id)

console.log('\n[fluxo de caixa]')
r = await api('GET', `/api/cashflow?from=${monthStart}&to=${monthEnd}`, null, O)
check('fluxo do mês responde', r.status === 200, show(r))
const cf = r.body
const received = debitsA[0].amountCents + 20000 + debitB.amountCents + 80000
check('recebido no mês = soma dos pagamentos', cf.totals.receivedCents === received, `${cf.totals.receivedCents} vs ${received}`)
check('pago no mês = despesa paga (resina)', cf.totals.paidCents === 38990, `${cf.totals.paidCents}`)
check('saldo = recebido − pago', cf.totals.balanceCents === received - 38990)
check('a pagar inclui o aluguel em aberto', cf.totals.toPayCents >= 260000 || cf.totals.overduePayableCents >= 260000, JSON.stringify(cf.totals))
check('linhas trazem receita, receita sem vínculo e despesa', ['receita', 'receita_sem_vinculo', 'despesa'].every((t) => cf.rows.some((x) => x.type === t)))
const rowA0 = cf.rows.find((x) => x.id === debitsA[0].id)
check('receita paga mostra forma e conta', rowA0?.status === 'pago' && rowA0.method === 'pix' && rowA0.accountName === banco.name, JSON.stringify(rowA0))
const rowA1 = cf.rows.find((x) => x.id === debitsA[1].id)
check('receita paga em parte = parcial', !rowA1 || rowA1.status === 'parcial' || rowA1.dueDate > monthEnd, JSON.stringify(rowA1))
r = await api('GET', `/api/cashflow?from=${monthEnd}&to=${monthStart}`, null, O)
check('período invertido → 400', r.status === 400)

console.log('\n[recibos]')
r = await api('POST', '/api/receipts', { paymentIds: [pay1.id, pay2.id] }, O)
check('recibo nº 1 com 2 pagamentos do mesmo paciente', r.status === 201 && r.body.number === 1 && r.body.totalCents === debitsA[0].amountCents + 20000 && r.body.payerName === 'Paulo Andrade' && r.body.payerCpf === '111.222.333-44', show(r))
const rc1 = r.body
r = await api('POST', '/api/receipts', { paymentIds: [pay1.id] }, O)
check('mesmo pagamento em outro recibo → 409', r.status === 409 && r.body.code === 'ALREADY_RECEIPTED')
r = await api('POST', '/api/receipts', { paymentIds: [payB.id, pay1.id] }, O)
check('pagamentos de pacientes diferentes → 400 (ou 409)', r.status === 400 || r.status === 409, show(r))
r = await api('POST', '/api/receipts', { paymentIds: [payInc.id] }, O)
check('receita sem vínculo sem pagador → 400', r.status === 400 && r.body.code === 'PAYER')
const [ra, rb] = await Promise.all([
  api('POST', '/api/receipts', { paymentIds: [payB.id], payer: { name: 'Carlos Lima (responsável)', cpf: '999.888.777-66' } }, O),
  api('POST', '/api/receipts', { paymentIds: [payInc.id], payer: { name: 'Odonto Parceiros Ltda' } }, O),
])
const nums = [ra.body.number, rb.body.number].sort()
check('2 recibos ao mesmo tempo: nº 2 e 3, sem repetir', ra.status === 201 && rb.status === 201 && nums.join() === '2,3', `${show(ra)} | ${show(rb)}`)
check('recibo em nome do responsável', [ra.body, rb.body].some((x) => x.payerName.startsWith('Carlos Lima')))
r = await api('GET', `/api/receipts/${rc1.id}/pdf`, null, O, {}, true)
check('PDF do recibo', isPdf(r), `${r.status} ${r.type}`)
r = await api('GET', `/api/patients/${pA.id}/payments`, null, O)
check('pagamentos do paciente mostram o nº do recibo', r.body.filter((p) => p.receiptNumber === 1).length === 2, show(r))
r = await api('POST', `/api/receipts/${rc1.id}/cancel`, null, O)
check('cancela recibo (mantém o número)', r.body.canceledAt && r.body.number === 1)
r = await api('GET', `/api/receipts/${rc1.id}/pdf`, null, O, {}, true)
check('PDF do recibo cancelado continua abrindo', isPdf(r))
r = await api('POST', '/api/receipts', { paymentIds: [pay1.id] }, O)
check('pagamento liberado recebe recibo novo: nº 4 (nunca reusa o 1)', r.status === 201 && r.body.number === 4, show(r))
r = await api('GET', '/api/receipts', null, O)
check('lista de recibos em ordem decrescente', r.body.map((x) => x.number).join() === '4,3,2,1', r.body.map((x) => x.number).join())

console.log('\n[PDF do orçamento]')
r = await api('GET', `/api/budgets/${bA.id}/pdf`, null, O, {}, true)
check('PDF do orçamento (3x, com parcelas)', isPdf(r) && r.bytes.length > 1500, `${r.status} ${r.bytes.length}`)

console.log('\n[permissões e isolamento]')
const invS = (await api('POST', '/api/team/invitations', { email: `rec+${s}@exemplo.com`, name: 'Rosa Recepção', role: 'secretary' }, O)).body
const S = (await api('POST', `/api/public/invitations/${invS.token}/accept`, { password: 'senha-rec-123' })).body.token
r = await api('GET', `/api/cashflow?from=${monthStart}&to=${monthEnd}`, null, S)
check('recepção (sem ver despesas) vê o fluxo só com receitas', r.status === 200 && r.body.rows.every((x) => x.type !== 'despesa') && r.body.totals.paidCents === 0, show(r))
check('recepção não lança despesa (403)', (await api('POST', '/api/expenses', { description: 'x', amountCents: 1, dueDate: today }, S)).status === 403)
check('recepção emite recibo (tem receber)', (await api('GET', '/api/receipts', null, S)).status === 200)
check('recepção não cancela recibo (403)', (await api('POST', `/api/receipts/${ra.body.id}/cancel`, null, S)).status === 403)
const B = (await api('POST', '/api/auth/signup', { name: 'Outro', email: `outro+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Outra' })).body.token
check('outra clínica não abre o recibo (404)', (await api('GET', `/api/receipts/${ra.body.id}/pdf`, null, B, {}, true)).status === 404)
check('outra clínica não paga a despesa (404)', (await api('POST', `/api/expenses/${resin.id}/pay`, { financialAccountId: banco.id, method: 'pix' }, B)).status === 404)
r = await api('GET', `/api/cashflow?from=${monthStart}&to=${monthEnd}`, null, B)
check('fluxo da outra clínica vem vazio', r.body.rows.length === 0 && r.body.totals.receivedCents === 0)

console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)

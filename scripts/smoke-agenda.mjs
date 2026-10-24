// Smoke test da agenda: fuso/expediente da clínica, horário por profissional, compromisso,
// bloqueio, conflito detalhado, mover, encaixe, editar, excluir.
//   node scripts/smoke-agenda.mjs [http://localhost:8090]
const BASE = process.argv[2] ?? 'http://localhost:8090'
let ok = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  OK   ' + name) } else { fail++; console.log('  FAIL ' + name + ' ' + extra) }
}
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: r.status, body: json }
}
const show = (r) => `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`
const s = Date.now()
// 2026-11-10 é terça. Em São Paulo (UTC-3), 09:00 local = 12:00Z.
const T = (hhmm, day = '2026-11-10') => `${day}T${hhmm}:00-03:00`

console.log('[clínica: fuso e expediente]')
let r = await api('POST', '/api/auth/signup', { name: 'Dra. Helena', email: `helena+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Clínica Agenda' })
const O = r.body.token
r = await api('GET', '/api/clinic', null, O)
check('clínica nova nasce com fuso de São Paulo e expediente padrão', r.body.timezone === 'America/Sao_Paulo' && r.body.businessHours.mon.length === 2 && r.body.businessHours.sun.length === 0, show(r))
const clinic = r.body
r = await api('PATCH', '/api/clinic', { ...clinic, timezone: 'Marte/Olympus' }, O)
check('fuso inválido → 400', r.status === 400 && r.body.code === 'TIMEZONE')
r = await api('PATCH', '/api/clinic', { ...clinic, businessHours: { mon: [['09:00', '12:00'], ['11:00', '18:00']] } }, O)
check('intervalos sobrepostos → 400', r.status === 400 && r.body.code === 'HOURS', show(r))
r = await api('PATCH', '/api/clinic', { ...clinic, businessHours: { mon: [['18:00', '08:00']] } }, O)
check('fim antes do início → 400', r.status === 400)
r = await api('PATCH', '/api/clinic', { ...clinic, timezone: 'America/Manaus', businessHours: { ...clinic.businessHours, sat: [] } }, O)
check('muda fuso para Manaus e fecha o sábado', r.status === 200 && r.body.timezone === 'America/Manaus' && r.body.businessHours.sat.length === 0, show(r))
await api('PATCH', '/api/clinic', { ...clinic }, O) // volta para São Paulo

console.log('\n[horário do profissional]')
const pros = (await api('GET', '/api/professionals', null, O)).body
const P = pros[0]
check('profissional traz horário de atendimento', P.workHours.tue.length === 2)
r = await api('PUT', `/api/team/${P.id}/work-hours`, { workHours: { tue: [['13:00', '19:00']], wed: [['08:00', '12:00']] } }, O)
check('define terça só à tarde', r.status === 200 && r.body.workHours.tue[0][0] === '13:00' && r.body.workHours.mon.length === 0, show(r))

console.log('\n[consulta fora do horário = aviso, não bloqueio]')
r = await api('POST', '/api/appointments', { professionalId: P.id, newPatient: { name: 'Lia Martins' }, startAt: T('09:00'), endAt: T('09:30') }, O)
check('marca às 09:00 (fora: atende só à tarde) e vem outsideHours=true', r.status === 201 && r.body.outsideHours === true, show(r))
const lia = r.body
r = await api('POST', '/api/appointments', { professionalId: P.id, patientId: lia.patientId, startAt: T('14:00'), endAt: T('14:30') }, O)
check('às 14:00 vem outsideHours=false', r.status === 201 && r.body.outsideHours === false, show(r))
const c14 = r.body

console.log('\n[compromisso e bloqueio]')
r = await api('POST', '/api/appointments', { kind: 'bloqueio', professionalId: P.id, title: 'Almoço', startAt: T('12:00'), endAt: T('13:00') }, O)
check('cria bloqueio sem paciente', r.status === 201 && r.body.kind === 'bloqueio' && r.body.patientId == null, show(r))
r = await api('POST', '/api/appointments', { kind: 'bloqueio', professionalId: P.id, startAt: T('16:00'), endAt: T('17:00') }, O)
check('bloqueio sem nome → 400', r.status === 400 && r.body.code === 'TITLE_REQUIRED')
r = await api('POST', '/api/appointments', { professionalId: P.id, patientId: lia.patientId, startAt: T('12:30'), endAt: T('13:00') }, O)
check('consulta em cima do bloqueio → 409 "Horário bloqueado: Almoço (12:00–13:00)"', r.status === 409 && r.body.message.startsWith('Horário bloqueado: Almoço (12:00–13:00)'), show(r))
check('resposta traz a lista de conflitos', r.body.details?.conflicts?.length === 1 && r.body.details.conflicts[0].kind === 'bloqueio')
r = await api('POST', '/api/appointments', { kind: 'compromisso', professionalId: P.id, title: 'Reunião com laboratório', startAt: T('15:00'), endAt: T('15:30') }, O)
check('cria compromisso', r.status === 201 && r.body.title === 'Reunião com laboratório')
const meeting = r.body
r = await api('POST', '/api/appointments', { professionalId: P.id, patientId: lia.patientId, startAt: T('14:15'), endAt: T('14:45') }, O)
check('conflito diz com quem: "consulta de Lia Martins (14:00–14:30)"', r.status === 409 && r.body.message.includes('Lia Martins (14:00–14:30)'), show(r))

console.log('\n[mover, encaixe, editar]')
r = await api('PATCH', `/api/appointments/${c14.id}`, { startAt: T('15:00'), endAt: T('15:30') }, O)
check('mover para cima do compromisso → 409', r.status === 409 && r.body.message.includes('Reunião com laboratório'), show(r))
r = await api('PATCH', `/api/appointments/${c14.id}`, { startAt: T('15:00'), endAt: T('15:30'), overlapAllowed: true }, O)
check('mover como encaixe consciente passa', r.status === 200 && r.body.overlapAllowed === true)
r = await api('POST', '/api/appointments', { professionalId: P.id, patientId: lia.patientId, startAt: T('15:10'), endAt: T('15:20') }, O)
check('novo horário em cima de um encaixe também avisa (o banco sozinho deixaria)', r.status === 409, show(r))
r = await api('PATCH', `/api/appointments/${c14.id}`, { startAt: T('16:00'), endAt: T('16:45') }, O)
check('mover para horário livre tira a marca de encaixe', r.status === 200 && r.body.overlapAllowed === false && r.body.startAt.startsWith('2026-11-10T19:00'), show(r))
const pros2 = (await api('POST', '/api/team/invitations', { email: `dr2+${s}@exemplo.com`, name: 'Dr. Ivo', role: 'dentist', doesAttend: true }, O)).body
await api('POST', `/api/public/invitations/${pros2.token}/accept`, { password: 'senha-ivo-123' })
const ivo = (await api('GET', '/api/professionals', null, O)).body.find((p) => p.name === 'Dr. Ivo')
check('dentista convidado sem horário próprio (segue a clínica)', ivo && Object.values(ivo.workHours).every((d) => d.length === 0))
r = await api('PATCH', `/api/appointments/${c14.id}`, { professionalId: ivo.id }, O)
check('mover para outro profissional', r.status === 200 && r.body.professionalName === 'Dr. Ivo')
r = await api('PATCH', `/api/appointments/${meeting.id}`, { title: 'Reunião com o laboratório Alfa', notes: 'levar moldagens' }, O)
check('editar título e observação do compromisso', r.body.title === 'Reunião com o laboratório Alfa' && r.body.notes === 'levar moldagens')
r = await api('PATCH', `/api/appointments/${meeting.id}`, { title: '  ' }, O)
check('título em branco → 400', r.status === 400)
const label = (await api('GET', '/api/labels', null, O)).body[0]
await api('PATCH', `/api/appointments/${lia.id}`, { labelId: label.id }, O)
r = await api('PATCH', `/api/appointments/${lia.id}`, { clearLabel: true }, O)
check('tirar rótulo', r.body.labelId == null)

console.log('\n[cancelar e reativar]')
r = await api('PATCH', `/api/appointments/${lia.id}`, { status: 'cancelado' }, O)
check('cancelar', r.body.status === 'cancelado')
r = await api('POST', '/api/appointments', { professionalId: P.id, newPatient: { name: 'Rafael Souza' }, startAt: T('09:00'), endAt: T('09:30') }, O)
check('horário cancelado fica livre', r.status === 201, show(r))
r = await api('PATCH', `/api/appointments/${lia.id}`, { status: 'agendado' }, O)
check('reativar cancelado em horário já ocupado → 409', r.status === 409, show(r))

console.log('\n[excluir]')
r = await api('DELETE', `/api/appointments/${meeting.id}`, null, O)
check('dona exclui compromisso', r.status === 204)
r = await api('GET', `/api/appointments?from=${encodeURIComponent(T('00:00'))}&to=${encodeURIComponent(T('23:59'))}`, null, O)
check('sumiu da agenda', !r.body.some((a) => a.id === meeting.id))
const invS = (await api('POST', '/api/team/invitations', { email: `rec+${s}@exemplo.com`, role: 'secretary' }, O)).body
const S = (await api('POST', `/api/public/invitations/${invS.token}/accept`, { name: 'Renata Recepção', password: 'senha-rec-123' })).body.token
r = await api('DELETE', `/api/appointments/${lia.id}`, null, S)
check('recepção sem "excluir consultas" → 403', r.status === 403)
r = await api('PUT', `/api/team/${P.id}/work-hours`, { workHours: {} }, S)
check('recepção não muda horário de outro profissional → 403', r.status === 403)
r = await api('PATCH', '/api/clinic', { ...clinic }, S)
check('recepção não muda dados da clínica → 403', r.status === 403)
r = await api('GET', '/api/clinic', null, S)
check('mas lê fuso e expediente (a agenda precisa)', r.status === 200 && r.body.timezone)

console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)

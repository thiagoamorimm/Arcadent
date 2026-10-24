// Smoke test do prontuário: anamnese (modelos, rascunho, conclusão, alertas, PDF), evoluções,
// receita e atestado em PDF, upload de arquivos (tipo pelo conteúdo), permissões e isolamento.
//   node scripts/smoke-prontuario.mjs [http://localhost:8090]
const BASE = process.argv[2] ?? 'http://localhost:8090'
let ok = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  OK   ' + name) } else { fail++; console.log('  FAIL ' + name + ' ' + extra) }
}
async function api(method, path, body, token, raw = false) {
  const isForm = body instanceof FormData
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(isForm || !body ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  })
  if (raw) return { status: r.status, type: r.headers.get('content-type'), bytes: new Uint8Array(await r.arrayBuffer()) }
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: r.status, body: json }
}
const show = (r) => `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`
const isPdf = (r) => r.status === 200 && r.type?.startsWith('application/pdf') && String.fromCharCode(...r.bytes.slice(0, 5)) === '%PDF-' && r.bytes.length > 1500
const s = Date.now()

let r = await api('POST', '/api/auth/signup', { name: 'Dra. Olga Prado', email: `olga+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Clínica Prontuário' })
const O = r.body.token
const patient = (await api('POST', '/api/patients', { name: 'Ana <Teste> & Cia "Silva"', cpf: '123.456.789-09', birthDate: '1990-05-20' }, O)).body
const pid = patient.id

console.log('[modelos de anamnese]')
r = await api('GET', '/api/anamnesis-templates', null, O)
check('clínica nova vem com o modelo padrão', r.body.length === 1 && r.body[0].questions.length === 12, show(r))
const tpl = r.body[0]
r = await api('POST', '/api/anamnesis-templates', { name: 'Ruim', questions: [{ id: 'a', text: 'X', type: 'choice', options: ['só uma'] }] }, O)
check('escolha com 1 opção → 400', r.status === 400)
r = await api('POST', '/api/anamnesis-templates', { name: 'Ruim', questions: [{ id: 'a', text: 'X', type: 'yesno', alertOn: 'sim' }] }, O)
check('alerta sem nome → 400', r.status === 400)
r = await api('POST', '/api/anamnesis-templates', { name: 'Ruim', questions: [{ id: 'a', text: 'X', type: 'yesno' }, { id: 'a', text: 'Y', type: 'text' }] }, O)
check('id de pergunta repetido → 400', r.status === 400)
r = await api('POST', '/api/anamnesis-templates', { name: 'Anamnese infantil', questions: [{ id: 'k1', text: 'Usa chupeta?', type: 'yesno', alertOn: 'sim', alert: 'Chupeta' }] }, O)
check('cria modelo novo', r.status === 201 && r.body.questions[0].alert === 'Chupeta', show(r))

console.log('\n[anamnese do paciente]')
r = await api('POST', `/api/patients/${pid}/anamneses`, { templateId: tpl.id }, O)
check('começa anamnese (rascunho)', r.status === 201 && r.body.status === 'draft' && r.body.questions.length === 12, show(r))
const an = r.body
r = await api('PATCH', `/api/anamneses/${an.id}`, { answers: { q1: { value: 'nao' }, q3: { value: 'sim', detail: 'Penicilina' }, q9: { value: 'talvez' }, q99: { value: 'sim' } } }, O)
check('salva rascunho (valores inválidos e perguntas inexistentes descartados)', r.status === 200 && r.body.answers.q3.detail === 'Penicilina' && !r.body.answers.q9 && !r.body.answers.q99, show(r))
await api('PATCH', `/api/patients/${pid}`, { name: patient.name }, O)
r = await api('PATCH', `/api/anamneses/${an.id}`, { answers: { ...r.body.answers, q8: { value: 'Grávida' }, q12: { value: 'Paciente ansiosa' } }, complete: true }, O)
check('conclui e calcula alertas', r.status === 200 && r.body.status === 'completed' && r.body.alerts.join('|') === 'Alergia: Penicilina|Gestante', show(r))
r = await api('GET', `/api/patients/${pid}`, null, O)
check('alertas aparecem na ficha', r.body.clinicalAlerts?.join('|') === 'Alergia: Penicilina|Gestante', show(r))
r = await api('PATCH', `/api/anamneses/${an.id}`, { answers: {} }, O)
check('anamnese concluída é imutável (409)', r.status === 409 && r.body.code === 'ANAMNESIS_LOCKED')
check('não descarta concluída (409)', (await api('DELETE', `/api/anamneses/${an.id}`, null, O)).status === 409)
r = await api('GET', `/api/anamneses/${an.id}/pdf`, null, O, true)
check('PDF da anamnese (nome com < & " não quebra)', isPdf(r), `${r.status} ${r.type} ${r.bytes.length}`)
await api('PATCH', '/api/anamnesis-templates/' + tpl.id, { name: tpl.name, questions: tpl.questions.slice(0, 3) }, O)
r = await api('GET', `/api/anamneses/${an.id}`, null, O)
check('editar o modelo não muda a anamnese já feita', r.body.questions.length === 12)
const draft = (await api('POST', `/api/patients/${pid}/anamneses`, { templateId: tpl.id }, O)).body
check('descarta rascunho', (await api('DELETE', `/api/anamneses/${draft.id}`, null, O)).status === 204)

console.log('\n[evoluções]')
r = await api('POST', `/api/patients/${pid}/evolutions`, { body: 'Profilaxia realizada. Orientada sobre fio dental.' }, O)
check('registra evolução', r.status === 201 && r.body.canEdit, show(r))
const ev = r.body
r = await api('POST', `/api/patients/${pid}/evolutions`, { body: 'x', occurredAt: '2099-01-01T10:00:00Z' }, O)
check('evolução no futuro → 400', r.status === 400)
r = await api('PATCH', `/api/evolutions/${ev.id}`, { body: 'Profilaxia realizada. Orientada sobre fio dental e escova interdental.' }, O)
check('corrige evolução (marca como editada)', r.status === 200 && r.body.body.includes('interdental') && r.body.edited, show(r))

const inv = (await api('POST', '/api/team/invitations', { email: `den+${s}@exemplo.com`, name: 'Dr. Davi', role: 'dentist', doesAttend: true }, O)).body
const D = (await api('POST', `/api/public/invitations/${inv.token}/accept`, { password: 'senha-den-123' })).body.token
r = await api('GET', `/api/patients/${pid}/evolutions`, null, D)
check('dentista vê evoluções, sem poder editar a da colega', r.status === 200 && r.body[0].canEdit === false, show(r))
check('dentista não edita evolução de outra pessoa (403)', (await api('PATCH', `/api/evolutions/${ev.id}`, { body: 'troca' }, D)).status === 403)
const evD = (await api('POST', `/api/patients/${pid}/evolutions`, { body: 'Avaliação: cárie oclusal no 36.' }, D)).body
check('dentista corrige a própria (até 24 h)', (await api('PATCH', `/api/evolutions/${evD.id}`, { body: 'Avaliação: cárie oclusal no 36 e 37.' }, D)).status === 200)
check('dentista não exclui sem permissão (403)', (await api('DELETE', `/api/evolutions/${evD.id}`, null, D)).status === 403)
check('dona exclui (lógico)', (await api('DELETE', `/api/evolutions/${evD.id}`, null, O)).status === 204)
r = await api('GET', `/api/patients/${pid}/evolutions`, null, O)
check('excluída some da lista', r.body.length === 1)

console.log('\n[receita e atestado]')
r = await api('POST', `/api/patients/${pid}/documents`, { kind: 'prescription', prescription: { items: [
  { medication: 'Amoxicilina 500 mg', quantity: '21 cápsulas', instructions: 'Tomar 1 cápsula de 8 em 8 horas por 7 dias.', usage: 'interno' },
  { medication: 'Clorexidina 0,12% <enxaguante>', quantity: '1 frasco', instructions: 'Bochechar 15 ml por 1 minuto, 2x ao dia.', usage: 'externo' },
] } }, O)
check('emite receita', r.status === 201 && r.body.title === 'Receita (2 itens)', show(r))
const rx = r.body
r = await api('GET', `/api/documents/${rx.id}/pdf`, null, O, true)
check('PDF da receita com papel timbrado', isPdf(r), `${r.status} ${r.type} ${r.bytes.length}`)
r = await api('GET', '/api/documents/medications', null, O)
check('sugestões de medicamento vêm do que a clínica já receitou', r.body.includes('Amoxicilina 500 mg'), show(r))
r = await api('POST', `/api/patients/${pid}/documents`, { kind: 'certificate', certificate: { type: 'afastamento', date: '2026-11-10', days: 2, cid: 'K04.0' } }, O)
check('CID sem autorização do paciente → 400', r.status === 400 && r.body.code === 'CID_CONSENT', show(r))
r = await api('POST', `/api/patients/${pid}/documents`, { kind: 'certificate', certificate: { type: 'afastamento', date: '2026-11-10', days: 2, cid: 'K04.0', cidAuthorized: true } }, O)
check('atestado de afastamento com CID autorizado', r.status === 201 && r.body.title === 'Atestado de afastamento (2 dias)', show(r))
r = await api('POST', `/api/patients/${pid}/documents`, { kind: 'certificate', certificate: { type: 'comparecimento', date: '2026-11-10', from: '09:00', to: '10:30' } }, O)
check('atestado de comparecimento', r.status === 201, show(r))
r = await api('GET', `/api/documents/${r.body.id}/pdf`, null, O, true)
check('PDF do atestado', isPdf(r), `${r.status} ${r.bytes.length}`)
r = await api('GET', `/api/patients/${pid}/documents`, null, O)
check('lista os 3 documentos', r.body.length === 3)

console.log('\n[arquivos]')
// PNG 1x1 válido
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
let fd = new FormData()
fd.append('file', new Blob([png], { type: 'image/png' }), 'rx inicial.png')
fd.append('kind', 'xray')
fd.append('takenAt', '2026-10-20')
r = await api('POST', `/api/patients/${pid}/files`, fd, O)
check('envia radiografia PNG', r.status === 201 && r.body.mimeType === 'image/png' && r.body.kind === 'xray', show(r))
const file = r.body
fd = new FormData()
fd.append('file', new Blob([new TextEncoder().encode('MZ\x90\x00 isto é um executável')], { type: 'image/png' }), 'foto.png')
r = await api('POST', `/api/patients/${pid}/files`, fd, O)
check('executável com nome .png → 415 (tipo pelo conteúdo)', r.status === 415, show(r))
fd = new FormData()
fd.append('file', new Blob([new TextEncoder().encode('%PDF-1.4\n%laudo\n')], { type: 'application/pdf' }), '../../etc/laudo.pdf')
r = await api('POST', `/api/patients/${pid}/files`, fd, O)
check('PDF aceito e nome com caminho é limpo', r.status === 201 && !r.body.fileName.includes('/'), show(r))
r = await api('GET', `/api/files/${file.id}/content`, null, O, true)
check('download devolve os mesmos bytes', r.status === 200 && r.bytes.length === png.length && r.bytes.every((b, i) => b === png[i]))
r = await api('PATCH', `/api/files/${file.id}`, { kind: 'photo' }, O)
check('reclassifica o arquivo', r.body.kind === 'photo')
check('exclui (lógico)', (await api('DELETE', `/api/files/${file.id}`, null, O)).status === 204)
r = await api('GET', `/api/patients/${pid}/files`, null, O)
check('excluído some da lista', r.body.length === 1)

console.log('\n[permissões e isolamento]')
const invS = (await api('POST', '/api/team/invitations', { email: `rec+${s}@exemplo.com`, name: 'Rita Recepção', role: 'secretary' }, O)).body
const S = (await api('POST', `/api/public/invitations/${invS.token}/accept`, { password: 'senha-rec-123' })).body.token
check('recepção não vê evoluções (403)', (await api('GET', `/api/patients/${pid}/evolutions`, null, S)).status === 403)
check('recepção não vê anamnese (403)', (await api('GET', `/api/patients/${pid}/anamneses`, null, S)).status === 403)
check('recepção não baixa arquivo (403)', (await api('GET', `/api/files/${file.id}/content`, null, S, true)).status === 403)
check('dentista (preset) não vê... anamnese sim', (await api('GET', `/api/patients/${pid}/anamneses`, null, D)).status === 200)
const B = (await api('POST', '/api/auth/signup', { name: 'Outro', email: `outro+${s}@exemplo.com`, password: 'senha-forte-123', clinicName: 'Outra' })).body.token
const files2 = (await api('GET', `/api/patients/${pid}/files`, null, O)).body
check('outra clínica não baixa o arquivo (404)', (await api('GET', `/api/files/${files2[0].id}/content`, null, B, true)).status === 404)
check('outra clínica não gera o PDF da receita (404)', (await api('GET', `/api/documents/${rx.id}/pdf`, null, B, true)).status === 404)
check('outra clínica não lê a anamnese (404)', (await api('GET', `/api/anamneses/${an.id}`, null, B)).status === 404)

console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)

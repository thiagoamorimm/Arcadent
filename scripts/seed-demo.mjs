// Massa de dados de demonstração para TODAS as telas, na clínica da conta de teste (dono).
//   node scripts/seed-demo.mjs [--api http://localhost:8090] [--reset] [--force]
// --reset apaga ANTES os dados clínicos e financeiros da clínica de teste (pacientes, agenda,
// orçamentos, financeiro, estoque, prótese, auditoria) e mantém equipe, ajustes e cadastros.
// Cria pela API (respeita regras, numeração, idempotência). No fim ajusta só DATAS de criação
// (pacientes, orçamentos, estoque, prótese) por SQL no container clinica-db, para os indicadores
// terem histórico; a API sempre grava "agora". Determinístico (mesma semente = mesmos dados).
// Só para ambiente local de desenvolvimento.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const args = process.argv.slice(2)
const API = (args.includes('--api') ? args[args.indexOf('--api') + 1] : 'http://localhost:8090') + '/api'
const FORCE = args.includes('--force')
const RESET = args.includes('--reset')
const ACCOUNTS = new URL('./dev-accounts.example.json', import.meta.url)
const accounts = JSON.parse(readFileSync(ACCOUNTS, 'utf8'))

// ---------- utilidades ----------
let seed = 20261024
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const chance = (p) => rnd() < p
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const spYmd = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const TODAY = spYmd()
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const dow = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay() // 0 dom
const at = (ymd, hm) => new Date(`${ymd}T${hm}:00-03:00`).toISOString()
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const nowIso = () => new Date().toISOString()
const past = (iso) => (iso > nowIso() ? nowIso() : iso)
let calls = 0
const log = (m) => console.log(m)

let session
async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`)
  return r.json()
}
async function call(method, path, body, headers = {}, retry = true) {
  calls++
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (r.status === 401 && retry) { session = await login(accounts.owner.email, accounts.owner.password); return call(method, path, body, headers, false) }
  const text = await r.text()
  const json = text ? JSON.parse(text) : null
  if (!r.ok) { const e = new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`); e.status = r.status; e.body = json; throw e }
  return json
}
const sqlRun = (q) => execFileSync('docker', ['exec', '-i', 'clinica-db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'clinic_owner', '-d', 'clinica', '-q'], { input: q, encoding: 'utf8' })

/** PNG em tons de cinza (radiografia de mentira), sem dependências. */
function png(w, h, shade) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = shade(x, y) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---------- dados ----------
const FIRST_F = ['Ana Clara', 'Beatriz', 'Camila', 'Débora', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Larissa', 'Mariana', 'Natália', 'Patrícia', 'Renata', 'Sofia', 'Tatiane', 'Vanessa', 'Yasmin', 'Lúcia', 'Rosângela', 'Cecília']
const FIRST_M = ['André', 'Bruno', 'Carlos', 'Diego', 'Eduardo', 'Felipe', 'Gustavo', 'Henrique', 'Igor', 'João Pedro', 'Leonardo', 'Marcelo', 'Otávio', 'Paulo', 'Rafael', 'Sérgio', 'Thiago', 'Vinícius', 'Wagner', 'José', 'Antônio', 'Joaquim']
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Ribeiro', 'Barbosa', 'Moreira', 'Cardoso', 'Teixeira', 'Mendes', 'Freitas', 'Vieira']
const STREETS_NOTES = ['Prefere horário da manhã.', 'Tem medo de agulha: explicar cada passo.', 'Mora longe: agrupar procedimentos.', 'Indicação da Dra. Ana.', 'Paciente desde 2019.', null, null, null]
const EVOLUTION_TEXT = {
  'Restauração': ['Restauração em resina composta, isolamento relativo, sem intercorrências. Orientado sobre sensibilidade nas primeiras 48 h.', 'Remoção de cárie, proteção pulpar indireta e restauração em resina. Ajuste oclusal feito.'],
  'Tratamento de canal': ['Abertura coronária, odontometria e instrumentação. Medicação intracanal com hidróxido de cálcio. Retorno em 15 dias.', 'Obturação dos condutos com técnica de condensação lateral. Radiografia final ok.'],
  'Extração': ['Exodontia sob anestesia local, sutura com 2 pontos. Prescrito analgésico e orientações pós-operatórias.', 'Exodontia sem intercorrências. Hemostasia adequada. Retorno para remoção de sutura em 7 dias.'],
  'Profilaxia': ['Profilaxia e aplicação de flúor. Orientação de escovação e uso de fio dental.', 'Raspagem supragengival e polimento. Gengiva com leve sangramento na região posterior.'],
  'Coroa': ['Preparo para coroa total e moldagem com silicone de adição. Provisório cimentado. Cor A2.', 'Prova da infraestrutura com boa adaptação. Enviado para aplicação de cerâmica.'],
  'Implante': ['Instalação de implante 3,75 × 11 mm com torque de 40 N. Sutura e orientações.', 'Reabertura e instalação de cicatrizador. Tecido gengival saudável.'],
  default: ['Procedimento realizado conforme planejado, sem intercorrências.', 'Paciente relatou conforto durante o procedimento. Orientações passadas.'],
}
const MEDS = [
  { medication: 'Amoxicilina 500 mg', quantity: '21 cápsulas', instructions: '1 cápsula de 8 em 8 horas por 7 dias.', usage: 'interno' },
  { medication: 'Ibuprofeno 600 mg', quantity: '10 comprimidos', instructions: '1 comprimido de 8 em 8 horas, após as refeições, se dor.', usage: 'interno' },
  { medication: 'Dipirona 500 mg', quantity: '10 comprimidos', instructions: '1 comprimido de 6 em 6 horas, se dor ou febre.', usage: 'interno' },
  { medication: 'Clorexidina 0,12%', quantity: '1 frasco', instructions: 'Bochechar 15 ml por 1 minuto, 2 vezes ao dia, por 7 dias.', usage: 'externo' },
  { medication: 'Nimesulida 100 mg', quantity: '6 comprimidos', instructions: '1 comprimido de 12 em 12 horas por 3 dias.', usage: 'interno' },
]
const STOCK = [
  ['Luva de procedimento M', 'cx', 'Descartáveis', 10, 3290, 22], ['Luva de procedimento P', 'cx', 'Descartáveis', 6, 3290, 9],
  ['Máscara tripla', 'cx', 'Descartáveis', 8, 1890, 5], ['Sugador descartável', 'pct', 'Descartáveis', 5, 1250, 14],
  ['Anestésico lidocaína 2% c/ epinefrina', 'cx', 'Anestésicos', 4, 15900, 7], ['Agulha gengival curta', 'cx', 'Anestésicos', 3, 4800, 2],
  ['Resina composta A2', 'un', 'Restauradores', 6, 8900, 11], ['Resina composta A3', 'un', 'Restauradores', 6, 8900, 4],
  ['Ácido fosfórico 37%', 'un', 'Restauradores', 3, 1590, 6], ['Adesivo universal', 'un', 'Restauradores', 2, 19900, 3],
  ['Lima K 25mm (1ª série)', 'cx', 'Endodontia', 2, 4590, 5], ['Hipoclorito de sódio 2,5%', 'un', 'Endodontia', 4, 1290, 9],
  ['Fio de sutura seda 4-0', 'cx', 'Cirurgia', 2, 6700, 1], ['Gaze estéril', 'pct', 'Cirurgia', 10, 890, 24],
  ['Flúor gel acidulado', 'un', 'Prevenção', 2, 2190, 5], ['Pasta profilática', 'un', 'Prevenção', 2, 1690, 1],
]
const LABS = ['Laboratório Arte Dental', 'Lab Prótese Sul', 'Ceramic Lab Floripa']

async function main() {
  session = await login(accounts.owner.email, accounts.owner.password)
  log(`Clínica: ${session.clinicName}`)
  if (RESET) {
    if (!/\.(test|localhost)$/.test(accounts.owner.email.split('@')[1] ?? '')) throw new Error('--reset só roda na conta de teste local.')
    const c = session.clinicId
    const tables = ['prosthesis_events', 'prosthesis_orders', 'stock_movements', 'stock_products', 'signature_requests', 'commissions',
      'cash_movements', 'payments', 'receipts', 'debits', 'expenses', 'cash_sessions', 'documents', 'patient_files', 'evolutions',
      'tooth_notes', 'anamneses', 'treatments', 'budget_items', 'budgets', 'waitlist_entries', 'return_alerts', 'appointments',
      'appointment_series', 'patients', 'audit_log', 'clinic_counters']
    sqlRun(['begin;', ...tables.map((t) => `delete from ${t} where clinic_id = '${c}';`), 'commit;', ''].join('\n'))
    log('Dados da clínica apagados (--reset).')
  }
  const marker = await call('GET', '/patients?q=' + encodeURIComponent('Helena Martins'))
  if (marker.total > 0 && !FORCE) {
    log('A massa de demonstração já existe nesta clínica (paciente "Helena Martins"). Use --force para criar outra rodada.')
    return
  }

  // ---------- equipe: 2º dentista ----------
  let dent2 = accounts.dentist2
  if (!dent2) {
    dent2 = { name: 'Dr. Rafael Costa', email: 'rafael.dev@clinica.test', password: 'dev-dentista-2026', via: 'convite criado pelo scripts/seed-demo.mjs' }
    const inv = await call('POST', '/team/invitations', { email: dent2.email, name: dent2.name, role: 'dentist', doesAttend: true })
    const r = await fetch(`${API}/public/invitations/${inv.token}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: dent2.name, password: dent2.password }) })
    if (!r.ok) throw new Error('aceitar convite: ' + (await r.text()))
    accounts.dentist2 = dent2
    writeFileSync(ACCOUNTS, JSON.stringify(accounts, null, 2) + '\n')
    log('Dentista convidado: Dr. Rafael Costa (senha registrada em scripts/dev-accounts.example.json)')
  }
  const pros = await call('GET', '/professionals')
  const procs = await call('GET', '/procedures')
  const proc = (prefix) => procs.find((p) => p.name.startsWith(prefix))
  const accts = await call('GET', '/financial-accounts')
  const cash = accts.find((a) => /caixa|espécie/i.test(a.name)) ?? accts[0]
  const bank = accts.find((a) => a !== cash) ?? accts[0]
  const cats = await call('GET', '/categories')
  const cat = (kind, re) => cats.find((c) => c.kind === kind && re.test(c.name))?.id ?? cats.find((c) => c.kind === kind)?.id
  const labels = await call('GET', '/labels')
  const templates = await call('GET', '/anamnesis-templates')
  const template = templates.find((t) => t.isActive)

  // ---------- pacientes ----------
  log('Pacientes…')
  const patients = []
  const createdAt = {} // id → data de cadastro (ajustada por SQL)
  const thisMonth = TODAY.slice(5, 7)
  for (let i = 0; i < 46; i++) {
    const female = i % 2 === 0
    const l1 = pick(LAST)
    let l2 = pick(LAST)
    while (l2 === l1) l2 = pick(LAST)
    const name = i === 0 ? 'Helena Martins' : `${pick(female ? FIRST_F : FIRST_M)} ${l1} ${l2}`
    const kid = i % 11 === 5
    const year = kid ? int(2012, 2019) : int(1950, 2004)
    let birth = `${year}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`
    if (i % 9 === 1) birth = `${year}-${thisMonth}-${String(int(1, 28)).padStart(2, '0')}` // aniversariantes do mês
    if (i === 2) birth = `${year}-${TODAY.slice(5)}` // aniversário hoje
    const phone = `(48) 9${int(8100, 9999)}-${int(1000, 9999)}`
    const body = { name, phone: chance(0.92) ? phone : undefined, birthDate: chance(0.88) || kid || i === 2 || i % 9 === 1 ? birth : undefined, email: chance(0.5) ? `${name.split(' ')[0].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}.${i}@exemplo.test` : undefined, notes: pick(STREETS_NOTES) ?? undefined }
    const p = await call('POST', '/patients', body)
    if (kid) await call('PATCH', `/patients/${p.id}`, { ...body, birthDate: birth, guardian: { name: `${pick(FIRST_F)} ${name.split(' ').slice(-1)[0]}`, relation: 'mãe', phone, cpf: undefined } })
    createdAt[p.id] = addDays(TODAY, -int(5, 240))
    patients.push({ ...p, name })
  }

  // ---------- anamneses ----------
  log('Anamneses…')
  for (const p of patients.slice(0, 24)) {
    if (!template) break
    const a = await call('POST', `/patients/${p.id}/anamneses`, { templateId: template.id })
    const answers = {}
    for (const q of template.questions) {
      if (q.type === 'yesno') {
        const yes = (q.alert === 'Alergia' && chance(0.18)) || (q.alert === 'Hipertensão/cardiopatia' && chance(0.2)) || (q.alert === 'Usa medicamentos' && chance(0.35)) || (q.alert === 'Diabetes' && chance(0.08)) || (!q.alert && chance(0.2))
        answers[q.id] = { value: yes ? 'sim' : 'nao', detail: yes && q.withDetail ? (q.alert === 'Alergia' ? pick(['Dipirona', 'Penicilina', 'Látex']) : q.alert === 'Usa medicamentos' ? pick(['Losartana 50 mg', 'Metformina', 'Levotiroxina']) : 'Informado pelo paciente') : undefined }
      } else if (q.type === 'choice') answers[q.id] = { value: q.options?.[0] }
      else if (q.type === 'text') answers[q.id] = { value: chance(0.3) ? 'Sem observações.' : '' }
    }
    await call('PATCH', `/anamneses/${a.id}`, { answers, complete: true })
  }

  // ---------- agenda: ~5 meses para trás e 14 dias para frente ----------
  log('Agenda…')
  const visits = {} // patientId → [ymd atendidos]
  const appts = []
  const charges = [] // consultas avulsas cobradas (avaliação, urgência): viram débito + recebimento
  for (let d = -150; d <= 14; d++) {
    const ymd = addDays(TODAY, d)
    const wd = dow(ymd)
    if (wd === 0) continue
    for (const pro of pros) {
      const ranges = wd === 6 ? [[8 * 60, 12 * 60]] : [[8 * 60, 12 * 60], [13 * 60, 18 * 60]]
      for (const [a, b] of ranges) {
        let t = a + 30 * int(0, 2)
        while (t < b - 30) {
          if (chance(d > 7 ? 0.35 : 0.62)) {
            const dur = pick([30, 30, 30, 60, 60, 90])
            if (t + dur > b) break
            const p = pick(patients)
            const isPast = at(ymd, hm(t + dur)) < nowIso()
            try {
              const ap = await call('POST', '/appointments', { kind: 'consulta', patientId: p.id, professionalId: pro.id, startAt: at(ymd, hm(t)), endAt: at(ymd, hm(t + dur)), labelId: chance(0.4) && labels.length ? pick(labels).id : undefined })
              let status = 'agendado'
              if (isPast) status = chance(0.8) ? 'atendido' : chance(0.55) ? 'faltou' : 'cancelado'
              else if (d <= 2) status = chance(0.7) ? 'confirmado' : 'agendado'
              else status = chance(0.3) ? 'confirmado' : 'agendado'
              if (status !== 'agendado') await call('PATCH', `/appointments/${ap.id}`, { status })
              if (status === 'atendido') {
                (visits[p.id] ??= []).push(ymd)
                if (chance(0.32)) charges.push({ p, ymd, desc: pick(['Consulta de avaliação', 'Consulta de avaliação', 'Atendimento de urgência', 'Retorno com ajuste']), cents: pick([15000, 15000, 18000, 25000, 30000]) })
              }
              appts.push(ap)
            } catch (e) { if (e.status !== 409) throw e }
            t += dur
          } else t += 30
        }
      }
    }
  }
  // compromissos e bloqueios
  for (let d = 1; d <= 14; d += 4) {
    const ymd = addDays(TODAY, d)
    if (dow(ymd) === 0 || dow(ymd) === 6) continue
    await call('POST', '/appointments', { kind: 'compromisso', professionalId: pros[0].id, startAt: at(ymd, '17:30'), endAt: at(ymd, '18:00'), title: 'Retorno de ligações do laboratório', overlapAllowed: true }).catch(() => {})
  }
  await call('POST', '/appointments', { kind: 'bloqueio', professionalId: pros[pros.length - 1].id, startAt: at(addDays(TODAY, 9), '00:00'), endAt: at(addDays(TODAY, 10), '00:00'), title: 'Congresso de odontologia', overlapAllowed: true }).catch(() => {})

  // ---------- orçamentos → tratamentos → débitos → recebimentos ----------
  log('Orçamentos, tratamentos e financeiro do paciente…')
  const PLANS = [
    () => [{ p: 'Restauração em resina — 1 face', teeth: [int(14, 17)] }, { p: 'Profilaxia', teeth: [null] }],
    () => [{ p: 'Restauração em resina — 2 ou mais faces', teeth: [36, 46].slice(0, int(1, 2)) }],
    () => [{ p: 'Tratamento de canal — multirradicular', teeth: [pick([16, 26, 36, 46])] }, { p: 'Coroa em porcelana', teeth: [pick([16, 26, 36, 46])] }],
    () => [{ p: 'Extração simples', teeth: [pick([18, 28, 38, 48])] }],
    () => [{ p: 'Clareamento de consultório', teeth: [null] }, { p: 'Profilaxia', teeth: [null] }],
    () => [{ p: 'Implante unitário', teeth: [pick([36, 46, 14, 24])] }, { p: 'Coroa em porcelana', teeth: [pick([11, 21])] }],
    () => [{ p: 'Tratamento de canal — unirradicular', teeth: [pick([11, 12, 21, 22])] }, { p: 'Restauração em resina — 2 ou mais faces', teeth: [pick([11, 21])] }],
    () => [{ p: 'Raspagem por sextante', teeth: [null, null] }, { p: 'Radiografia periapical', teeth: [null] }],
  ]
  const budgetDates = {}
  const doneTreatments = []
  const prosthesisCandidates = []
  let receiptQueue = []
  for (const [k, p] of patients.slice(0, 34).entries()) {
    const nBudgets = k % 7 === 0 ? 2 : 1
    for (let j = 0; j < nBudgets; j++) {
      const plan = pick(PLANS)()
      const items = plan.flatMap(({ p: name, teeth }) => {
        const pr = proc(name)
        if (!pr) return []
        return teeth.map((t) => ({ procedureId: pr.id, tooth: pr.scope === 'tooth' || pr.scope === 'face' ? t ?? 16 : undefined, faces: pr.scope === 'face' ? ['O', 'M'].slice(0, int(1, 2)) : [] }))
      })
      if (!items.length) continue
      const total = items.reduce((s, it) => s + procs.find((x) => x.id === it.procedureId).priceCents, 0)
      const inst = total > 150000 ? pick([3, 4, 6]) : total > 60000 ? pick([1, 2, 3]) : 1
      const pro = pick(pros)
      const b = await call('POST', `/patients/${p.id}/budgets`, { professionalId: pro.id, items, installments: inst, discountCents: chance(0.3) ? Math.round(total * 0.05 / 100) * 100 : 0, notes: chance(0.2) ? 'Valores válidos para pagamento no Pix ou cartão.' : undefined })
      const createdDaysAgo = int(3, 170)
      const created = addDays(TODAY, -createdDaysAgo)
      const roll = rnd()
      let approvedOn = null
      if (roll < 0.58) {
        approvedOn = addDays(created, int(0, Math.min(10, createdDaysAgo)))
        const partial = chance(0.15) && b.items.length > 1
        const approved = await call('POST', `/budgets/${b.id}/approve`, { itemIds: partial ? [b.items[0].id] : [], firstDueDate: approvedOn })
        // tratamentos: finaliza parte, com data depois da aprovação
        const ts = (await call('GET', `/patients/${p.id}/treatments`)).filter((t) => t.status === 'open' && t.budgetNumber === approved.number)
        for (const t of ts) {
          const doneDay = addDays(approvedOn, int(1, 40))
          if (doneDay < TODAY && chance(0.62)) {
            const doneAt = past(at(doneDay, hm(int(9, 17) * 60)))
            await call('POST', '/treatments/finish', { ids: [t.id], doneAt })
            doneTreatments.push({ p, t, doneAt })
          } else if (/Coroa|Implante/.test(t.procedureName)) prosthesisCandidates.push({ p, t, approvedOn })
        }
        // débitos: vencidos são pagos (quase todos), alguns em parte, uns ficam em atraso
        const debits = (await call('GET', `/patients/${p.id}/debits`)).filter((d) => d.budgetId === b.id)
        for (const d of debits) {
          if (d.dueDate > TODAY) { if (chance(0.15)) await pay(d, d.amountCents, TODAY); continue }
          const r = rnd()
          if (r < 0.8) await pay(d, d.amountCents, addDays(d.dueDate, int(0, 3)))
          else if (r < 0.88) await pay(d, Math.round(d.amountCents * 0.5), addDays(d.dueDate, int(0, 5)))
        }
      } else if (roll < 0.72) {
        await call('POST', `/budgets/${b.id}/reject`, { reason: pick(['Achou caro', 'Vai pensar', 'Vai fazer pelo convênio', 'Prefere fazer em outra cidade']) })
      }
      budgetDates[b.id] = { created, approved: approvedOn }
    }
  }
  async function pay(d, cents, ymd) {
    const day = ymd > TODAY ? TODAY : ymd
    const paidAt = past(at(day, hm(int(8, 18) * 60 + int(0, 59))))
    const method = pick(['pix', 'pix', 'pix', 'cartao_credito', 'cartao_credito', 'cartao_debito', 'dinheiro', 'transferencia'])
    const r = await call('POST', `/debits/${d.id}/payments`, { amountCents: cents, method, financialAccountId: method === 'dinheiro' ? cash.id : bank.id, paidAt }, { 'Idempotency-Key': `seed-${d.id}-${cents}` })
    if (chance(0.55)) receiptQueue.push(r.payment.id)
  }
  log('Consultas cobradas…')
  for (const ch of charges) {
    const [d] = await call('POST', `/patients/${ch.p.id}/debits`, { description: ch.desc, amountCents: ch.cents, installments: 1, firstDueDate: ch.ymd })
    if (chance(0.93)) await pay(d, ch.cents, ch.ymd)
  }
  log('Recibos…')
  for (const id of receiptQueue) await call('POST', '/receipts', { paymentIds: [id] }).catch(() => {})

  // débitos avulsos (manutenção ortodôntica) e um tratamento avulso
  for (const p of patients.slice(34, 40)) {
    await call('POST', `/patients/${p.id}/debits`, { description: 'Manutenção ortodôntica', amountCents: 18000, installments: 1, firstDueDate: addDays(TODAY, -int(0, 40)) })
  }
  for (const p of patients.slice(40, 44)) {
    const pr = proc('Restauração em resina — 1 face')
    if (pr) await call('POST', `/patients/${p.id}/treatments`, { procedureId: pr.id, professionalId: pick(pros).id, teeth: [{ tooth: pick([24, 25, 34, 35]), faces: ['O'] }], charge: true, dueDate: addDays(TODAY, int(-20, 5)) })
  }

  // ---------- evoluções, anotações, documentos, imagens ----------
  log('Prontuário (evoluções, anotações, documentos, imagens)…')
  for (const { p, t, doneAt } of doneTreatments) {
    const key = Object.keys(EVOLUTION_TEXT).find((k) => t.procedureName.startsWith(k)) ?? 'default'
    await call('POST', `/patients/${p.id}/evolutions`, { body: pick(EVOLUTION_TEXT[key]), treatmentId: t.id, occurredAt: doneAt })
  }
  for (const p of patients.slice(0, 10)) {
    await call('POST', `/patients/${p.id}/tooth-notes`, { tooth: pick([16, 26, 36, 46, 11, 21]), note: pick(['Sensibilidade ao frio.', 'Trinca na distal: acompanhar.', 'Restauração antiga com infiltração.', 'Mobilidade grau I.']) })
  }
  for (const p of patients.slice(0, 9)) {
    await call('POST', `/patients/${p.id}/documents`, { kind: 'prescription', professionalId: pick(pros).id, prescription: { items: [pick(MEDS), ...(chance(0.5) ? [pick(MEDS)] : [])].filter((v, i, a) => a.findIndex((x) => x.medication === v.medication) === i), notes: chance(0.4) ? 'Em caso de reação, suspender e entrar em contato.' : undefined } })
  }
  for (const p of patients.slice(9, 14)) {
    const day = addDays(TODAY, -int(1, 30))
    await call('POST', `/patients/${p.id}/documents`, { kind: 'certificate', professionalId: pick(pros).id, certificate: { type: chance(0.6) ? 'comparecimento' : 'afastamento', date: day, from: '14:00', to: '15:30', days: 1 } })
  }
  for (const [i, p] of patients.slice(0, 8).entries()) {
    const img = png(320, 220, (x, y) => { const dx = x - 160, dy = y - 110; const r = Math.sqrt(dx * dx * 0.6 + dy * dy); const tooth = Math.abs(dx) < 34 + i * 2 && y > 30 && y < 200 ? 90 : 0; return Math.max(15, Math.min(240, 200 - r * 0.9 + tooth + ((x * 7 + y * 13) % 9))) })
    const form = new FormData()
    form.append('file', new Blob([img], { type: 'image/png' }), `radiografia-periapical-${i + 1}.png`)
    form.append('kind', 'xray')
    form.append('takenAt', addDays(TODAY, -int(1, 90)))
    const r = await fetch(`${API}/patients/${p.id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form })
    if (!r.ok) throw new Error('upload: ' + (await r.text()))
  }

  // ---------- despesas e receitas sem vínculo (6 meses) ----------
  log('Fluxo de caixa (despesas e receitas sem vínculo)…')
  const EXP = [
    ['Aluguel da sala', 350000, 5, /aluguel/i], ['Salário da recepção', 240000, 5, /sal[aá]rio|pessoal|folha/i], ['Material odontológico', [90000, 180000], 8, /material/i],
    ['Energia elétrica', [42000, 56000], 10, /energia|luz|contas/i], ['Contador', 45000, 10, /contab|servi/i], ['Água', [11000, 16000], 12, /[aá]gua|contas/i],
    ['Internet e telefone', 19990, 15, /internet|telefon|contas/i], ['Laboratório de prótese', [120000, 280000], 20, /laborat/i],
  ]
  const monthStart = TODAY.slice(0, 8) + '01'
  for (let m = -5; m <= 0; m++) {
    const base = new Date(Date.parse(monthStart + 'T12:00:00Z')); base.setUTCMonth(base.getUTCMonth() + m)
    const ym = base.toISOString().slice(0, 7)
    for (const [desc, amount, day, re] of EXP) {
      const due = `${ym}-${String(day).padStart(2, '0')}`
      const cents = Array.isArray(amount) ? Math.round(int(amount[0], amount[1]) / 10) * 10 : amount
      const late = m === 0 && desc === 'Energia elétrica' && due < TODAY
      const paidDay = addDays(due, int(-2, 1))
      const isPaid = !late && due <= TODAY && paidDay <= TODAY
      const method = desc.startsWith('Salário') ? 'transferencia' : pick(['pix', 'boleto', 'pix'])
      await call('POST', '/expenses', { description: `${desc} — ${base.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')}`, amountCents: cents, dueDate: due, categoryId: cat('expense', re),
        ...(isPaid ? { paid: true, financialAccountId: bank.id, method, paidAt: past(at(paidDay, '10:00')) } : {}) })
    }
    // sublocação da sala 2 (receita sem vínculo)
    const due = `${ym}-07`
    const inc = await call('POST', '/income', { description: `Sublocação da sala 2 — ${base.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')}`, amountCents: 80000, dueDate: due, categoryId: cat('income', /outr|sublo|alug/i) })
    if (due <= TODAY) {
      const r = await call('POST', `/debits/${inc.id}/payments`, { amountCents: 80000, method: 'pix', financialAccountId: bank.id, paidAt: past(at(addDays(due, 1), '11:00')) }, { 'Idempotency-Key': `seed-inc-${inc.id}` })
      await call('POST', '/receipts', { paymentIds: [r.payment.id], payer: { name: 'Odonto Parceiros Ltda', cpf: '12.345.678/0001-90' } })
    }
  }

  // ---------- estoque ----------
  log('Estoque…')
  const stockIds = []
  for (const [name, unit, category, min, cost, qty] of STOCK) {
    const p = await call('POST', '/stock/products', { name, unit, category, minQty: min, costCents: cost, initialQty: qty + int(4, 12) })
    stockIds.push(p.id)
    for (let k = 0; k < int(2, 5); k++) {
      const cur = Number((await call('GET', '/stock/products')).find((x) => x.id === p.id).qty)
      const out = Math.min(cur, int(1, 4))
      if (out > 0) await call('POST', `/stock/products/${p.id}/movements`, { kind: 'saida', qty: out, reason: pick(['Uso da semana', 'Consultório 1', 'Consultório 2', 'Cirurgia']) })
    }
    const cur = Number((await call('GET', '/stock/products')).find((x) => x.id === p.id).qty)
    if (cur !== qty && qty >= 0) await call('POST', `/stock/products/${p.id}/movements`, { kind: 'ajuste', countedQty: qty, reason: 'Contagem do mês' })
  }

  // ---------- prótese ----------
  log('Prótese…')
  const orders = []
  const stages = ['pre_lab', 'envio', 'laboratorio', 'laboratorio', 'prova', 'realizado', 'realizado']
  for (const [i, { p, t }] of prosthesisCandidates.entries()) {
    const o = await call('POST', '/prosthesis', { patientId: p.id, treatmentId: t.id, professionalId: t.professionalId, description: `${t.procedureName}${t.tooth ? ` — ${t.tooth}` : ''}, cor ${pick(['A1', 'A2', 'A3', 'B1'])}`, laboratory: pick(LABS), dueDate: addDays(TODAY, int(2, 10)), costCents: /Implante/.test(t.procedureName) ? 65000 : 42000 })
    const target = stages[i % stages.length]
    for (const st of ['envio', 'laboratorio', 'prova', 'realizado']) {
      if (['pre_lab', 'envio', 'laboratorio', 'prova', 'realizado'].indexOf(st) > ['pre_lab', 'envio', 'laboratorio', 'prova', 'realizado'].indexOf(target)) break
      await call('POST', `/prosthesis/${o.id}/stage`, { stage: st, dueDate: addDays(TODAY, i % 4 === 1 ? -int(1, 6) : int(1, 12)), note: st === 'laboratorio' ? 'Enviado com motoboy do laboratório.' : undefined })
    }
    orders.push({ id: o.id, target, daysAgo: int(3, 25) })
  }
  // completa o quadro (pelo menos 9 pedidos, em todas as etapas) com trabalhos sem tratamento ligado
  const EXTRA = ['Placa miorrelaxante superior', 'Prótese parcial removível inferior', 'Coroa provisória em resina — 25', 'Prótese total superior', 'Faceta em porcelana — 21']
  const ORDER = ['pre_lab', 'envio', 'laboratorio', 'prova', 'realizado']
  for (let k = 0; orders.length < 9; k++) {
    const p = patients[40 + (k % 6)]
    const target = ORDER[k % ORDER.length]
    const o = await call('POST', '/prosthesis', { patientId: p.id, description: EXTRA[k % EXTRA.length], laboratory: pick(LABS), dueDate: addDays(TODAY, k % 3 === 0 ? -2 : int(3, 12)), costCents: pick([18000, 32000, 48000]) })
    for (const st of ORDER.slice(1, ORDER.indexOf(target) + 1)) {
      await call('POST', `/prosthesis/${o.id}/stage`, { stage: st, dueDate: addDays(TODAY, k % 3 === 0 ? -int(1, 4) : int(2, 10)) })
    }
    orders.push({ id: o.id, target, daysAgo: int(2, 18) })
  }

  // ---------- datas históricas (SQL) ----------
  log('Ajustando datas de criação (histórico)…')
  const clinic = session.clinicId
  const q = []
  for (const [id, d] of Object.entries(createdAt)) q.push(`update patients set created_at = '${d} 10:00-03' where id = '${id}';`)
  for (const [id, { created, approved }] of Object.entries(budgetDates)) {
    q.push(`update budgets set created_at = '${created} 11:00-03'${approved ? `, approved_at = '${approved} 15:00-03'` : ''} where id = '${id}';`)
  }
  for (const o of orders) {
    q.push(`update prosthesis_orders set created_at = now() - interval '${o.daysAgo + 10} days' where id = '${o.id}';`)
    q.push(`update prosthesis_events e set at = now() - make_interval(days => ${o.daysAgo} + (select count(*) from prosthesis_events e2 where e2.order_id = e.order_id and e2.id > e.id)::int * 4) where e.order_id = '${o.id}';`)
  }
  q.push(`update stock_movements set created_at = now() - make_interval(days => (abs(hashtext(id::text)) % 50) + 1) where clinic_id = '${clinic}' and created_at > now() - interval '1 hour';`)
  sqlRun('begin;\n' + q.join('\n') + '\ncommit;\n')

  log(`\nPronto: ${patients.length} pacientes, ${appts.length} consultas, ${Object.keys(budgetDates).length} orçamentos, ${doneTreatments.length} tratamentos finalizados, ${STOCK.length} produtos, ${orders.length} pedidos de prótese. (${calls} chamadas)`)
}

main().catch((e) => { console.error(e); process.exit(1) })

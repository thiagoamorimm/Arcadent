/**
 * Datas no fuso da CLÍNICA (não no do computador de quem usa). O banco guarda instantes em UTC;
 * a agenda pensa em "dia AAAA-MM-DD" + "minutos desde 00:00" no fuso da clínica.
 * Usa só Intl (sem biblioteca): o navegador já traz a base de fusos IANA.
 */
export type Ymd = string // '2026-11-10'
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export type WeekHours = Partial<Record<DayKey, [string, string][]>>

const cache = new Map<string, Intl.DateTimeFormat>()
const fmt = (tz: string) => {
  let f = cache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    cache.set(tz, f)
  }
  return f
}

/** Instante → dia e minutos no fuso. */
export function partsIn(date: Date, tz: string): { ymd: Ymd; minutes: number } {
  const p = Object.fromEntries(fmt(tz).formatToParts(date).map((x) => [x.type, x.value]))
  return { ymd: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

/** Dia + minutos no fuso → instante. Ajusta duas vezes para acertar mudanças de horário de verão. */
export function zonedToUtc(ymd: Ymd, minutes: number, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const wanted = Date.UTC(y, m - 1, d, 0, minutes)
  let guess = wanted
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz)
    const [py, pm, pd] = p.ymd.split('-').map(Number)
    guess -= Date.UTC(py, pm - 1, pd, 0, p.minutes) - wanted
  }
  return new Date(guess)
}

export function addDays(ymd: Ymd, n: number): Ymd {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** 0 = segunda … 6 = domingo */
export function dowOf(ymd: Ymd): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export const dayKey = (ymd: Ymd): DayKey => DAY_KEYS[dowOf(ymd)]
export const todayIn = (tz: string): Ymd => partsIn(new Date(), tz).ymd
export const mondayOf = (ymd: Ymd): Ymd => addDays(ymd, -dowOf(ymd))

export const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const parseHm = (s: string) => (s === '24:00' ? 1440 : Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)))

/** Intervalos abertos do dia em minutos. */
export const openRanges = (h: WeekHours | undefined, ymd: Ymd): [number, number][] =>
  (h?.[dayKey(ymd)] ?? []).map(([a, b]) => [parseHm(a), parseHm(b)])

export const hasHours = (h: WeekHours | undefined) => !!h && Object.values(h).some((d) => d && d.length > 0)

/** Data por extenso no fuso da clínica (independente do fuso do computador). */
export function longDate(ymd: Ymd, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('pt-BR', { ...opts, timeZone: 'UTC' })
}

/** Fusos do Brasil (IANA). */
export const BR_TIMEZONES: [string, string][] = [
  ['America/Sao_Paulo', 'Brasília (SP, RJ, MG, Sul, GO, DF, BA…)'],
  ['America/Manaus', 'Amazonas (Manaus)'],
  ['America/Cuiaba', 'Mato Grosso (Cuiabá)'],
  ['America/Campo_Grande', 'Mato Grosso do Sul (Campo Grande)'],
  ['America/Porto_Velho', 'Rondônia (Porto Velho)'],
  ['America/Boa_Vista', 'Roraima (Boa Vista)'],
  ['America/Rio_Branco', 'Acre (Rio Branco)'],
  ['America/Belem', 'Pará e Amapá (Belém)'],
  ['America/Fortaleza', 'Nordeste (Fortaleza, Natal, João Pessoa)'],
  ['America/Recife', 'Pernambuco (Recife)'],
  ['America/Maceio', 'Alagoas e Sergipe (Maceió)'],
  ['America/Araguaina', 'Tocantins (Palmas)'],
  ['America/Santarem', 'Oeste do Pará (Santarém)'],
  ['America/Noronha', 'Fernando de Noronha'],
]

/** Data e hora de um instante no fuso da clínica: "24/10/2026 14:05". */
export function dateTimeIn(iso: string, tz: string) {
  const p = partsIn(new Date(iso), tz)
  return `${p.ymd.slice(8, 10)}/${p.ymd.slice(5, 7)}/${p.ymd.slice(0, 4)} ${hm(p.minutes)}`
}

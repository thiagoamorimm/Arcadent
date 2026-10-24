import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export const API = 'http://localhost:8090/api'

export type Session = { token: string; refreshToken: string; clinicId: string; userId: string; userName: string; clinicName: string }
export type Clinic = {
  session: Session
  email: string
  password: string
  /** chamada autenticada direto na API (preparar dados) */
  call: <T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<T>
  professionalId: string
}

let seq = 0
const uniq = () => `${Date.now()}${process.pid}${seq++}`

export async function signup(request: APIRequestContext, name = 'Dra. E2E', clinicName = 'Clínica E2E'): Promise<Clinic> {
  const email = `e2e+${uniq()}@exemplo.test`
  const password = 'senha-e2e-123'
  const r = await request.post(`${API}/auth/signup`, { data: { name, email, password, clinicName } })
  expect(r.status(), await r.text()).toBe(201)
  const session = (await r.json()) as Session
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await request.fetch(`${API}${path}`, {
      method, data: body, headers: { Authorization: `Bearer ${session.token}`, ...headers },
    })
    if (res.status() >= 400) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`)
    return res.status() === 204 ? null : res.json()
  }
  const pros = await call('GET', '/professionals')
  return { session, email, password, call, professionalId: pros[0].id }
}

/** Abre o app já logado na clínica (mesmo formato que o cliente grava). */
export async function enter(page: Page, s: Session, path = '/agenda') {
  await page.addInitScript((x) => {
    if (!sessionStorage.getItem('e2e.entered')) {
      localStorage.setItem('clinica.token', x.token)
      localStorage.setItem('clinica.refresh', x.refreshToken)
      localStorage.setItem('clinica.clinic', x.clinicId)
      sessionStorage.setItem('e2e.entered', '1')
    }
  }, s)
  await page.goto(path)
}

/** Próxima terça-feira a partir de amanhã (expediente 08–12 e 13–18 no cadastro padrão). */
export function nextTuesday(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

/** UTC de um horário local de São Paulo (−03:00, sem horário de verão desde 2019). */
export const sp = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00-03:00`).toISOString()

/** Varredura de acessibilidade (WCAG 2.1 A/AA). Devolve as violações para o teste decidir. */
export async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

type Fixtures = { clinic: Clinic; guard: { errors: string[] } }

/**
 * Toda spec: falha com erro no console (menos "Failed to load resource" de 4xx, que são respostas de
 * regra de negócio esperadas) e com qualquer resposta 5xx.
 */
export const test = base.extend<Fixtures>({
  guard: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (/Failed to load resource: the server responded with a status of 4\d\d/.test(t)) return
      if (/net::ERR_INTERNET_DISCONNECTED/.test(t)) return // testes de "sem internet"
      errors.push(`console: ${t}`)
    })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`) })
    await use({ errors })
    expect(errors, 'erros de console / 5xx').toEqual([])
  }, { auto: true }],
  clinic: async ({ request }, use) => { await use(await signup(request)) },
})

export { expect }

/** Abre a visão Dia numa data. */
export async function goDay(page: Page, ymd: string) {
  await page.getByRole('radio', { name: 'Dia' }).click()
  await page.getByLabel('Ir para a data').fill(ymd)
}

/** Paciente + orçamento aprovado (dente 16, canal multi) para os fluxos de financeiro. */
export async function patientWithDebit(c: Clinic, name = 'Paciente E2E', installments = 1) {
  const p = await c.call('POST', '/patients', { name })
  const procs = await c.call('GET', '/procedures')
  const proc = procs.find((x: any) => x.name.startsWith('Extração'))
  const b = await c.call('POST', `/patients/${p.id}/budgets`, { professionalId: c.professionalId, installments, items: [{ procedureId: proc.id, tooth: 18 }] })
  await c.call('POST', `/budgets/${b.id}/approve`, {})
  return { patient: p, budget: b, proc }
}

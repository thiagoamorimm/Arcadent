// Gera os prints do README (docs/screenshots) a partir da clínica de demonstração.
//   cd e2e && node ../scripts/screenshots.mjs <id-do-paciente>
// Antes: servidores de dev de pé e `node scripts/seed-demo.mjs --reset` para ter dados.
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const patient = process.argv[2]
if (!patient) throw new Error('Informe o id de um paciente da massa de demonstração.')
const OUT = new URL('../docs/screenshots/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const acc = JSON.parse(readFileSync(new URL('./dev-accounts.example.json', import.meta.url), 'utf8'))
const s = await (await fetch('http://localhost:8090/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: acc.owner.email, password: acc.owner.password }) })).json()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()) })
const file = (name) => new URL(name + '.png', OUT).pathname.replace(/^\/([A-Z]:)/, '$1')
const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(500) }
const shot = async (name, fullPage = false) => { await settle(); await page.screenshot({ path: file(name), fullPage }) ; console.log('ok', name) }

// telas públicas
await page.goto('http://localhost:5180/entrar')
await shot('01-entrar')
await page.evaluate((x) => { localStorage.setItem('clinica.token', x.token); localStorage.setItem('clinica.refresh', x.refreshToken); localStorage.setItem('clinica.clinic', x.clinicId) }, s)

const P = `http://localhost:5180/pacientes/${patient}`
await page.goto('http://localhost:5180/agenda'); await shot('02-agenda-semana')
await page.getByRole('radio', { name: 'Dia' }).click(); await shot('03-agenda-dia')
await page.getByRole('button', { name: 'Agendar' }).click(); await shot('04-nova-consulta')
await page.keyboard.press('Escape')
await page.goto('http://localhost:5180/pacientes'); await shot('05-pacientes')
await page.goto(`${P}/resumo`); await shot('06-ficha-paciente')
await page.goto(`${P}/tratamentos`); await shot('07-odontograma-tratamentos')
await page.goto(`${P}/orcamentos/novo`)
for (const t of [16, 26, 36]) await page.getByRole('button', { name: new RegExp(`^Dente ${t}(,|$)`) }).click()
await page.getByRole('button', { name: 'Face oclusal do dente 16' }).click()
await page.getByRole('button', { name: 'Face mesial do dente 16' }).click()
await page.getByLabel('Procedimento').selectOption({ label: 'Restauração em resina — 2 ou mais faces — R$ 320,00' })
await shot('08-novo-orcamento')
await page.goto(`${P}/orcamentos`); await shot('09-orcamentos')
await page.goto(`${P}/anamnese`); await shot('10-anamnese')
await page.goto(`${P}/evolucoes`); await shot('11-evolucoes')
await page.goto(`${P}/imagens`); await shot('12-imagens')
await page.goto(`${P}/debitos`); await shot('13-debitos')
await page.goto('http://localhost:5180/financeiro'); await shot('14-fluxo-de-caixa')
await page.goto('http://localhost:5180/financeiro/recibos'); await shot('15-recibos')
await page.goto('http://localhost:5180/indicadores/desempenho'); await shot('16-indicadores')
await page.goto('http://localhost:5180/indicadores/painel'); await shot('17-painel-do-dia')
await page.goto('http://localhost:5180/protese'); await shot('18-protese')
await page.goto('http://localhost:5180/estoque'); await shot('19-estoque')
await page.goto('http://localhost:5180/ajustes/equipe'); await shot('20-equipe')
await page.getByRole('button', { name: /Bia Recepção/ }).first().click()
await shot('21-permissoes')
await page.keyboard.press('Escape')
await page.goto('http://localhost:5180/ajustes/auditoria'); await shot('22-auditoria')

// celular
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const mp = await m.newPage()
await mp.addInitScript((x) => { localStorage.setItem('clinica.token', x.token); localStorage.setItem('clinica.refresh', x.refreshToken); localStorage.setItem('clinica.clinic', x.clinicId) }, s)
for (const [name, url] of [['23-celular-agenda', 'http://localhost:5180/agenda'], ['24-celular-ficha', `${P}/tratamentos`], ['25-celular-financeiro', 'http://localhost:5180/financeiro']]) {
  await mp.goto(url); await mp.waitForLoadState('networkidle'); await mp.waitForTimeout(500)
  await mp.screenshot({ path: file(name) }); console.log('ok', name)
}
console.log('erros de console:', JSON.stringify(errors))
await browser.close()

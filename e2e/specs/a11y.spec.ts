import { axe, enter, expect, patientWithDebit, test } from './fixtures'

// Varredura axe (WCAG 2.1 A/AA) em cada tela construída, com dados de verdade nela.
const screens: [string, (id: string) => string][] = [
  ['S04 Agenda', () => '/agenda'],
  ['S10 Pacientes', () => '/pacientes'],
  ['S11 Ficha › Dados', (id) => `/pacientes/${id}/resumo`],
  ['S13 Orçamentos', (id) => `/pacientes/${id}/orcamentos`],
  ['S14 Editor de orçamento', (id) => `/pacientes/${id}/orcamentos/novo`],
  ['S15 Tratamentos', (id) => `/pacientes/${id}/tratamentos`],
  ['S12 Anamnese', (id) => `/pacientes/${id}/anamnese`],
  ['S16 Evoluções', (id) => `/pacientes/${id}/evolucoes`],
  ['S18 Documentos', (id) => `/pacientes/${id}/documentos`],
  ['S19 Imagens', (id) => `/pacientes/${id}/imagens`],
  ['S17 Débitos', (id) => `/pacientes/${id}/debitos`],
  ['S20 Fluxo de caixa', () => '/financeiro'],
  ['S24 Recibos', () => '/financeiro/recibos'],
  ['S28 Ajustes › Clínica', () => '/ajustes/clinica'],
  ['S29 Ajustes › Equipe', () => '/ajustes/equipe'],
  ['S30 Ajustes › Preços', () => '/ajustes/precos'],
  ['S31 Ajustes › Rótulos', () => '/ajustes/rotulos'],
  ['S31 Ajustes › Anamnese', () => '/ajustes/anamnese'],
  ['S31 Ajustes › Financeiro', () => '/ajustes/financeiro'],
  ['S33 Ajustes › Auditoria', () => '/ajustes/auditoria'],
  ['S32 Ajustes › Assinatura', () => '/ajustes/assinatura'],
  ['S25 Indicadores › Desempenho', () => '/indicadores/desempenho'],
  ['S25 Indicadores › Painel do dia', () => '/indicadores/painel'],
  ['S27 Prótese', () => '/protese'],
  ['S26 Estoque', () => '/estoque'],
]

for (const [name, path] of screens) {
  test(`a11y ${name}`, async ({ page, clinic }) => {
    const { patient } = await patientWithDebit(clinic, 'Acessível da Silva')
    await enter(page, clinic.session, path(patient.id))
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    expect(await axe(page)).toEqual([])
  })
}

for (const path of ['/entrar', '/criar-conta', '/esqueci-senha']) {
  test(`a11y público ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(await axe(page)).toEqual([])
  })
}

test('a11y modal Novo agendamento', async ({ page, clinic }) => {
  await enter(page, clinic.session)
  await page.getByRole('button', { name: 'Agendar' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await axe(page)).toEqual([])
})

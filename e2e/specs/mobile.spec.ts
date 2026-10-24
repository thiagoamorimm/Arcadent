import { enter, expect, patientWithDebit, test } from './fixtures'

// BUG-004: no celular nenhuma tela pode rolar para o lado (tabela larga rola dentro do próprio quadro).
test('390px: nenhuma tela rola para o lado', async ({ page, clinic }) => {
  const { patient } = await patientWithDebit(clinic, 'Celular da Silva')
  await clinic.call('POST', '/expenses', { description: 'Aluguel', amountCents: 100000, dueDate: new Date().toLocaleDateString('en-CA') })
  await page.setViewportSize({ width: 390, height: 844 })
  await clinic.call('POST', '/stock/products', { name: 'Luva', minQty: 5, initialQty: 2 })
  await clinic.call('POST', '/prosthesis', { patientId: patient.id, description: 'Coroa — 11' })
  const paths = ['/agenda', '/pacientes', '/financeiro', '/financeiro/recibos', '/ajustes/auditoria', '/ajustes/equipe', '/ajustes/precos',
    '/indicadores/desempenho', '/indicadores/painel', '/protese', '/estoque',
    `/pacientes/${patient.id}/debitos`, `/pacientes/${patient.id}/tratamentos`, `/pacientes/${patient.id}/orcamentos`, `/pacientes/${patient.id}/resumo`]
  await enter(page, clinic.session, paths[0])
  const wide: string[] = []
  for (const p of paths) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (extra > 0) wide.push(`${p}: +${extra}px`)
  }
  expect(wide).toEqual([])
})

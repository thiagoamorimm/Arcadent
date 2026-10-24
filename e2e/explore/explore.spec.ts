// Exploração (não faz parte da suíte): observa comportamentos de borda e imprime o que viu.
import { enter, patientWithDebit, signup } from '../specs/fixtures'
import { test } from '@playwright/test'

test('explorar', async ({ page, request, context }) => {
  const c = await signup(request)
  const { patient } = await patientWithDebit(c, 'Explora Silva')
  const log = (k: string, v: unknown) => console.log(`>> ${k}: ${JSON.stringify(v)}`)

  // 1) sem rede ao salvar paciente
  await enter(page, c.session, '/pacientes')
  await page.getByRole('button', { name: 'Novo paciente' }).click()
  await page.getByRole('dialog').getByLabel('Nome completo').fill('Offline Teste')
  await context.setOffline(true)
  await page.getByRole('dialog').getByRole('button', { name: /Salvar/ }).click()
  await page.waitForTimeout(1500)
  log('offline: dialog aberto', await page.getByRole('dialog').isVisible())
  log('offline: textos', await page.locator('[role=alert],[role=status]').allInnerTexts())
  await context.setOffline(false)

  // 2) botão voltar com modal aberto
  await page.goto(`/pacientes/${patient.id}/debitos`)
  await page.getByRole('button', { name: 'Receber' }).click()
  await page.goBack()
  await page.waitForTimeout(800)
  log('voltar: url', page.url())
  log('voltar: dialog ainda aberto', await page.getByRole('dialog').count())

  // 3) recarregar no meio do orçamento
  await page.goto(`/pacientes/${patient.id}/orcamentos/novo`)
  await page.getByRole('button', { name: /^Dente 11/ }).click()
  await page.getByLabel('Procedimento').selectOption({ index: 1 })
  await page.getByRole('button', { name: /^Adicionar/ }).click()
  let prompted = false
  page.once('dialog', async (d) => { prompted = true; await d.dismiss() })
  await page.reload()
  await page.waitForTimeout(800)
  log('reload orçamento: perguntou antes de sair', prompted)
  log('reload orçamento: itens após recarregar', await page.getByRole('textbox', { name: /^Valor de/ }).count())
  // sair pelo menu com itens
  await page.getByRole('button', { name: /^Dente 12/ }).click()
  await page.getByLabel('Procedimento').selectOption({ index: 1 })
  await page.getByRole('button', { name: /^Adicionar/ }).click()
  await page.getByRole('link', { name: 'Agenda' }).click()
  await page.waitForTimeout(500)
  log('sair pelo menu com itens: url', page.url())

  // 4) duas abas: recebimento simultâneo do mesmo débito
  const p2 = await context.newPage()
  await page.goto(`/pacientes/${patient.id}/debitos`)
  await p2.goto(`/pacientes/${patient.id}/debitos`)
  await page.getByRole('button', { name: 'Receber' }).click()
  await p2.getByRole('button', { name: 'Receber' }).click()
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Emitir recibo agora' }).click()
  await p2.getByRole('dialog').getByRole('checkbox', { name: 'Emitir recibo agora' }).click()
  await Promise.all([
    page.getByRole('dialog').getByRole('button', { name: 'Confirmar recebimento' }).click(),
    p2.getByRole('dialog').getByRole('button', { name: 'Confirmar recebimento' }).click(),
  ])
  await page.waitForTimeout(1200)
  log('duas abas: pagamentos', (await c.call('GET', `/patients/${patient.id}/payments`)).length)
  log('duas abas: textos aba 2', await p2.locator('[role=alert],[role=status]').allInnerTexts())
  await p2.close()

  // 5) 390px nas telas novas: rolagem lateral do documento
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of [`/pacientes/${patient.id}/debitos`, `/pacientes/${patient.id}/tratamentos`, `/pacientes/${patient.id}/orcamentos`,
    `/pacientes/${patient.id}/resumo`, '/financeiro', '/financeiro/recibos', '/ajustes/auditoria', '/ajustes/assinatura', '/pacientes']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    log(`390px ${path}`, o)
    if (o > 0) await page.screenshot({ path: `explore-390-${path.replace(/[^a-z]/gi, '_')}.png`, fullPage: false })
  }
})

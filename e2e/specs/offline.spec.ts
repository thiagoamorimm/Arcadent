import { enter, expect, test } from './fixtures'

// Sem internet: a pessoa precisa saber que não salvou (e poder tentar de novo quando voltar).
test('sem conexão ao salvar paciente mostra aviso e salva ao tentar de novo', async ({ page, clinic, context }) => {
  await enter(page, clinic.session, '/pacientes')
  await page.getByRole('button', { name: 'Novo paciente' }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Nome completo').fill('Paciente Sem Rede')
  await context.setOffline(true)
  await d.getByRole('button', { name: /Salvar/ }).click()
  await expect(page.getByText(/Sem conexão com o servidor/).first()).toBeVisible()
  expect((await clinic.call('GET', '/patients?q=Sem Rede')).items).toHaveLength(0)
  await context.setOffline(false)
  await d.getByRole('button', { name: /Salvar/ }).click()
  await expect(page.getByRole('heading', { name: 'Paciente Sem Rede' }).first()).toBeVisible()
})

test('sem conexão ao receber pagamento mostra aviso e não duplica ao tentar de novo', async ({ page, clinic, context }) => {
  const p = await clinic.call('POST', '/patients', { name: 'Rede Instável' })
  await clinic.call('POST', `/patients/${p.id}/debits`, { description: 'Consulta', amountCents: 20000, firstDueDate: new Date().toLocaleDateString('en-CA') })
  await enter(page, clinic.session, `/pacientes/${p.id}/debitos`)
  await page.getByRole('button', { name: 'Receber' }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('checkbox', { name: 'Emitir recibo agora' }).click()
  await context.setOffline(true)
  await d.getByRole('button', { name: 'Confirmar recebimento' }).click()
  await expect(d.getByRole('alert')).toContainText(/Sem conexão/)
  await context.setOffline(false)
  await d.getByRole('button', { name: 'Confirmar recebimento' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Recebido' })).toBeVisible()
  expect(await clinic.call('GET', `/patients/${p.id}/payments`)).toHaveLength(1)
})

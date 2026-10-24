import { enter, expect, goDay, nextTuesday, sp, test } from './fixtures'

const day = nextTuesday()

test.describe('F03 Atendimento e evolução', () => {
  test('F03-H1 status do atendimento, finalizar tratamento e evoluir', async ({ page, clinic }) => {
    const p = await clinic.call('POST', '/patients', { name: 'Nina Atendida' })
    await clinic.call('POST', '/appointments', { kind: 'consulta', patientId: p.id, professionalId: clinic.professionalId, startAt: sp(day, '09:00'), endAt: sp(day, '09:30') })
    const procs = await clinic.call('GET', '/procedures')
    await clinic.call('POST', `/patients/${p.id}/treatments`, { procedureId: procs.find((x: any) => x.scope === 'tooth').id, professionalId: clinic.professionalId, teeth: [{ tooth: 26 }], charge: false })

    await enter(page, clinic.session)
    await goDay(page, day)
    await page.getByRole('button', { name: /09:00 às 09:30, Nina Atendida/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Em atendimento' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Status: Em atendimento' })).toBeVisible()
    await page.getByRole('button', { name: /09:00 às 09:30, Nina Atendida/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Atendido' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Status: Atendido' })).toBeVisible()

    await page.goto(`/pacientes/${p.id}/tratamentos`)
    await page.getByRole('checkbox', { name: /Selecionar .*26/ }).click()
    await page.getByRole('button', { name: 'Finalizar selecionados' }).click()
    await expect(page.getByRole('heading', { name: 'Finalizados (1)' })).toBeVisible()

    await page.goto(`/pacientes/${p.id}/evolucoes`)
    await page.getByLabel('Nova evolução').fill('Exodontia do 26 sem intercorrências.')
    await page.getByRole('button', { name: 'Registrar' }).click()
    await expect(page.getByText('Exodontia do 26 sem intercorrências.')).toBeVisible()
  })

  test('F03-E1 finalizar vários de uma vez', async ({ page, clinic }) => {
    const p = await clinic.call('POST', '/patients', { name: 'Otto Vários' })
    const procs = await clinic.call('GET', '/procedures')
    await clinic.call('POST', `/patients/${p.id}/treatments`, { procedureId: procs.find((x: any) => x.scope === 'tooth').id, professionalId: clinic.professionalId, teeth: [{ tooth: 14 }, { tooth: 15 }], charge: false })
    await enter(page, clinic.session, `/pacientes/${p.id}/tratamentos`)
    await page.getByRole('checkbox', { name: /Selecionar .*14/ }).click()
    await page.getByRole('checkbox', { name: /Selecionar .*15/ }).click()
    await page.getByRole('button', { name: 'Finalizar selecionados' }).click()
    await expect(page.getByRole('status').filter({ hasText: '2 tratamentos finalizados' })).toBeVisible()
  })

  test('F03-E2 evolução com imagem anexada', async ({ page, clinic }) => {
    const p = await clinic.call('POST', '/patients', { name: 'Paula Imagem' })
    await enter(page, clinic.session, `/pacientes/${p.id}/evolucoes`)
    await page.getByLabel('Nova evolução').fill('Radiografia de controle.')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Anexar imagem' }).click()
    await (await chooser).setFiles({ name: 'rx.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByRole('list', { name: 'Arquivos a anexar' })).toContainText('rx.png')
    await page.getByRole('button', { name: 'Registrar' }).click()
    await expect(page.getByRole('list', { name: 'Anexos' }).getByRole('button', { name: /rx.png/ })).toBeVisible()
    await page.getByRole('list', { name: 'Anexos' }).getByRole('button').first().click()
    await expect(page.getByRole('dialog', { name: 'rx.png' }).getByRole('img', { name: 'rx.png' })).toBeVisible()
  })

  test('F03-E3 anotação no dente pelo odontograma', async ({ page, clinic }) => {
    const p = await clinic.call('POST', '/patients', { name: 'Quim Anotação' })
    await enter(page, clinic.session, `/pacientes/${p.id}/tratamentos`)
    await page.getByRole('button', { name: /^Dente 36/ }).click()
    const d = page.getByRole('dialog', { name: 'Dente 36' })
    await d.getByLabel('Nova anotação').fill('Fratura na distal.')
    await d.getByRole('button', { name: 'Salvar anotação' }).click()
    await expect(d.getByText('Fratura na distal.')).toBeVisible()
    await d.getByRole('button', { name: 'Fechar' }).first().click()
    await expect(page.getByRole('button', { name: /^Dente 36, com anotação/ })).toBeVisible()
  })
})

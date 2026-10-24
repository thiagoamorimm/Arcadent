import { API, enter, expect, signup, test } from './fixtures'

test.describe('F10 Dono configura a clínica', () => {
  test('F10-H1 cria conta e configura clínica, equipe e preços', async ({ page }) => {
    const email = `dono+${Date.now()}@exemplo.test`
    await page.goto('/criar-conta')
    await page.getByLabel('Seu nome').fill('Dra. Wanda')
    await page.getByLabel('Nome da clínica ou consultório').fill('Sorriso Wanda')
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Senha').fill('senha-forte-123')
    await page.getByRole('button', { name: 'Criar conta e começar' }).click()
    await expect(page).toHaveURL(/\/agenda/)

    await page.goto('/ajustes/clinica')
    await page.getByLabel('Telefone').fill('(48) 3333-4444')
    await page.getByRole('button', { name: 'Salvar' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: /salv/i }).first()).toBeVisible()

    await page.goto('/ajustes/equipe')
    await page.getByRole('button', { name: 'Convidar pessoa' }).click()
    await page.getByRole('dialog').getByLabel('E-mail').fill(`dentista+${Date.now()}@exemplo.test`)
    await page.getByRole('dialog').getByRole('button', { name: 'Gerar convite' }).click()
    await expect(page.getByLabel('Link do convite')).toHaveValue(/\/convite\//)
    await page.getByRole('button', { name: 'Concluir' }).click()

    await page.goto('/ajustes/precos')
    await page.getByRole('button', { name: /Novo procedimento/ }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Nome').fill('Facetas de resina')
    await d.getByLabel('Preço').click()
    await page.keyboard.type('45000')
    await d.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText('Facetas de resina')).toBeVisible()
  })

  test('F10-E1 senha curta bloqueia o cadastro', async ({ page }) => {
    await page.goto('/criar-conta')
    await page.getByLabel('Senha').fill('1234567')
    await expect(page.getByText('A senha precisa ter pelo menos 8 caracteres.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Criar conta e começar' })).toBeDisabled()
  })

  test('F10-E2 e-mail já cadastrado dá mensagem clara', async ({ page, clinic }) => {
    await page.goto('/criar-conta')
    await page.getByLabel('Seu nome').fill('Repetida')
    await page.getByLabel('Nome da clínica ou consultório').fill('Outra')
    await page.getByLabel('E-mail').fill(clinic.email)
    await page.getByLabel('Senha').fill('senha-forte-123')
    await page.getByRole('button', { name: 'Criar conta e começar' }).click()
    await expect(page.getByRole('alert')).toContainText(/e-mail/i)
    await expect(page).toHaveURL(/criar-conta/)
  })

  test('F10-N1 dentista convidado não vê Ajustes', async ({ page, clinic, request }) => {
    const email = `dent+${Date.now()}@exemplo.test`
    const inv = await clinic.call('POST', '/team/invitations', { email, role: 'dentist', doesAttend: true })
    const r = await request.post(`${API}/public/invitations/${inv.token}/accept`, { data: { name: 'Dr. Xavier', password: 'senha-forte-123' } })
    const s = await r.json()
    await enter(page, s)
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ajustes' })).toHaveCount(0)
    await page.goto('/ajustes/equipe')
    await expect(page).toHaveURL(/\/agenda/)
  })
})

test.describe('F11 Conta e sessão', () => {
  test('F11-H1/N1 login certo entra; senha errada avisa', async ({ page, clinic }) => {
    await page.goto('/entrar')
    await page.getByLabel('E-mail').fill(clinic.email)
    await page.getByLabel('Senha').fill('errada-123')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.')
    await page.getByLabel('Senha').fill(clinic.password)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/agenda/)
  })

  test('F11-H2 esqueci a senha → link → senha nova', async ({ page, clinic, request }) => {
    await page.goto('/entrar')
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click()
    // espera a troca de tela: senão o e-mail cai no campo da tela de login que está saindo
    await expect(page.getByRole('heading', { name: 'Esqueci minha senha' })).toBeVisible()
    await page.getByLabel('E-mail').fill(clinic.email)
    await page.getByRole('button', { name: 'Enviar link' }).click()
    await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible()
    const mail = await (await request.get(`${API}/public/dev/outbox?to=${encodeURIComponent(clinic.email)}`)).json()
    const link = new URL(mail[0].body.match(/http\S+/)[0])
    await page.goto(link.pathname + link.search)
    await page.getByLabel(/^Senha nova/).fill('nova-senha-456')
    await page.getByLabel('Repita a senha nova').fill('nova-senha-456')
    await page.getByRole('button', { name: 'Salvar e entrar' }).click()
    await expect(page).toHaveURL(/\/agenda/)
    const old = await request.post(`${API}/auth/login`, { data: { email: clinic.email, password: clinic.password } })
    expect(old.status()).toBe(401)
  })

  test('F11-E1 token de acesso vencido renova sozinho', async ({ page, clinic }) => {
    await enter(page, clinic.session, '/pacientes')
    await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible()
    await page.evaluate(() => localStorage.setItem('clinica.token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x'))
    const refresh = page.waitForResponse((r) => r.url().endsWith('/auth/refresh'))
    await page.reload()
    expect((await refresh).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible()
    await expect(page).toHaveURL(/\/pacientes/)
  })

  test('F11-E2 sem renovação válida volta ao login lembrando a página', async ({ page, clinic }) => {
    await enter(page, clinic.session, '/financeiro')
    await expect(page.getByRole('heading', { name: 'Financeiro' })).toBeVisible()
    await page.evaluate(() => { localStorage.setItem('clinica.token', 'x.y.z'); localStorage.setItem('clinica.refresh', 'invalido') })
    await page.reload()
    await expect(page).toHaveURL(/\/entrar/)
    await page.getByLabel('E-mail').fill(clinic.email)
    await page.getByLabel('Senha').fill(clinic.password)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/financeiro/)
  })
})

test('F13-N1 ficha de outra clínica pela URL não vaza', async ({ page, clinic, request }) => {
  const other = await signup(request, 'Dr. Outro', 'Clínica B')
  const p = await other.call('POST', '/patients', { name: 'Segredo da Clínica B' })
  await enter(page, clinic.session, `/pacientes/${p.id}`)
  await expect(page.getByText('Paciente não encontrado')).toBeVisible()
  await expect(page.getByText('Segredo da Clínica B')).toHaveCount(0)
})

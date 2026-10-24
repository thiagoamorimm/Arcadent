import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { ApiError, post } from '../api/client'
import type { Session } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Choice'
import { Card } from '../ui/Feedback'
import { Field, Input } from '../ui/Field'
import { Logo } from '../domain/AppShell'

function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  useEffect(() => { document.title = `${title} · Arcadent` }, [title])
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2">
          <Logo size={40} />
          <span className="text-lg font-semibold">Arcadent</span>
        </div>
        <Card className="p-6 sm:p-8">
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </Card>
        <p className="mt-4 text-center text-sm text-text-muted">{footer}</p>
      </div>
    </main>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>
}

/** S01 — Entrar */
export function LoginPage() {
  const { login, token } = useAuth()
  const nav = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/agenda'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (token) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email, password)
      nav(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title="Entrar"
      subtitle="Acesse a agenda e as fichas da sua clínica."
      footer={<>Ainda não usa? <Link to="/criar-conta" className="font-semibold text-accent-text underline-offset-2 hover:underline">Crie sua conta grátis</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field label="E-mail" required>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Senha" required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Link to="/esqueci-senha" state={{ email }} className="-mt-2 w-fit text-sm text-accent-text underline-offset-2 hover:underline">Esqueci minha senha</Link>
        <Button type="submit" size="lg" loading={busy} disabled={!email || !password}>Entrar</Button>
      </form>
    </AuthFrame>
  )
}

/** S02 — Criar conta (clínica + dono + teste de 14 dias) */
export function SignupPage() {
  const { signup, token } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ name: '', email: '', password: '', clinicName: '' })
  const [attends, setAttends] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (token) return <Navigate to="/agenda" replace />
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const weak = f.password.length > 0 && f.password.length < 8

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signup({ ...f, attends })
      nav('/agenda', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title="Crie sua conta"
      subtitle="14 dias para testar tudo. Sem cartão."
      footer={<>Já tem conta? <Link to="/entrar" className="font-semibold text-accent-text underline-offset-2 hover:underline">Entrar</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field label="Seu nome" required><Input autoComplete="name" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Nome da clínica ou consultório" required><Input value={f.clinicName} onChange={set('clinicName')} /></Field>
        <Field label="E-mail" required><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Senha" required hint="Mínimo de 8 caracteres." error={weak ? 'A senha precisa ter pelo menos 8 caracteres.' : undefined}>
          <Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
        <Checkbox label="Eu também atendo pacientes (quero uma agenda)" checked={attends} onCheckedChange={setAttends} />
        <Button type="submit" size="lg" loading={busy} disabled={!f.name || !f.email || f.password.length < 8 || !f.clinicName}>
          Criar conta e começar
        </Button>
      </form>
    </AuthFrame>
  )
}

const backToLogin = <>Lembrou? <Link to="/entrar" className="font-semibold text-accent-text underline-offset-2 hover:underline">Entrar</Link></>

/** S01b — Esqueci minha senha: pede o link por e-mail. A resposta não diz se o e-mail tem conta. */
export function ForgotPage() {
  const initial = (useLocation().state as { email?: string } | null)?.email ?? ''
  const [email, setEmail] = useState(initial)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await post('/auth/forgot', { email })
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'VALIDATION' ? 'Confira o e-mail digitado.' : err.message) : 'Não foi possível enviar.')
    } finally {
      setBusy(false)
    }
  }
  if (sent) {
    return (
      <AuthFrame title="Confira seu e-mail" subtitle={`Se ${email} tiver conta, chega em instantes um link para criar uma senha nova.`} footer={backToLogin}>
        <div className="flex flex-col gap-4 text-sm">
          <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-info"><MailCheck aria-hidden className="mt-0.5 size-4 shrink-0" />O link vale por 1 hora e só funciona uma vez. Não chegou? Olhe o spam ou peça de novo.</p>
          <Button variant="secondary" onClick={() => setSent(false)}>Pedir outro link</Button>
        </div>
      </AuthFrame>
    )
  }
  return (
    <AuthFrame title="Esqueci minha senha" subtitle="Informe o e-mail da sua conta. Mandamos um link para criar uma senha nova." footer={backToLogin}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field label="E-mail" required><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Button type="submit" size="lg" loading={busy} disabled={!email.includes('@')}>Enviar link</Button>
      </form>
    </AuthFrame>
  )
}

/** S01c — Redefinir senha pelo link do e-mail. Ao salvar, já entra (e as outras sessões caem). */
export function ResetPage() {
  const { adopt } = useAuth()
  const nav = useNavigate()
  const token = useSearchParams()[0].get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const weak = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && confirm !== password
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (weak || mismatch || !password) return
    setError(null)
    setBusy(true)
    try {
      adopt(await post<Session>('/auth/reset', { token, password }))
      nav('/agenda', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a senha.')
    } finally {
      setBusy(false)
    }
  }
  if (!token) {
    return (
      <AuthFrame title="Link incompleto" subtitle="Abra o link exatamente como chegou no e-mail, ou peça um novo." footer={backToLogin}>
        <Link to="/esqueci-senha" className="font-semibold text-accent-text underline-offset-2 hover:underline">Pedir um link novo</Link>
      </AuthFrame>
    )
  }
  return (
    <AuthFrame title="Crie uma senha nova" subtitle="Depois de salvar, você entra direto. Quem estiver com a senha antiga em outro aparelho sai." footer={backToLogin}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        {error && <Link to="/esqueci-senha" className="-mt-2 w-fit text-sm text-accent-text underline-offset-2 hover:underline">Pedir um link novo</Link>}
        <Field label="Senha nova" required hint="Mínimo de 8 caracteres." error={weak ? 'A senha precisa ter pelo menos 8 caracteres.' : undefined}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="Repita a senha nova" required error={mismatch ? 'As senhas não são iguais.' : undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" loading={busy} disabled={!password || weak || confirm !== password}>Salvar e entrar</Button>
      </form>
    </AuthFrame>
  )
}

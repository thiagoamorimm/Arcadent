import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, get, post } from '../api/client'
import type { InvitePreview, Session } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../ui/Button'
import { Card, Skeleton } from '../ui/Feedback'
import { Field, Input } from '../ui/Field'

const ROLE: Record<string, string> = { dentist: 'dentista', secretary: 'recepção', custom: 'equipe' }

/** Página pública do convite: conta nova cria a senha; conta existente confirma a senha dela. */
export function InvitePage() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const { adopt, token: current, logout } = useAuth()
  const preview = useQuery({ queryKey: ['invite', token], queryFn: () => get<InvitePreview>(`/public/invitations/${token}`), retry: false })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const accept = useMutation({
    mutationFn: () => post<Session>(`/public/invitations/${token}/accept`, { name: name || undefined, password }),
    onSuccess: (s) => { if (current) logout(); adopt(s); nav('/agenda', { replace: true }) },
  })
  const p = preview.data
  const submit = (e: FormEvent) => { e.preventDefault(); if (password.length >= 8) accept.mutate() }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-[440px]">
        <Card className="p-6 sm:p-8">
          {preview.isLoading && <Skeleton className="h-40 w-full" />}
          {preview.isError && (
            <div className="flex flex-col items-start gap-3">
              <AlertTriangle aria-hidden className="size-6 text-warning" />
              <h1 className="text-xl font-bold">Convite indisponível</h1>
              <p className="text-sm text-text-muted">
                {preview.error instanceof ApiError && preview.error.status !== 404 ? preview.error.message : 'O link está incompleto ou foi cancelado. Peça um novo convite a quem enviou.'}
              </p>
              <Link to="/entrar" className="text-sm font-semibold text-accent-text underline">Ir para o login</Link>
            </div>
          )}
          {p && (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">Convite</p>
                <h1 className="mt-1 text-xl font-bold">Entrar na equipe da {p.clinicName}</h1>
                <p className="mt-1 text-sm text-text-muted">Você foi convidado(a) como <strong>{ROLE[p.role] ?? 'equipe'}</strong> com o e-mail <strong>{p.email}</strong>.</p>
              </div>
              {accept.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{accept.error instanceof ApiError ? accept.error.message : 'Não foi possível aceitar.'}</p>}
              {p.hasAccount ? (
                <Field label="Sua senha" required hint="Você já tem conta com este e-mail. Use a mesma senha.">
                  <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                </Field>
              ) : (
                <>
                  <Field label="Seu nome" required><Input autoComplete="name" defaultValue={p.name ?? ''} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
                  <Field label="Crie uma senha" required hint="Mínimo de 8 caracteres.">
                    <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                </>
              )}
              <Button type="submit" size="lg" loading={accept.isPending} disabled={password.length < 8}>Entrar na equipe</Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  )
}

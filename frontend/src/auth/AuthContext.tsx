import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { get, post, setUnauthorizedHandler, tokenStore } from '../api/client'
import type { Me, Session } from '../api/types'

interface AuthValue {
  token: string | null
  me: Me | undefined
  login: (email: string, password: string) => Promise<void>
  signup: (data: { name: string; email: string; password: string; clinicName: string; attends: boolean }) => Promise<void>
  logout: () => void
  /** Entra com uma sessão já criada (ex.: aceite de convite, senha redefinida). */
  adopt: (s: Session) => void
  /** Troca a clínica atual (quem tem vínculo com mais de uma). Limpa os dados da clínica anterior. */
  switchClinic: (clinicId: string) => Promise<void>
  /** Dono tem tudo; demais conforme o vínculo. Enquanto /me carrega, nega. */
  can: (perm: string) => boolean
}
const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [token, setToken] = useState(tokenStore.get())

  const logout = useCallback(() => {
    const rt = tokenStore.refresh()
    // Revoga a sessão no servidor (sem esperar: sair é imediato mesmo offline).
    if (rt) post('/auth/logout', { refreshToken: rt }).catch(() => {})
    tokenStore.clear()
    setToken(null)
    qc.clear()
  }, [qc])

  useEffect(() => setUnauthorizedHandler(logout), [logout])

  const me = useQuery({ queryKey: ['me', token], queryFn: () => get<Me>('/me'), enabled: !!token, staleTime: 60_000 })

  const start = (s: Session) => { tokenStore.set(s); setToken(s.token) }
  const value: AuthValue = {
    token,
    me: me.data,
    login: async (email, password) => start(await post<Session>('/auth/login', { email, password })),
    signup: async (data) => start(await post<Session>('/auth/signup', data)),
    logout,
    adopt: start,
    switchClinic: async (clinicId) => {
      const s = await post<Session>('/auth/switch', { clinicId, refreshToken: tokenStore.refresh() ?? undefined })
      qc.clear()
      start(s)
    },
    can: (perm) => me.data?.role === 'owner' || (me.data?.permissions ?? []).includes(perm),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fora do AuthProvider')
  return v
}

/** Rotas internas: sem token, volta para o login lembrando de onde veio. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const loc = useLocation()
  if (!token) return <Navigate to="/entrar" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}

export const useCan = () => useAuth().can

/** Bloqueia a rota inteira sem a permissão (o servidor também bloqueia; isto só evita a tela quebrada). */
export function RequirePerm({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { me, can } = useAuth()
  if (!me) return null
  const ok = Array.isArray(perm) ? perm.some(can) : can(perm)
  if (!ok) return <Navigate to="/agenda" replace />
  return <>{children}</>
}

import type { ReactNode } from 'react'
import { Navigate, NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { cn } from '../../ui/cn'
import { Page } from '../Layout'

export const SETTINGS_SECTIONS = [
  { to: '/ajustes/clinica', label: 'Clínica e expediente', perm: 'config.clinic' },
  { to: '/ajustes/equipe', label: 'Equipe e permissões', perm: 'config.team' },
  { to: '/ajustes/precos', label: 'Tabelas de preço', perm: 'config.plans' },
  { to: '/ajustes/rotulos', label: 'Rótulos da agenda', perm: 'config.records' },
  { to: '/ajustes/anamnese', label: 'Modelos de anamnese', perm: 'config.anamnesis' },
  { to: '/ajustes/financeiro', label: 'Contas e categorias', perm: 'config.finance' },
  { to: '/ajustes/auditoria', label: 'Auditoria', perm: 'config.team' },
  { to: '/ajustes/assinatura', label: 'Assinatura', perm: 'config.clinic' },
] as const

/** Ajustes: submenu à esquerda (no celular vira faixa rolável em cima). Só mostra o que a pessoa pode mexer. */
export function SettingsLayout({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  const { can } = useAuth()
  const sections = SETTINGS_SECTIONS.filter((s) => can(s.perm))
  return (
    <Page title="Ajustes">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <nav aria-label="Seções de ajustes" className="relative -mx-4 overflow-x-auto px-4 lg:mx-0 lg:w-56 lg:shrink-0 lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {sections.map((s) => (
              <li key={s.to}>
                <NavLink
                  to={s.to}
                  className={({ isActive }) => cn(
                    'block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-accent-soft text-accent-text' : 'text-text-muted hover:bg-bg hover:text-text',
                  )}
                >
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-labelledby="settings-title" className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="settings-title" className="text-lg font-semibold">{title}</h2>
              {description && <p className="mt-0.5 max-w-2xl text-sm text-text-muted">{description}</p>}
            </div>
            {actions}
          </div>
          {children}
        </section>
      </div>
    </Page>
  )
}

/** /ajustes → primeira seção que a pessoa pode abrir. */
export function SettingsIndex() {
  const { me, can } = useAuth()
  if (!me) return null
  const first = SETTINGS_SECTIONS.find((s) => can(s.perm))
  return <Navigate to={first?.to ?? '/agenda'} replace />
}

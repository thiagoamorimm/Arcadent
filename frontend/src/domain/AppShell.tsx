import {
  ArrowLeftRight, BarChart3, Boxes, CalendarDays, Check, ChevronDown, ChevronsLeft, ChevronsRight, CircleDollarSign, HelpCircle,
  LogOut, Settings, Users, Wrench,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Avatar } from '../ui/Feedback'
import { MenuButton } from '../ui/Overlay'
import { cn } from '../ui/cn'

/** perms: precisa de ao menos uma (sem perms = todos veem). */
export const NAV: { to: string; label: string; icon: typeof CalendarDays; perms?: string[] }[] = [
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/pacientes', label: 'Pacientes', icon: Users },
  { to: '/financeiro', label: 'Financeiro', icon: CircleDollarSign, perms: ['fin.debits_view', 'fin.expenses_view'] },
  { to: '/indicadores', label: 'Indicadores', icon: BarChart3, perms: ['insight.performance', 'insight.tasks'] },
  { to: '/protese', label: 'Prótese', icon: Wrench, perms: ['prosthesis.manage'] },
  { to: '/estoque', label: 'Estoque', icon: Boxes, perms: ['stock.manage'] },
]

/** Logo do produto (decorativa: o nome da clínica ao lado é o texto). */
export function Logo({ size = 32 }: { size?: number }) {
  return <img src="/brand/logo.png" alt="" aria-hidden width={size} height={size} className="shrink-0 select-none object-contain" style={{ width: size, height: size }} />
}

/** Faixa de aviso do período de teste (texto próprio). */
export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  return (
    <div role="status" className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 bg-warning-soft px-4 py-1 text-sm text-warning">
      <span>
        {daysLeft > 0 ? <>Seu período de teste termina em <strong>{daysLeft} {daysLeft === 1 ? 'dia' : 'dias'}</strong>.</> : <>Seu período de teste terminou.</>}
      </span>
      <Link to="/ajustes/assinatura" className="font-semibold underline underline-offset-2">Ver assinatura</Link>
    </div>
  )
}

/** Modo leitura: a clínica consulta tudo, mas não grava (o servidor recusa com READ_ONLY). */
export function ReadOnlyBanner() {
  return (
    <div role="status" className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 bg-danger-soft px-4 py-1 text-sm text-danger">
      <span><strong>Modo leitura:</strong> dá para consultar tudo, mas não lançar nada novo até regularizar a assinatura.</span>
      <Link to="/ajustes/assinatura" className="font-semibold underline underline-offset-2">Ver assinatura</Link>
    </div>
  )
}

/** Moldura do app: barra lateral recolhível + topo. Navegação = <nav> com links de verdade. */
export function AppShell({
  clinic, user, title, actions, trialDaysLeft, onLogout, showSettings = true, clinics = [], currentClinicId, onSwitchClinic, notice, can, children,
}: {
  /** esconde do menu o que a pessoa não pode abrir */
  can?: (perm: string) => boolean
  clinic: string; user: string; title: string; actions?: ReactNode; trialDaysLeft?: number
  onLogout?: () => void; showSettings?: boolean
  /** Clínicas em que a pessoa tem vínculo; com mais de uma, o nome da clínica vira seletor. */
  clinics?: { id: string; name: string }[]; currentClinicId?: string; onSwitchClinic?: (id: string) => void
  /** Faixa no topo no lugar do aviso de teste (ex.: modo leitura). */
  notice?: ReactNode
  children: ReactNode
}) {
  const many = clinics.length > 1 && !!onSwitchClinic
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024)
  const link = (active: boolean) =>
    cn(
      'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
      active ? 'bg-accent-soft text-accent-text' : 'text-text-muted hover:bg-surface hover:text-text',
    )
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-bg focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>
      {notice ?? (trialDaysLeft !== undefined && <TrialBanner daysLeft={trialDaysLeft} />)}
      <div className="flex flex-1">
        <aside
          className="sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-[var(--motion-base)]"
          style={{ width: open ? 'var(--layout-sidebar-expanded)' : 'var(--layout-sidebar-collapsed)' }}
        >
          <div className="flex h-[var(--layout-header)] items-center gap-2 border-b border-border px-3">
            {many ? (
              <MenuButton
                trigger={
                  <button className="-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface" aria-label={`Clínica atual: ${clinic}. Trocar de clínica`}>
                    <Logo />
                    {open && <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={clinic}>{clinic}</span>}
                    {open && <ChevronDown aria-hidden className="size-4 shrink-0 text-text-muted" />}
                  </button>
                }
                items={clinics.map((c) => ({
                  label: c.name,
                  icon: c.id === currentClinicId ? <Check className="size-4 text-accent-text" /> : <ArrowLeftRight className="size-4 text-text-muted" />,
                  onSelect: () => { if (c.id !== currentClinicId) onSwitchClinic!(c.id) },
                }))}
              />
            ) : (
              <>
                <Logo />
                {open && <span className="truncate text-sm font-semibold" title={clinic}>{clinic}</span>}
              </>
            )}
          </div>
          <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 p-2">
            {NAV.filter((n) => !n.perms || !can || n.perms.some(can)).map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => link(isActive)} title={open ? undefined : label}>
                <Icon aria-hidden className="size-5 shrink-0" />
                {open ? label : <span className="sr-only">{label}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-col gap-1 border-t border-border p-2">
            {showSettings && (
              <NavLink to="/ajustes" className={({ isActive }) => link(isActive)} title={open ? undefined : 'Ajustes'}>
                <Settings aria-hidden className="size-5 shrink-0" />
                {open ? 'Ajustes' : <span className="sr-only">Ajustes</span>}
              </NavLink>
            )}
            <button onClick={() => setOpen((v) => !v)} className={link(false)} aria-expanded={open} aria-label={open ? 'Recolher menu' : 'Expandir menu'}>
              {open ? <ChevronsLeft aria-hidden className="size-5 shrink-0" /> : <ChevronsRight aria-hidden className="size-5 shrink-0" />}
              {open && 'Recolher'}
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[var(--layout-header)] items-center gap-3 border-b border-border bg-bg px-4 sm:px-6">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
            {actions}
            <button aria-label="Ajuda" className="hidden rounded-md p-2 text-text-muted hover:bg-surface hover:text-text sm:block"><HelpCircle className="size-5" /></button>
            <MenuButton
              trigger={
                <button className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-surface">
                  <Avatar name={user} />
                  {/* nome vem do texto visível (comando de voz "clicar em Ana Prado" funciona); no celular fica só para leitor */}
                  <span className="max-w-40 truncate text-sm font-medium max-md:sr-only">{user}</span>
                  <span className="sr-only">, menu da conta</span>
                </button>
              }
              items={[{ label: 'Sair', onSelect: () => onLogout?.(), icon: <LogOut className="size-4" /> }]}
            />
          </header>
          <main id="conteudo" className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </div>
  )
}

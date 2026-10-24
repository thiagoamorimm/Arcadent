import type { ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-text',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-pill px-2 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

export type AppointmentStatus =
  | 'agendado' | 'confirmado' | 'aguardando' | 'em_atendimento' | 'atendido' | 'faltou' | 'cancelado'

export const statusMeta: Record<AppointmentStatus, { label: string; cls: string }> = {
  agendado: { label: 'Agendado', cls: 'bg-status-scheduled-bg text-status-scheduled-fg' },
  confirmado: { label: 'Confirmado', cls: 'bg-status-confirmed-bg text-status-confirmed-fg' },
  aguardando: { label: 'Na recepção', cls: 'bg-status-waiting-bg text-status-waiting-fg' },
  em_atendimento: { label: 'Em atendimento', cls: 'bg-status-in-care-bg text-status-in-care-fg' },
  atendido: { label: 'Atendido', cls: 'bg-status-done-bg text-status-done-fg' },
  faltou: { label: 'Não compareceu', cls: 'bg-status-no-show-bg text-status-no-show-fg' },
  cancelado: { label: 'Cancelado', cls: 'bg-status-canceled-bg text-status-canceled-fg line-through' },
}

/** Status nunca só por cor: sempre com texto. */
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const m = statusMeta[status]
  return <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded-pill px-2 text-xs font-medium', m.cls)}>{m.label}</span>
}

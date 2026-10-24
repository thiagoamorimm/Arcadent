import { CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from './cn'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-border bg-bg shadow-card', className)}>{children}</div>
}

/** Estado vazio: diz o que é, por que está vazio e qual o próximo passo. */
export function EmptyState({
  icon, title, body, action,
}: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 flex size-12 items-center justify-center rounded-pill bg-surface-sunken text-text-muted">{icon}</div>
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-text-muted">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-sunken', className)} />
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="inline-flex shrink-0 items-center justify-center rounded-pill bg-accent-soft font-semibold text-accent-text"
    >
      {initials}
    </span>
  )
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  )
}

type Toast = { id: number; tone: 'success' | 'danger'; text: string }
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

/** Toasts num aria-live: leitor de tela anuncia sem roubar o foco. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setItems((v) => [...v, { id, tone, text }])
    setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 5000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role="status" className="flex items-start gap-2 rounded-md border border-border bg-bg p-3 shadow-pop">
            {t.tone === 'success'
              ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />}
            <p className="flex-1 text-sm">{t.text}</p>
            <button
              aria-label="Fechar aviso"
              className="text-text-muted hover:text-text"
              onClick={() => setItems((v) => v.filter((x) => x.id !== t.id))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

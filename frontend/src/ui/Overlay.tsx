import * as Dialog from '@radix-ui/react-dialog'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as RTabs from '@radix-ui/react-tabs'
import * as RTooltip from '@radix-ui/react-tooltip'
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { cn } from './cn'

const overlay = 'fixed inset-0 z-40 bg-text/40'

/** Modal centralizado. Esc fecha, foco preso, volta o foco ao gatilho (Radix). */
export function Modal({
  open, onOpenChange, title, description, size = 'md', children, footer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  footer?: ReactNode
}) {
  const w = { sm: 'max-w-[var(--layout-modal-sm)]', md: 'max-w-[var(--layout-modal-md)]', lg: 'max-w-[var(--layout-modal-lg)]' }[size]
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-lg bg-bg shadow-pop',
            w,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(e) => {
            // Foca o campo marcado com data-autofocus (ex.: busca de paciente) em vez do botão Fechar.
            const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-autofocus]')
            if (el) { e.preventDefault(); el.focus() }
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-text-muted">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text" aria-label="Fechar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Painel lateral (ficha rápida, filtros). */
export function Drawer({
  open, onOpenChange, title, children,
}: { open: boolean; onOpenChange: (v: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-full w-[min(var(--layout-drawer),100vw)] flex-col bg-bg shadow-pop">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-text-muted hover:bg-surface" aria-label="Fechar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Confirmação: diz exatamente o que vai acontecer. Destrutiva usa o botão vermelho. */
export function ConfirmDialog({
  open, onOpenChange, title, body, confirmLabel, onConfirm, loading, tone = 'danger',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  loading?: boolean
  /** danger = algo some/é desfeito; primary = confirmação de algo que só cria (ex.: aprovar orçamento) */
  tone?: 'danger' | 'primary'
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm text-text">{body}</div>
    </Modal>
  )
}

export function Tabs({
  tabs, value, onValueChange, label,
}: { tabs: { value: string; label: string; count?: number; content: ReactNode }[]; value: string; onValueChange: (v: string) => void; label: string }) {
  // No celular a faixa de abas rola: mantém a aba ativa sempre visível.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-state="active"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [value])
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List ref={listRef} aria-label={label} className="relative flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 text-sm
              font-medium text-text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
          >
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-pill bg-surface-sunken px-1.5 text-xs text-text-muted">{t.count}</span>
            )}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="pt-4">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  )
}

export function MenuButton({
  trigger, items,
}: { trigger: ReactNode; items: { label: string; onSelect: () => void; danger?: boolean; icon?: ReactNode }[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-md border border-border bg-bg p-1 shadow-pop">
          {items.map((i) => (
            <Menu.Item
              key={i.label}
              onSelect={i.onSelect}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface',
                i.danger ? 'text-danger' : 'text-text',
              )}
            >
              {i.icon}
              {i.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={300}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content sideOffset={6} className="z-50 rounded-sm bg-text px-2 py-1 text-xs text-bg shadow-pop">
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  )
}

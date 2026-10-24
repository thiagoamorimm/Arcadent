import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Landmark, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ApiError, del, get, patch, post } from '../../api/client'
import type { AccountFull, Category, LabelFull } from '../../api/types'
import { AppointmentCard, type LabelColor } from '../../domain/Agenda'
import { Badge } from '../../ui/Badge'
import { Button, IconButton } from '../../ui/Button'
import { Switch } from '../../ui/Choice'
import { Card, EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { Field, Input, Select, EnterSubmits } from '../../ui/Field'
import { ConfirmDialog, Modal } from '../../ui/Overlay'
import { cn, plural } from '../../ui/cn'
import { SettingsLayout } from './SettingsLayout'

export const COLOR_NAMES: Record<string, string> = { '1': 'Azul', '2': 'Verde', '3': 'Âmbar', '4': 'Vermelho', '5': 'Roxo', '6': 'Verde-água', '7': 'Rosa', '8': 'Cinza' }

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// ============================== Rótulos ==============================

/** S31 — Rótulos da agenda (nome + uma das 8 cores da paleta). */
export function LabelsSettings() {
  const labels = useQuery({ queryKey: ['labels-admin'], queryFn: () => get<LabelFull[]>('/labels/manage') })
  const [editing, setEditing] = useState<LabelFull | 'new' | null>(null)
  const [removing, setRemoving] = useState<LabelFull | null>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const remove = useMutation({
    mutationFn: (l: LabelFull) => del(`/labels/${l.id}`),
    onSuccess: () => { ['labels-admin', 'labels', 'appointments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setRemoving(null); toast('success', 'Rótulo excluído.') },
    onError: (e) => toast('danger', errMsg(e, 'Não foi possível excluir.')),
  })
  return (
    <SettingsLayout title="Rótulos da agenda" description="Dê cor às consultas por tipo de atendimento. A cor aparece na barra à esquerda do cartão."
      actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo rótulo</Button>}>
      {labels.isLoading && <Skeleton className="h-32 w-full" />}
      {labels.data?.length === 0 && <EmptyState icon={<Tag className="size-5" />} title="Nenhum rótulo" body="Crie rótulos como Avaliação, Retorno ou Cirurgia." />}
      {!!labels.data?.length && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {labels.data.map((l) => (
            <li key={l.id}>
              <Card className="flex items-center gap-3 p-3">
                <div className="h-14 w-36 shrink-0">
                  <AppointmentCard item={{ id: l.id, day: 0, start: '09:00', end: '09:30', kind: 'consulta', title: l.name, label: Number(l.color) as LabelColor }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-text-muted">{l.usage ? plural(l.usage, 'consulta', 'consultas') : 'sem uso'}</p>
                </div>
                <IconButton size="sm" label={`Editar ${l.name}`} onClick={() => setEditing(l)}><Pencil className="size-4" /></IconButton>
                <IconButton size="sm" label={`Excluir ${l.name}`} onClick={() => setRemoving(l)}><Trash2 className="size-4" /></IconButton>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <LabelModal label={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title={`Excluir o rótulo “${removing.name}”?`}
          body={removing.usage
            ? <>{plural(removing.usage, 'consulta usa', 'consultas usam')} este rótulo. Elas continuam na agenda, só ficam sem cor.</>
            : <>Nenhuma consulta usa este rótulo.</>}
          confirmLabel="Excluir rótulo" loading={remove.isPending} onConfirm={() => remove.mutate(removing)} />
      )}
    </SettingsLayout>
  )
}

function LabelModal({ label, onClose }: { label: LabelFull | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(label?.name ?? '')
  const [color, setColor] = useState(label?.color ?? '1')
  const save = useMutation({
    mutationFn: () => (label ? patch(`/labels/${label.id}`, { name, color }) : post('/labels', { name, color })),
    onSuccess: () => { ['labels-admin', 'labels', 'appointments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('success', 'Rótulo salvo.'); onClose() },
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={label ? 'Editar rótulo' : 'Novo rótulo'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Salvar</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}>
        <EnterSubmits />
        {save.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{errMsg(save.error, 'Não foi possível salvar.')}</p>}
        <Field label="Nome" required><Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-autofocus /></Field>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold">Cor</legend>
          <div role="radiogroup" aria-label="Cor" className="grid grid-cols-4 gap-2">
            {(['1', '2', '3', '4', '5', '6', '7', '8'] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} onClick={() => setColor(c)}
                className={cn('h-10 rounded-md border-2', color === c ? 'border-text' : 'border-transparent')}
                style={{ background: `var(--c-label-${c}-bg)`, boxShadow: `inset 4px 0 0 var(--c-label-${c}-bar)` }} />
            ))}
          </div>
        </fieldset>
        <div className="h-14">
          <AppointmentCard item={{ id: 'p', day: 0, start: '09:00', end: '09:45', kind: 'consulta', title: name || 'Paciente', detail: 'Pré-visualização', label: Number(color) as LabelColor }} />
        </div>
      </form>
    </Modal>
  )
}

// ============================== Contas e categorias ==============================

/** S31 — Contas financeiras (banco/espécie) e categorias de despesa/receita. */
export function FinanceSettings() {
  return (
    <SettingsLayout title="Contas e categorias" description="Onde o dinheiro entra (contas) e como ele é classificado (categorias).">
      <div className="flex flex-col gap-8">
        <AccountsSection />
        <CategoriesSection />
      </div>
    </SettingsLayout>
  )
}

function AccountsSection() {
  const accounts = useQuery({ queryKey: ['accounts-admin'], queryFn: () => get<AccountFull[]>('/financial-accounts/manage') })
  const [editing, setEditing] = useState<AccountFull | 'new' | null>(null)
  const [removing, setRemoving] = useState<AccountFull | null>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const remove = useMutation({
    mutationFn: (a: AccountFull) => del(`/financial-accounts/${a.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts-admin'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); setRemoving(null); toast('success', 'Conta excluída.') },
    onError: (e) => { setRemoving(null); toast('danger', errMsg(e, 'Não foi possível excluir.')) },
  })
  return (
    <section aria-labelledby="acc-h">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 id="acc-h" className="text-base font-semibold">Contas financeiras</h3>
        <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nova conta</Button>
      </div>
      {accounts.isLoading ? <Skeleton className="h-24 w-full" /> : (
        <Card>
          <ul className="divide-y divide-border">
            {accounts.data?.map((a) => (
              <li key={a.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !a.isActive && 'opacity-60')}>
                {a.kind === 'cash' ? <Banknote aria-hidden className="size-5 text-text-muted" /> : <Landmark aria-hidden className="size-5 text-text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="text-xs text-text-muted">{a.kind === 'cash' ? 'Espécie (entra no fechamento de caixa)' : 'Bancária'} · {a.usage ? plural(a.usage, 'movimentação', 'movimentações') : 'sem movimentações'}</p>
                </div>
                {a.isDefault && <Badge tone="success">Padrão</Badge>}
                {!a.isActive && <Badge tone="danger">Desativada</Badge>}
                <IconButton size="sm" label={`Editar ${a.name}`} onClick={() => setEditing(a)}><Pencil className="size-4" /></IconButton>
                {!a.isDefault && <IconButton size="sm" label={`Excluir ${a.name}`} onClick={() => setRemoving(a)}><Trash2 className="size-4" /></IconButton>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <AccountModal account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (removing.usage > 0
        ? <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title="Esta conta tem movimentações"
            body={<>Para não perder o histórico, contas com movimentação não são excluídas. Você pode <strong>desativá-la</strong>: ela some das opções de recebimento, mas o histórico continua.</>}
            confirmLabel="Desativar conta" tone="primary"
            onConfirm={() => { patch(`/financial-accounts/${removing.id}`, { name: removing.name, isActive: false }).then(() => { qc.invalidateQueries({ queryKey: ['accounts-admin'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); toast('success', 'Conta desativada.') }).catch((e) => toast('danger', errMsg(e, 'Não foi possível desativar.'))); setRemoving(null) }} />
        : <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title={`Excluir a conta “${removing.name}”?`}
            body="Ela não tem nenhuma movimentação." confirmLabel="Excluir conta" loading={remove.isPending} onConfirm={() => remove.mutate(removing)} />)}
    </section>
  )
}

function AccountModal({ account, onClose }: { account: AccountFull | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountFull['kind']>(account?.kind ?? 'bank')
  const [isDefault, setIsDefault] = useState(account?.isDefault ?? false)
  const [isActive, setIsActive] = useState(account?.isActive ?? true)
  const save = useMutation({
    mutationFn: () => (account
      ? patch(`/financial-accounts/${account.id}`, { name, kind, isDefault: isDefault || undefined, isActive })
      : post('/financial-accounts', { name, kind, isDefault })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts-admin'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); toast('success', 'Conta salva.'); onClose() },
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={account ? 'Editar conta' : 'Nova conta'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Salvar</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}>
        <EnterSubmits />
        {save.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{errMsg(save.error, 'Não foi possível salvar.')}</p>}
        <Field label="Nome" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Banco do Brasil" data-autofocus /></Field>
        <Field label="Tipo" hint="Espécie = dinheiro e cheque na clínica; entra na abertura e fechamento de caixa.">
          <Select value={kind} onChange={(e) => setKind(e.target.value as AccountFull['kind'])}>
            <option value="bank">Bancária</option>
            <option value="cash">Espécie</option>
          </Select>
        </Field>
        {!account?.isDefault && <Switch label="Conta padrão nos recebimentos" checked={isDefault} onCheckedChange={setIsDefault} />}
        {account && !account.isDefault && <Switch label="Conta ativa" checked={isActive} onCheckedChange={setIsActive} />}
      </form>
    </Modal>
  )
}

function CategoriesSection() {
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories') })
  return (
    <section aria-labelledby="cat-h">
      <h3 id="cat-h" className="mb-2 text-base font-semibold">Categorias</h3>
      {cats.isLoading ? <Skeleton className="h-24 w-full" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <CategoryColumn kind="expense" title="Despesas" items={cats.data?.filter((c) => c.kind === 'expense') ?? []} />
          <CategoryColumn kind="income" title="Receitas" items={cats.data?.filter((c) => c.kind === 'income') ?? []} />
        </div>
      )}
    </section>
  )
}

function CategoryColumn({ kind, title, items }: { kind: Category['kind']; title: string; items: Category[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [adding, setAdding] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<Category | null>(null)
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['categories'] }); toast('success', msg) }
  const add = useMutation({ mutationFn: () => post('/categories', { name: adding, kind }), onSuccess: () => { setAdding(''); done('Categoria criada.') }, onError: (e) => toast('danger', errMsg(e, 'Não foi possível criar.')) })
  const rename = useMutation({ mutationFn: () => patch(`/categories/${renaming!.id}`, { name: renaming!.name, kind }), onSuccess: () => { setRenaming(null); done('Categoria renomeada.') }, onError: (e) => toast('danger', errMsg(e, 'Não foi possível renomear.')) })
  const remove = useMutation({ mutationFn: (c: Category) => del(`/categories/${c.id}`), onSuccess: () => { setRemoving(null); done('Categoria excluída.') } })
  return (
    <Card className="p-4">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-1.5">
            {renaming?.id === c.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) rename.mutate() }}>
                <Input aria-label={`Novo nome para ${c.name}`} value={renaming.name} autoFocus onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} className="h-8" />
                <Button size="sm" type="submit" loading={rename.isPending}>OK</Button>
              </form>
            ) : (
              <>
                <span className="flex-1 text-sm">{c.name}</span>
                {c.usage > 0 && <span className="text-xs text-text-muted">{c.usage}</span>}
                <IconButton size="sm" label={`Renomear ${c.name}`} onClick={() => setRenaming({ id: c.id, name: c.name })}><Pencil className="size-3.5" /></IconButton>
                <IconButton size="sm" label={`Excluir ${c.name}`} onClick={() => setRemoving(c)}><Trash2 className="size-3.5" /></IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) add.mutate() }}>
        <Input aria-label={`Nova categoria de ${title.toLowerCase()}`} placeholder="Nova categoria" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-9" />
        <Button size="sm" type="submit" variant="secondary" disabled={!adding.trim()} loading={add.isPending} icon={<Plus className="size-4" />}>Adicionar</Button>
      </form>
      {removing && (
        <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title={`Excluir “${removing.name}”?`}
          body={removing.usage ? <>{plural(removing.usage, 'lançamento usa', 'lançamentos usam')} esta categoria e vão ficar “sem categoria”.</> : 'Nenhum lançamento usa esta categoria.'}
          confirmLabel="Excluir categoria" loading={remove.isPending} onConfirm={() => remove.mutate(removing)} />
      )}
    </Card>
  )
}

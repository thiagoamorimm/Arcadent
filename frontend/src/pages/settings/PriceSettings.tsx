import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, get, patch, post } from '../../api/client'
import type { PriceTable, ProcedureFull, Scope } from '../../api/types'
import { Badge } from '../../ui/Badge'
import { Button, IconButton } from '../../ui/Button'
import { Switch } from '../../ui/Choice'
import { DataTable } from '../../ui/DataTable'
import { EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { Field, Input, MoneyInput, Select, EnterSubmits } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { cn, formatMoney } from '../../ui/cn'
import { SettingsLayout } from './SettingsLayout'

const SCOPE: Record<Scope, string> = {
  tooth: 'Por dente', face: 'Por face do dente', region: 'Por região/sextante', arch: 'Por arcada', mouth: 'Boca toda',
}
const SPECIALTIES = ['clinica_geral', 'prevencao', 'dentistica', 'endodontia', 'periodontia', 'cirurgia', 'protese',
  'implantodontia', 'ortodontia', 'estetica', 'radiologia', 'hof', 'odontopediatria']
const SPECIALTY_LABEL: Record<string, string> = {
  clinica_geral: 'Clínica geral', prevencao: 'Prevenção', dentistica: 'Dentística', endodontia: 'Endodontia',
  periodontia: 'Periodontia', cirurgia: 'Cirurgia', protese: 'Prótese', implantodontia: 'Implantodontia',
  ortodontia: 'Ortodontia', estetica: 'Estética', radiologia: 'Radiologia', hof: 'Harmonização (HOF)', odontopediatria: 'Odontopediatria',
}

/** S30 — Tabelas de preço (Particular + convênios) e procedimentos. */
export function PriceSettings() {
  const tables = useQuery({ queryKey: ['price-tables'], queryFn: () => get<PriceTable[]>('/price-tables') })
  const [selected, setSelected] = useState<string | null>(null)
  const [newTable, setNewTable] = useState(false)
  const [editTable, setEditTable] = useState<PriceTable | null>(null)
  useEffect(() => { if (!selected && tables.data?.length) setSelected(tables.data[0].id) }, [tables.data, selected])
  const current = tables.data?.find((t) => t.id === selected)

  return (
    <SettingsLayout
      title="Tabelas de preço"
      description="A tabela padrão é a usada nos orçamentos. Crie uma tabela por convênio com os valores que ele paga."
      actions={<Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setNewTable(true)}>Nova tabela</Button>}
    >
      {tables.isLoading && <Skeleton className="h-40 w-full" />}
      {tables.data && (
        <div className="flex flex-col gap-4">
          <div role="tablist" aria-label="Tabelas" className="flex flex-wrap gap-2">
            {tables.data.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === selected}
                onClick={() => setSelected(t.id)}
                className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                  t.id === selected ? 'border-accent bg-accent-soft text-accent-text' : 'border-border-strong bg-bg hover:bg-surface',
                  !t.isActive && 'opacity-60')}
              >
                {t.isDefault && <Star aria-label="padrão" className="size-3.5 fill-current" />}
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-text-muted">{t.procedureCount}</span>
              </button>
            ))}
          </div>
          {current && (
            <ProceduresOf table={current} onEditTable={() => setEditTable(current)} />
          )}
        </div>
      )}
      {newTable && tables.data && <TableModal tables={tables.data} onClose={(id) => { setNewTable(false); if (id) setSelected(id) }} />}
      {editTable && tables.data && <TableModal tables={tables.data} table={editTable} onClose={() => setEditTable(null)} />}
    </SettingsLayout>
  )
}

function ProceduresOf({ table, onEditTable }: { table: PriceTable; onEditTable: () => void }) {
  const [showInactive, setShowInactive] = useState(false)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<ProcedureFull | 'new' | null>(null)
  const procs = useQuery({
    queryKey: ['procedures-admin', table.id, showInactive],
    queryFn: () => get<ProcedureFull[]>(`/price-tables/${table.id}/procedures?includeInactive=${showInactive}`),
  })
  const term = q.trim().toLowerCase()
  const rows = (procs.data ?? []).filter((p) => !term || p.name.toLowerCase().includes(term) || (p.tussCode ?? '').includes(term))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={table.kind === 'particular' ? 'accent' : 'info'}>{table.kind === 'particular' ? 'Particular' : 'Convênio'}</Badge>
          {table.isDefault && <Badge tone="success">Padrão nos orçamentos</Badge>}
          {!table.isActive && <Badge tone="danger">Desativada</Badge>}
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEditTable}>Editar tabela</Button>
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input aria-label="Buscar procedimento" placeholder="Nome ou código TUSS" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Switch label="Mostrar desativados" checked={showInactive} onCheckedChange={setShowInactive} />
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo procedimento</Button>
      </div>
      {procs.isLoading ? <Skeleton className="h-48 w-full" /> : (
        <DataTable
          caption={`Procedimentos da tabela ${table.name}`}
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', header: 'Procedimento', value: (r) => r.name, render: (r) => <span className={cn(!r.isActive && 'text-text-muted line-through')}>{r.name}</span> },
            { key: 'tuss', header: 'TUSS', value: (r) => r.tussCode ?? '', render: (r) => r.tussCode ? <span className="font-mono text-xs">{r.tussCode}</span> : <span className="text-text-muted">—</span> },
            { key: 'spec', header: 'Especialidade', value: (r) => SPECIALTY_LABEL[r.specialty ?? ''] ?? r.specialty ?? '' },
            { key: 'scope', header: 'Cobrança', value: (r) => SCOPE[r.scope] },
            { key: 'price', header: 'Preço', align: 'right', value: (r) => r.priceCents, render: (r) => formatMoney(r.priceCents) },
            { key: 'act', header: 'Ações', filterable: false, align: 'right', value: () => '', render: (r) => <IconButton size="sm" label={`Editar ${r.name}`} onClick={() => setEditing(r)}><Pencil className="size-4" /></IconButton> },
          ]}
          empty={<EmptyState icon={<Search className="size-5" />} title="Nenhum procedimento" body={term ? 'Nada bate com a busca.' : 'Cadastre o primeiro procedimento desta tabela.'} />}
        />
      )}
      {editing && <ProcedureModal tableId={table.id} proc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TableModal({ tables, table, onClose }: { tables: PriceTable[]; table?: PriceTable; onClose: (id?: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(table?.name ?? '')
  const [kind, setKind] = useState<PriceTable['kind']>(table?.kind ?? 'convenio')
  const [copyFrom, setCopyFrom] = useState(tables.find((t) => t.isDefault)?.id ?? '')
  const [isDefault, setIsDefault] = useState(table?.isDefault ?? false)
  const [isActive, setIsActive] = useState(table?.isActive ?? true)
  const save = useMutation({
    mutationFn: () => table
      ? patch<PriceTable>(`/price-tables/${table.id}`, { name, kind, isDefault: isDefault || undefined, isActive })
      : post<PriceTable>('/price-tables', { name, kind, copyFrom: copyFrom || undefined, isDefault }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['price-tables'] }); qc.invalidateQueries({ queryKey: ['procedures'] }); qc.invalidateQueries({ queryKey: ['procedures-admin'] })
      toast('success', table ? 'Tabela atualizada.' : `Tabela “${t.name}” criada com ${t.procedureCount} procedimentos.`)
      onClose(t.id)
    },
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={table ? 'Editar tabela' : 'Nova tabela de preço'}
      footer={<><Button variant="secondary" onClick={() => onClose()}>Cancelar</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Salvar</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}>
        <EnterSubmits />
        {save.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{save.error instanceof ApiError ? save.error.message : 'Não foi possível salvar.'}</p>}
        <Field label="Nome" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Convênio Odonto Mais" data-autofocus /></Field>
        <Field label="Tipo">
          <Select value={kind} onChange={(e) => setKind(e.target.value as PriceTable['kind'])}>
            <option value="particular">Particular</option>
            <option value="convenio">Convênio</option>
          </Select>
        </Field>
        {!table && (
          <Field label="Começar com os procedimentos de" hint="Copia a lista e os preços; depois você ajusta os valores do convênio.">
            <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Tabela vazia</option>
              {tables.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        {!table?.isDefault && <Switch label="Usar como padrão nos orçamentos" checked={isDefault} onCheckedChange={setIsDefault} />}
        {table && !table.isDefault && <Switch label="Tabela ativa" checked={isActive} onCheckedChange={setIsActive} />}
      </form>
    </Modal>
  )
}

function ProcedureModal({ tableId, proc, onClose }: { tableId: string; proc: ProcedureFull | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({
    name: proc?.name ?? '', tussCode: proc?.tussCode ?? '', specialty: proc?.specialty ?? 'clinica_geral',
    priceCents: proc?.priceCents ?? 0, costCents: proc?.costCents ?? 0, scope: proc?.scope ?? 'tooth' as Scope, isActive: proc?.isActive ?? true,
  })
  const tussBad = f.tussCode !== '' && !/^\d+$/.test(f.tussCode)
  const save = useMutation({
    mutationFn: () => proc ? patch(`/procedures/${proc.id}`, f) : post(`/price-tables/${tableId}/procedures`, f),
    onSuccess: () => {
      ;['procedures-admin', 'price-tables', 'procedures'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      toast('success', proc ? 'Procedimento atualizado.' : 'Procedimento cadastrado.')
      onClose()
    },
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={proc ? 'Editar procedimento' : 'Novo procedimento'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} disabled={!f.name.trim() || tussBad} onClick={() => save.mutate()}>Salvar</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (f.name.trim() && !tussBad) save.mutate() }}>
        <EnterSubmits />
        {save.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{save.error instanceof ApiError ? save.error.message : 'Não foi possível salvar.'}</p>}
        <Field label="Nome" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-autofocus /></Field>
        <Field label="Código TUSS" hint="Só números. Opcional." error={tussBad ? 'Use apenas números.' : undefined}>
          <Input inputMode="numeric" value={f.tussCode} onChange={(e) => setF({ ...f, tussCode: e.target.value.trim() })} />
        </Field>
        <Field label="Especialidade">
          <Select value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })}>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{SPECIALTY_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Preço"><MoneyInput value={f.priceCents} onValueChange={(v) => setF({ ...f, priceCents: v })} /></Field>
        <Field label="Custo (material/laboratório)" hint="Usado no cálculo de comissão e lucro."><MoneyInput value={f.costCents} onValueChange={(v) => setF({ ...f, costCents: v })} /></Field>
        <Field label="Como é cobrado" className="sm:col-span-2" hint="Define o que o orçamento pede: dente, faces ou nada.">
          <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as Scope })}>
            {(Object.keys(SCOPE) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE[s]}</option>)}
          </Select>
        </Field>
        {proc && (
          <div className="sm:col-span-2">
            <Switch label="Ativo (aparece para escolher no orçamento)" checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} />
            <p className="mt-1 text-xs text-text-muted">Procedimentos não são apagados: orçamentos antigos continuam mostrando o nome e o valor da época.</p>
          </div>
        )}
      </form>
    </Modal>
  )
}

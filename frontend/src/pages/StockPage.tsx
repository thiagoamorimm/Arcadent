import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, History, Package, Pencil, Plus, Scale } from 'lucide-react'
import { useState } from 'react'
import { ApiError, get, patch, post } from '../api/client'
import type { StockMovement, StockProduct } from '../api/types'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { Switch } from '../ui/Choice'
import { DataTable, type Column } from '../ui/DataTable'
import { EmptyState, Kpi, Skeleton, useToast } from '../ui/Feedback'
import { EnterSubmits, Field, Input, MoneyInput } from '../ui/Field'
import { Modal } from '../ui/Overlay'
import { formatMoney } from '../ui/cn'
import { Page } from './Layout'

const qtyFmt = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const parseQty = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))
const KIND = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' } as const
type Kind = keyof typeof KIND

/** S26 — Estoque: saldo, mínimo, entradas/saídas/ajustes com histórico. */
export function StockPage() {
  const [showInactive, setShowInactive] = useState(false)
  const q = useQuery({ queryKey: ['stock', showInactive], queryFn: () => get<StockProduct[]>(`/stock/products?includeInactive=${showInactive}`) })
  const [editing, setEditing] = useState<StockProduct | 'new' | null>(null)
  const [moving, setMoving] = useState<{ p: StockProduct; kind: Kind } | null>(null)
  const [history, setHistory] = useState<StockProduct | null>(null)
  const rows = q.data ?? []
  const low = rows.filter((p) => p.isActive && p.low)
  const value = rows.reduce((s, p) => s + (p.isActive && p.costCents ? Math.max(0, Number(p.qty)) * p.costCents : 0), 0)
  const columns: Column<StockProduct>[] = [
    { key: 'n', header: 'Produto', value: (p) => p.name, render: (p) => <span className={p.isActive ? '' : 'text-text-muted line-through'}>{p.name}</span> },
    { key: 'c', header: 'Categoria', value: (p) => p.category ?? '', render: (p) => p.category ?? '—' },
    { key: 'q', header: 'Saldo', value: (p) => Number(p.qty), align: 'right', render: (p) => <span className="whitespace-nowrap font-semibold tabular-nums">{qtyFmt(p.qty)} {p.unit}</span> },
    { key: 'm', header: 'Mínimo', value: (p) => Number(p.minQty), align: 'right', render: (p) => <span className="whitespace-nowrap tabular-nums">{qtyFmt(p.minQty)} {p.unit}</span> },
    { key: 's', header: 'Situação', value: (p) => (p.low ? 'Repor' : 'Ok'), render: (p) => p.low ? <Badge tone="danger"><AlertTriangle aria-hidden className="size-3" />Repor</Badge> : <Badge tone="success">Ok</Badge> },
    { key: 'v', header: 'Último custo', value: (p) => p.costCents ?? 0, align: 'right', render: (p) => <span className="tabular-nums">{p.costCents ? formatMoney(p.costCents) : '—'}</span> },
    {
      key: 'a', header: 'Ações', value: () => '', filterable: false, align: 'right',
      render: (p) => p.isActive ? (
        <div className="flex justify-end gap-1">
          <IconButton size="sm" label={`Entrada de ${p.name}`} onClick={() => setMoving({ p, kind: 'entrada' })}><ArrowDownToLine className="size-4" /></IconButton>
          <IconButton size="sm" label={`Saída de ${p.name}`} onClick={() => setMoving({ p, kind: 'saida' })}><ArrowUpFromLine className="size-4" /></IconButton>
          <IconButton size="sm" label={`Ajustar contagem de ${p.name}`} onClick={() => setMoving({ p, kind: 'ajuste' })}><Scale className="size-4" /></IconButton>
          <IconButton size="sm" label={`Histórico de ${p.name}`} onClick={() => setHistory(p)}><History className="size-4" /></IconButton>
          <IconButton size="sm" label={`Editar ${p.name}`} onClick={() => setEditing(p)}><Pencil className="size-4" /></IconButton>
        </div>
      ) : <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Editar</Button>,
    },
  ]
  return (
    <Page title="Estoque" actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo produto</Button>}>
      {!q.data ? <Skeleton className="h-64 w-full" /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
            <Kpi label="Produtos ativos" value={String(rows.filter((p) => p.isActive).length)} />
            <Kpi label="Para repor" value={String(low.length)} hint={low.length ? low.slice(0, 3).map((p) => p.name).join(', ') + (low.length > 3 ? '…' : '') : 'Tudo acima do mínimo'} />
            <Kpi label="Valor em estoque" value={formatMoney(value)} hint="Saldo × último custo" />
          </div>
          <Switch label="Mostrar desativados" checked={showInactive} onCheckedChange={setShowInactive} />
          <DataTable caption="Produtos do estoque" rows={rows} rowKey={(p) => p.id} columns={columns}
            empty={<EmptyState icon={<Package className="size-5" />} title="Nenhum produto cadastrado" body="Cadastre os materiais que a clínica usa (luvas, anestésico, resina…) com o mínimo para repor." action={<Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo produto</Button>} />} />
        </div>
      )}
      {editing && <ProductModal product={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {moving && <MovementModal product={moving.p} kind={moving.kind} onClose={() => setMoving(null)} />}
      {history && <HistoryModal product={history} onClose={() => setHistory(null)} />}
    </Page>
  )
}

function ProductModal({ product, onClose }: { product?: StockProduct; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ name: product?.name ?? '', unit: product?.unit ?? 'un', category: product?.category ?? '', minQty: product ? qtyFmt(product.minQty) : '0', initialQty: '' })
  const [cost, setCost] = useState(product?.costCents ?? 0)
  const [active, setActive] = useState(product?.isActive ?? true)
  const [touched, setTouched] = useState(false)
  const min = parseQty(f.minQty || '0'), initial = parseQty(f.initialQty || '0')
  const bad = !f.name.trim() || Number.isNaN(min) || min < 0 || Number.isNaN(initial) || initial < 0
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, unit: f.unit, category: f.category || undefined, minQty: min, costCents: cost || undefined, isActive: active }
      return product ? patch<StockProduct>(`/stock/products/${product.id}`, body) : post<StockProduct>('/stock/products', { ...body, initialQty: initial || undefined })
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['stock'] }); toast('success', `${p.name} salvo.`); onClose() },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })
  const submit = () => { setTouched(true); if (!bad && !save.isPending) save.mutate() }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={product ? `Editar ${product.name}` : 'Novo produto'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={submit}>Salvar</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        <Field label="Nome" required className="sm:col-span-2" error={touched && !f.name.trim() ? 'Dê um nome.' : undefined}><Input value={f.name} maxLength={120} onChange={set('name')} data-autofocus /></Field>
        <Field label="Unidade" hint="un, cx, pct, ml, g…"><Input value={f.unit} maxLength={12} onChange={set('unit')} /></Field>
        <Field label="Categoria"><Input value={f.category} maxLength={60} onChange={set('category')} placeholder="Ex.: Descartáveis" /></Field>
        <Field label="Estoque mínimo" hint="Abaixo disso aparece 'Repor'." error={touched && (Number.isNaN(min) || min < 0) ? 'Número inválido.' : undefined}><Input inputMode="decimal" value={f.minQty} onChange={set('minQty')} /></Field>
        <Field label="Custo unitário"><MoneyInput value={cost} onValueChange={setCost} /></Field>
        {!product && <Field label="Quantidade inicial" error={touched && (Number.isNaN(initial) || initial < 0) ? 'Número inválido.' : undefined}><Input inputMode="decimal" value={f.initialQty} onChange={set('initialQty')} placeholder="0" /></Field>}
        {product && <div className="sm:col-span-2"><Switch label="Produto ativo" checked={active} onCheckedChange={setActive} /></div>}
      </form>
    </Modal>
  )
}

function MovementModal({ product, kind, onClose }: { product: StockProduct; kind: Kind; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(product.costCents ?? 0)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const n = parseQty(qty || 'x')
  const after = kind === 'entrada' ? Number(product.qty) + n : kind === 'saida' ? Number(product.qty) - n : n
  const err = Number.isNaN(n) || n < 0 || (kind !== 'ajuste' && n === 0) ? 'Informe a quantidade.'
    : kind === 'saida' && n > Number(product.qty) ? `Só há ${qtyFmt(product.qty)} ${product.unit}.`
      : kind === 'ajuste' && !reason.trim() ? 'Diga o motivo do ajuste.' : null
  const save = useMutation({
    mutationFn: () => post<StockProduct>(`/stock/products/${product.id}/movements`, kind === 'ajuste'
      ? { kind, countedQty: n, reason } : { kind, qty: n, costCents: kind === 'entrada' ? cost || undefined : undefined, reason: reason || undefined }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['stock'] }); toast('success', `${KIND[kind]} registrada: ${p.name} agora tem ${qtyFmt(p.qty)} ${p.unit}.`); onClose() },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível registrar.'),
  })
  const submit = () => { setTouched(true); if (!err && !save.isPending) save.mutate() }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`${KIND[kind]} · ${product.name}`} description={`Saldo atual: ${qtyFmt(product.qty)} ${product.unit}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={submit}>Registrar</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        <Field label={kind === 'ajuste' ? `Quanto há de fato (${product.unit})` : `Quantidade (${product.unit})`} required error={touched ? err ?? undefined : undefined}>
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-autofocus />
        </Field>
        {kind === 'entrada' && <Field label="Custo unitário"><MoneyInput value={cost} onValueChange={setCost} /></Field>}
        <Field label={kind === 'ajuste' ? 'Motivo' : 'Observação'} required={kind === 'ajuste'} className="sm:col-span-2">
          <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'ajuste' ? 'Ex.: contagem do mês, vencido, perda' : kind === 'saida' ? 'Ex.: uso da semana, consultório 2' : 'Ex.: NF 1234, Dental Sul'} />
        </Field>
        {!Number.isNaN(n) && qty && <p className="text-sm text-text-muted sm:col-span-2">Saldo depois: <strong className="tabular-nums text-text">{qtyFmt(after)} {product.unit}</strong>{after <= Number(product.minQty) ? ' — abaixo do mínimo' : ''}</p>}
      </form>
    </Modal>
  )
}

function HistoryModal({ product, onClose }: { product: StockProduct; onClose: () => void }) {
  const q = useQuery({ queryKey: ['stock-mov', product.id], queryFn: () => get<StockMovement[]>(`/stock/products/${product.id}/movements`) })
  return (
    <Modal open size="lg" onOpenChange={(v) => !v && onClose()} title={`Histórico · ${product.name}`} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      {!q.data ? <Skeleton className="h-32 w-full" /> : (
        <DataTable caption={`Movimentos de ${product.name}`} rows={q.data} rowKey={(m) => m.id}
          empty={<EmptyState icon={<History className="size-5" />} title="Sem movimentos" body="Entradas, saídas e ajustes aparecem aqui." />}
          columns={[
            { key: 'd', header: 'Quando', value: (m) => m.createdAt, render: (m) => <span className="whitespace-nowrap">{new Date(m.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span> },
            { key: 'k', header: 'Tipo', value: (m) => KIND[m.kind] },
            { key: 'q', header: 'Qtde', value: (m) => Number(m.qty), align: 'right', render: (m) => <span className="tabular-nums">{Number(m.qty) > 0 ? '+' : ''}{qtyFmt(m.qty)}</span> },
            { key: 'b', header: 'Saldo', value: (m) => Number(m.balance), align: 'right', render: (m) => <span className="tabular-nums">{qtyFmt(m.balance)}</span> },
            { key: 'r', header: 'Motivo', value: (m) => m.reason ?? '', render: (m) => m.reason ?? '—' },
            { key: 'u', header: 'Quem', value: (m) => m.userName ?? '' },
          ]} />
      )}
    </Modal>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, MoreHorizontal, Plus, Receipt, Undo2, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, del, get, patch, post } from '../api/client'
import type { Account, CashRow, CashStatus, Cashflow, Category, ReceiptT } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { METHODS, MONEY_KEYS, ReceiveModal, methodLabel } from '../domain/ReceiveModal'
import { addDays, dateTimeIn, longDate, todayIn, type Ymd } from '../lib/tz'
import { useClinic } from '../lib/useClinic'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { Checkbox } from '../ui/Choice'
import { DataTable } from '../ui/DataTable'
import { EmptyState, Kpi, Skeleton, useToast } from '../ui/Feedback'
import { Field, Input, MoneyInput, Select, EnterSubmits } from '../ui/Field'
import { ConfirmDialog, MenuButton, Modal, Tabs } from '../ui/Overlay'
import { PdfViewer } from '../ui/PdfViewer'
import { cn, formatMoney } from '../ui/cn'
import { Page } from './Layout'

const TYPE: Record<CashRow['type'], { label: string; tone: 'accent' | 'info' | 'warning' }> = {
  receita: { label: 'Receita', tone: 'accent' }, receita_sem_vinculo: { label: 'Receita sem vínculo', tone: 'info' }, despesa: { label: 'Despesa', tone: 'warning' },
}
const STATUS: Record<CashStatus, { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }> = {
  pago: { label: 'Pago', tone: 'success' }, parcial: { label: 'Pago em parte', tone: 'info' }, a_vencer: { label: 'A vencer', tone: 'neutral' }, atrasado: { label: 'Em atraso', tone: 'danger' },
}
const fmtYmd = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const monthBounds = (anyDay: Ymd): [Ymd, Ymd] => {
  const first = anyDay.slice(0, 8) + '01'
  return [first, addDays(addDays(first, 32).slice(0, 8) + '01', -1)]
}

/** S20/S24 — Financeiro: fluxo de caixa do mês e recibos. */
export function FinancePage() {
  const { tab = 'fluxo' } = useParams()
  const nav = useNavigate()
  const { can } = useAuth()
  return (
    <Page title="Financeiro">
      <Tabs label="Financeiro" value={tab} onValueChange={(v) => nav(`/financeiro/${v}`, { replace: true })}
        tabs={[
          { value: 'fluxo', label: 'Fluxo de caixa', content: <CashflowTab /> },
          ...(can('fin.debits_view') ? [{ value: 'recibos', label: 'Recibos', content: <ReceiptsTab /> }] : []),
        ]} />
    </Page>
  )
}

function CashflowTab() {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const [month, setMonth] = useState<Ymd | null>(null)
  useEffect(() => { if (!month) setMonth(todayIn(tz)) }, [tz, month])
  const [from, to] = month ? monthBounds(month) : ['', '']
  const [type, setType] = useState<'all' | CashRow['type']>('all')
  const flow = useQuery({ queryKey: ['cashflow', from, to], queryFn: () => get<Cashflow>(`/cashflow?from=${from}&to=${to}`), enabled: !!from })
  const [modal, setModal] = useState<{ kind: 'expense'; row?: CashRow } | { kind: 'income' } | { kind: 'payExpense'; row: CashRow } | { kind: 'receive'; row: CashRow } | null>(null)
  const [removing, setRemoving] = useState<CashRow | null>(null)
  const [receipt, setReceipt] = useState<ReceiptT | null>(null)
  const refresh = () => MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const unpay = useMutation({ mutationFn: (r: CashRow) => post(`/expenses/${r.id}/unpay`), onSuccess: () => { refresh(); toast('success', 'Pagamento desfeito.') } })
  const remove = useMutation({
    mutationFn: (r: CashRow) => del(`/expenses/${r.id}`),
    onSuccess: () => { setRemoving(null); refresh(); toast('success', 'Despesa excluída.') },
    onError: (e) => { setRemoving(null); toast('danger', e instanceof ApiError ? e.message : 'Não foi possível excluir.') },
  })

  if (!month) return <Skeleton className="h-64 w-full" />
  const t = flow.data?.totals
  const rows = (flow.data?.rows ?? []).filter((r) => type === 'all' || r.type === type)
  const exportCsv = () => {
    const head = ['Vencimento', 'Tipo', 'Descrição', 'Paciente', 'Categoria', 'Situação', 'Valor', 'Pago', 'Pago em', 'Conta', 'Forma']
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const money = (c: number) => (c / 100).toFixed(2).replace('.', ',')
    const lines = rows.map((r) => [fmtYmd(r.dueDate), TYPE[r.type].label, r.description, r.patientName ?? '', r.categoryName ?? '', STATUS[r.status].label,
      (r.type === 'despesa' ? '-' : '') + money(r.amountCents), money(r.paidCents), r.paidAt ? dateTimeIn(r.paidAt, tz) : '', r.accountName ?? '', methodLabel(r.method)].map(esc).join(';'))
    // BOM + ";" = o Excel em português abre com acentos e colunas certas
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fluxo-de-caixa-${from.slice(0, 7)}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Mês anterior" variant="secondary" onClick={() => setMonth(addDays(from, -1))}><ChevronLeft className="size-4" /></IconButton>
        <p className="min-w-40 text-center text-sm font-semibold first-letter:uppercase" aria-live="polite">{longDate(from, { month: 'long', year: 'numeric' })}</p>
        <IconButton label="Próximo mês" variant="secondary" onClick={() => setMonth(addDays(to, 1))}><ChevronRight className="size-4" /></IconButton>
        <Button variant="ghost" size="sm" onClick={() => setMonth(todayIn(tz))}>Mês atual</Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {can('fin.debits_create') && <Button variant="secondary" icon={<ArrowDownCircle className="size-4" />} onClick={() => setModal({ kind: 'income' })}>Receita sem vínculo</Button>}
          {can('fin.expenses_edit') && <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'expense' })}>Despesa</Button>}
        </div>
      </div>

      {flow.isLoading || !t ? <Skeleton className="h-24 w-full" /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
          <Kpi label="Recebido no mês" value={formatMoney(t.receivedCents)} hint="Pela data em que o dinheiro entrou (inclui parcelas adiantadas)" />
          <Kpi label="A receber no mês" value={formatMoney(t.toReceiveCents)} hint={t.overdueReceivableCents ? `${formatMoney(t.overdueReceivableCents)} em atraso (todos os meses)` : undefined} />
          {can('fin.expenses_view') && <Kpi label="Pago no mês" value={formatMoney(t.paidCents)} hint="Pela data do pagamento" />}
          {can('fin.expenses_view') && <Kpi label="A pagar no mês" value={formatMoney(t.toPayCents)} hint={t.overduePayableCents ? `${formatMoney(t.overduePayableCents)} em atraso (todos os meses)` : undefined} />}
          {can('fin.expenses_view') && <Kpi label="Saldo do mês (recebido − pago)" value={formatMoney(t.balanceCents)} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Tipo de lançamento" className="flex flex-wrap gap-1">
          {(['all', 'receita', 'receita_sem_vinculo', ...(can('fin.expenses_view') ? ['despesa'] as const : [])] as const).map((k) => (
            <button key={k} role="radio" aria-checked={type === k} onClick={() => setType(k)}
              className={cn('h-8 rounded-pill border px-3 text-sm', type === k ? 'border-accent bg-accent-soft text-accent-text' : 'border-border-strong hover:bg-surface')}>
              {k === 'all' ? 'Todos' : { receita: 'Receitas', receita_sem_vinculo: 'Sem vínculo', despesa: 'Despesas' }[k]}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" icon={<FileSpreadsheet className="size-4" />} disabled={!rows.length} onClick={exportCsv}>Exportar planilha</Button>
      </div>

      {flow.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Não foi possível carregar o fluxo de caixa.</p>}
      {flow.isSuccess && (
        <DataTable
          caption="Lançamentos do mês"
          rows={rows}
          rowKey={(r) => r.type + r.id}
          columns={[
            { key: 'due', header: 'Vencimento', value: (r) => r.dueDate, render: (r) => <span className="tabular-nums">{fmtYmd(r.dueDate)}</span> },
            {
              key: 'desc', header: 'Descrição', value: (r) => `${r.description} ${r.patientName ?? ''}`,
              render: (r) => (
                <span className="flex flex-col">
                  <span className="max-w-[34ch] truncate" title={r.description}>{r.description}</span>
                  {r.patientId && <Link to={`/pacientes/${r.patientId}/debitos`} className="text-xs text-accent-text hover:underline">{r.patientName}</Link>}
                </span>
              ),
            },
            { key: 'type', header: 'Tipo', value: (r) => TYPE[r.type].label, render: (r) => <Badge tone={TYPE[r.type].tone}>{TYPE[r.type].label}</Badge> },
            { key: 'cat', header: 'Categoria', value: (r) => r.categoryName ?? '', render: (r) => r.categoryName ?? <span className="text-text-muted">—</span> },
            { key: 'status', header: 'Situação', value: (r) => STATUS[r.status].label, render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
            {
              key: 'value', header: 'Valor', align: 'right', value: (r) => (r.type === 'despesa' ? -r.amountCents : r.amountCents),
              render: (r) => <span className={cn('whitespace-nowrap font-medium', r.type === 'despesa' ? 'text-danger' : 'text-success')}>{r.type === 'despesa' ? '− ' : ''}{formatMoney(r.amountCents)}{r.status === 'parcial' && <span className="block text-xs font-normal text-text-muted">pago {formatMoney(r.paidCents)}</span>}</span>,
            },
            { key: 'paid', header: 'Pago em', value: (r) => r.paidAt ?? '', render: (r) => (r.paidAt ? <span className="text-xs">{dateTimeIn(r.paidAt, tz)}<span className="block text-text-muted">{[methodLabel(r.method), r.accountName].filter(Boolean).join(' · ')}</span></span> : <span className="text-text-muted">—</span>) },
            {
              key: 'act', header: 'Ações', filterable: false, align: 'right', value: () => '',
              render: (r) => <RowActions row={r} onReceive={() => setModal({ kind: 'receive', row: r })} onPay={() => setModal({ kind: 'payExpense', row: r })}
                onEdit={() => setModal({ kind: 'expense', row: r })} onUnpay={() => unpay.mutate(r)} onDelete={() => setRemoving(r)} />,
            },
          ]}
          empty={<EmptyState icon={<Wallet className="size-5" />} title="Nada neste mês" body="Receitas aparecem quando orçamentos são aprovados. Lance despesas e receitas sem vínculo pelos botões acima." />}
        />
      )}

      {modal?.kind === 'expense' && <ExpenseModal row={modal.row} onClose={() => setModal(null)} />}
      {modal?.kind === 'income' && <IncomeModal onClose={() => setModal(null)} />}
      {modal?.kind === 'payExpense' && <PayExpenseModal row={modal.row} tz={tz} onClose={() => setModal(null)} />}
      {modal?.kind === 'receive' && <ReceiveModal debit={modal.row} needsPayer={modal.row.type === 'receita_sem_vinculo'} onClose={() => setModal(null)} onReceipt={setReceipt} />}
      {receipt && <PdfViewer path={`/receipts/${receipt.id}/pdf`} title={`Recibo nº ${receipt.number}`} fileName={`recibo-${receipt.number}.pdf`} onClose={() => setReceipt(null)} />}
      {removing && (
        <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title="Excluir esta despesa?"
          body={<><strong>{removing.description}</strong> ({formatMoney(removing.amountCents)}) sai do fluxo de caixa. Fica registrado no histórico quem excluiu.</>}
          confirmLabel="Excluir despesa" loading={remove.isPending} onConfirm={() => remove.mutate(removing)} />
      )}
    </div>
  )
}

function RowActions({ row, onReceive, onPay, onEdit, onUnpay, onDelete }: { row: CashRow; onReceive: () => void; onPay: () => void; onEdit: () => void; onUnpay: () => void; onDelete: () => void }) {
  const { can } = useAuth()
  if (row.type !== 'despesa') {
    return row.status !== 'pago' && can('fin.pay')
      ? <Button size="sm" variant="secondary" icon={<Receipt className="size-4" />} onClick={onReceive}>Receber</Button>
      : null
  }
  if (!can('fin.expenses_edit')) return null
  return (
    <div className="flex items-center justify-end gap-1">
      {row.status !== 'pago' && <Button size="sm" variant="secondary" icon={<ArrowUpCircle className="size-4" />} onClick={onPay}>Pagar</Button>}
      <MenuButton
        trigger={<IconButton size="sm" label={`Mais ações: ${row.description}`}><MoreHorizontal className="size-4" /></IconButton>}
        items={[
          { label: 'Editar', onSelect: onEdit },
          ...(row.status === 'pago' ? [{ label: 'Desfazer pagamento', onSelect: onUnpay, icon: <Undo2 className="size-4" /> }] : [{ label: 'Excluir', onSelect: onDelete, danger: true }]),
        ]}
      />
    </div>
  )
}

function useCategories(kind: 'expense' | 'income') {
  return useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories'), select: (all) => all.filter((c) => c.kind === kind) })
}

function ExpenseModal({ row, onClose }: { row?: CashRow; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const cats = useCategories('expense')
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => get<Account[]>('/financial-accounts') })
  const [f, setF] = useState({ description: row?.description ?? '', amountCents: row?.amountCents ?? 0, dueDate: row?.dueDate ?? todayIn(tz), categoryId: row?.categoryId ?? '' })
  const [paid, setPaid] = useState(false)
  const [acc, setAcc] = useState('')
  const [method, setMethod] = useState('pix')
  const invalid = !f.description.trim() || f.amountCents <= 0
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, categoryId: f.categoryId || undefined }
      return row ? patch(`/expenses/${row.id}`, body) : post('/expenses', { ...body, paid, financialAccountId: paid ? acc || accounts.data?.[0]?.id : undefined, method: paid ? method : undefined })
    },
    onSuccess: () => { MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('success', row ? 'Despesa atualizada.' : 'Despesa lançada.'); onClose() },
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={row ? 'Editar despesa' : 'Nova despesa'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
        <EnterSubmits />
        {save.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{save.error instanceof ApiError ? save.error.message : 'Não foi possível salvar.'}</p>}
        <Field label="Descrição" required className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: Aluguel, resina, laboratório" data-autofocus /></Field>
        <Field label="Valor" required><MoneyInput value={f.amountCents} onValueChange={(v) => setF({ ...f, amountCents: v })} /></Field>
        <Field label="Vencimento" required><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Categoria" className="sm:col-span-2">
          <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">Sem categoria</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!row && (
          <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:col-span-2">
            <Checkbox label="Já foi paga" checked={paid} onCheckedChange={setPaid} />
            {paid && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Conta"><Select value={acc || accounts.data?.[0]?.id || ''} onChange={(e) => setAcc(e.target.value)}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
                <Field label="Forma"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}

function PayExpenseModal({ row, tz, onClose }: { row: CashRow; tz: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAuth()
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => get<Account[]>('/financial-accounts') })
  const [acc, setAcc] = useState('')
  const [method, setMethod] = useState('pix')
  const [date, setDate] = useState(todayIn(tz))
  const today = todayIn(tz)
  const pay = useMutation({
    mutationFn: () => post(`/expenses/${row.id}/pay`, {
      financialAccountId: acc || accounts.data?.[0]?.id, method,
      paidAt: date === today ? undefined : new Date(`${date}T12:00:00`).toISOString(),
    }),
    onSuccess: () => { MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('success', `Despesa paga: ${formatMoney(row.amountCents)}.`); onClose() },
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Pagar despesa" description={`${row.description} · ${formatMoney(row.amountCents)}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={pay.isPending} disabled={date > today} onClick={() => pay.mutate()}>Confirmar pagamento</Button></>}>
      <div className="flex flex-col gap-4">
        {pay.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{pay.error instanceof ApiError ? pay.error.message : 'Não foi possível pagar.'}</p>}
        <Field label="Conta de onde saiu"><Select value={acc || accounts.data?.[0]?.id || ''} onChange={(e) => setAcc(e.target.value)}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Forma"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Data do pagamento" hint={!can('fin.pay_backdated') ? 'Datas anteriores a ontem exigem permissão.' : undefined} error={date > today ? 'Não pode ser no futuro.' : undefined}>
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function IncomeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const cats = useCategories('income')
  const [f, setF] = useState({ description: '', amountCents: 0, dueDate: todayIn(tz), categoryId: '' })
  const invalid = !f.description.trim() || f.amountCents <= 0
  const save = useMutation({
    mutationFn: () => post('/income', { ...f, categoryId: f.categoryId || undefined }),
    onSuccess: () => { MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('success', 'Receita lançada. Use "Receber" na lista quando o dinheiro entrar.'); onClose() },
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Receita sem vínculo" description="Entrada que não é de paciente: sublocação de sala, venda de produto, reembolso…"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Lançar receita</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
        <EnterSubmits />
        {save.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{save.error instanceof ApiError ? save.error.message : 'Não foi possível lançar.'}</p>}
        <Field label="Descrição" required className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-autofocus /></Field>
        <Field label="Valor" required><MoneyInput value={f.amountCents} onValueChange={(v) => setF({ ...f, amountCents: v })} /></Field>
        <Field label="Vencimento" required><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Categoria" className="sm:col-span-2">
          <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">Sem categoria</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </form>
    </Modal>
  )
}

/** S24 — Recibos emitidos (numeração sequencial; cancelado mantém o número). */
function ReceiptsTab() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const list = useQuery({ queryKey: ['receipts'], queryFn: () => get<ReceiptT[]>('/receipts') })
  const [viewing, setViewing] = useState<ReceiptT | null>(null)
  const [canceling, setCanceling] = useState<ReceiptT | null>(null)
  const cancel = useMutation({
    mutationFn: (r: ReceiptT) => post<ReceiptT>(`/receipts/${r.id}/cancel`),
    onSuccess: (r) => { setCanceling(null); MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('success', `Recibo nº ${r.number} cancelado.`) },
  })
  if (list.isLoading) return <Skeleton className="h-40 w-full" />
  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption="Recibos emitidos"
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        columns={[
          { key: 'n', header: 'Nº', value: (r) => r.number, render: (r) => <span className="font-mono tabular-nums">{String(r.number).padStart(6, '0')}</span> },
          { key: 'date', header: 'Emitido em', value: (r) => r.issuedAt, render: (r) => <span className="text-xs">{dateTimeIn(r.issuedAt, tz)}</span> },
          { key: 'payer', header: 'Em nome de', value: (r) => r.payerName, render: (r) => <span className="flex flex-col"><span>{r.payerName}</span>{r.patientName && r.patientName !== r.payerName && <span className="text-xs text-text-muted">paciente: {r.patientName}</span>}</span> },
          { key: 'total', header: 'Valor', align: 'right', value: (r) => r.totalCents, render: (r) => <span className={cn(r.canceledAt && 'text-text-muted line-through')}>{formatMoney(r.totalCents)}</span> },
          { key: 'st', header: 'Situação', value: (r) => (r.canceledAt ? 'Cancelado' : 'Válido'), render: (r) => <Badge tone={r.canceledAt ? 'danger' : 'success'}>{r.canceledAt ? 'Cancelado' : 'Válido'}</Badge> },
          {
            key: 'act', header: 'Ações', filterable: false, align: 'right', value: () => '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="secondary" icon={<FileDown className="size-4" />} onClick={() => setViewing(r)}>PDF</Button>
                {!r.canceledAt && can('fin.debits_delete') && <Button size="sm" variant="ghost" onClick={() => setCanceling(r)}>Cancelar</Button>}
              </div>
            ),
          },
        ]}
        empty={<EmptyState icon={<Receipt className="size-5" />} title="Nenhum recibo emitido" body="Emita o recibo ao registrar um recebimento, ou depois, na aba Débitos do paciente." />}
      />
      {viewing && <PdfViewer path={`/receipts/${viewing.id}/pdf`} title={`Recibo nº ${viewing.number}`} fileName={`recibo-${viewing.number}.pdf`} onClose={() => setViewing(null)} />}
      {canceling && (
        <ConfirmDialog open onOpenChange={(v) => !v && setCanceling(null)} title={`Cancelar o recibo nº ${canceling.number}?`}
          body="O número não volta a ser usado e o PDF passa a mostrar CANCELADO. Os pagamentos continuam registrados e podem receber um recibo novo."
          confirmLabel="Cancelar recibo" loading={cancel.isPending} onConfirm={() => cancel.mutate(canceling)} />
      )}
    </div>
  )
}

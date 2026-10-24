import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileDown, Plus, Receipt, Undo2, Wallet, X } from 'lucide-react'
import { useState } from 'react'
import { ApiError, get, post } from '../../api/client'
import type { Category, Debit, Guardian, Payment, ReceiptT } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { MONEY_KEYS, ReceiveModal, methodLabel } from '../../domain/ReceiveModal'
import { Badge } from '../../ui/Badge'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { EnterSubmits, Field, Input, MoneyInput, Select } from '../../ui/Field'
import { ConfirmDialog, Modal } from '../../ui/Overlay'
import { PdfViewer } from '../../ui/PdfViewer'
import { formatMoney } from '../../ui/cn'

const fmtDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00' : iso).toLocaleDateString('pt-BR')
const today = () => new Date().toISOString().slice(0, 10)

/** S17 — Débitos do paciente: novo (parcelado), receber total/parcial, cancelar, recibos. */
export function DebitsTab({ patientId, debits, loading, guardian }: { patientId: string; debits?: Debit[]; loading: boolean; guardian?: Guardian | null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAuth()
  const canPay = can('fin.pay')
  const canCancel = can('fin.debits_delete')
  const [paying, setPaying] = useState<Debit | null>(null)
  const [creating, setCreating] = useState(false)
  const [cancelDebit, setCancelDebit] = useState<Debit | null>(null)
  const [cancelPay, setCancelPay] = useState<Payment | null>(null)
  const [receipt, setReceipt] = useState<{ id: string; number: number } | null>(null)
  const payments = useQuery({ queryKey: ['payments', patientId], queryFn: () => get<Payment[]>(`/patients/${patientId}/payments`) })
  const refreshMoney = () => MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const issue = useMutation({
    mutationFn: (ids: string[]) => post<ReceiptT>('/receipts', { paymentIds: ids }),
    onSuccess: (r) => { ['payments', 'receipts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('success', `Recibo nº ${r.number} emitido.`); setReceipt(r) },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível emitir o recibo.'),
  })
  const cancelD = useMutation({
    mutationFn: (d: Debit) => post<Debit>(`/debits/${d.id}/cancel`, {}),
    onSuccess: (d) => { setCancelDebit(null); refreshMoney(); toast('success', `Débito “${d.description}” cancelado.`) },
    onError: (e) => { setCancelDebit(null); toast('danger', e instanceof ApiError ? e.message : 'Não foi possível cancelar.') },
  })
  const cancelP = useMutation({
    mutationFn: (p: Payment) => post<Debit>(`/payments/${p.id}/cancel`, {}),
    onSuccess: () => { setCancelPay(null); refreshMoney(); toast('success', 'Recebimento cancelado: o valor voltou a ficar em aberto.') },
    onError: (e) => { setCancelPay(null); toast('danger', e instanceof ApiError ? e.message : 'Não foi possível cancelar.') },
  })
  const withoutReceipt = payments.data?.filter((p) => !p.receiptId) ?? []
  if (loading) return <Skeleton className="h-32 w-full" />
  const open = (debits ?? []).reduce((s, d) => s + (d.status === 'paid' ? 0 : d.amountCents - d.paidCents), 0)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">Em aberto: <strong className="tabular-nums">{formatMoney(open)}</strong></p>
        {can('fin.debits_create') && <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo débito</Button>}
      </div>
      {!debits?.length ? (
        <EmptyState icon={<Wallet className="size-5" />} title="Nenhum débito" body="Os débitos são lançados quando um orçamento é aprovado — ou lance um avulso em Novo débito." />
      ) : (
        <div className="relative overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Débitos do paciente</caption>
            <thead className="bg-surface text-xs text-text-muted">
              <tr><th scope="col" className="px-3 py-2 text-left">Descrição</th><th scope="col" className="px-3 py-2 text-left">Vencimento</th><th scope="col" className="px-3 py-2 text-right">Valor</th><th scope="col" className="px-3 py-2 text-right">Pago</th><th scope="col" className="px-3 py-2 text-left">Situação</th><th scope="col" className="px-3 py-2 text-right">Ações</th></tr>
            </thead>
            <tbody>
              {debits.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2">{d.description}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtDate(d.dueDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(d.amountCents)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(d.paidCents)}</td>
                  <td className="px-3 py-2">
                    {d.status === 'paid' ? <Badge tone="success">Pago</Badge> : d.overdue ? <Badge tone="danger">Em atraso</Badge> : d.status === 'partial' ? <Badge tone="info">Pago em parte</Badge> : <Badge tone="warning">A receber</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {canPay && d.status !== 'paid' && <Button size="sm" variant="secondary" icon={<Receipt className="size-4" />} onClick={() => setPaying(d)}>Receber</Button>}
                      {canCancel && d.paidCents === 0 && <IconButton size="sm" label={`Cancelar débito ${d.description}`} onClick={() => setCancelDebit(d)}><X className="size-4" /></IconButton>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payments.data && payments.data.length > 0 && (
        <section aria-labelledby="pays">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id="pays" className="text-sm font-semibold">Recebimentos</h3>
            {canPay && withoutReceipt.length > 1 && (
              <Button size="sm" variant="secondary" loading={issue.isPending} onClick={() => issue.mutate(withoutReceipt.map((p) => p.id))}>
                Um recibo para os {withoutReceipt.length} sem recibo
              </Button>
            )}
          </div>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {payments.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">{new Date(p.paidAt).toLocaleDateString('pt-BR')} · {methodLabel(p.method)} · {p.accountName}<span className="block truncate text-xs text-text-muted">{p.description}</span></span>
                <span className="font-medium tabular-nums text-success">{formatMoney(p.amountCents)}</span>
                {p.receiptId
                  ? <Button size="sm" variant="ghost" icon={<FileDown className="size-4" />} onClick={() => setReceipt({ id: p.receiptId!, number: p.receiptNumber! })}>Recibo nº {p.receiptNumber}</Button>
                  : canPay && <Button size="sm" variant="secondary" loading={issue.isPending && issue.variables?.length === 1 && issue.variables[0] === p.id} onClick={() => issue.mutate([p.id])}>Emitir recibo</Button>}
                {canCancel && !p.receiptId && <IconButton size="sm" label={`Cancelar recebimento de ${formatMoney(p.amountCents)}`} onClick={() => setCancelPay(p)}><Undo2 className="size-4" /></IconButton>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {creating && <NewDebitModal patientId={patientId} onClose={() => setCreating(false)} onDone={refreshMoney} />}
      {paying && <ReceiveModal debit={paying} guardian={guardian} onClose={() => setPaying(null)} onReceipt={setReceipt} />}
      {receipt && <PdfViewer path={`/receipts/${receipt.id}/pdf`} title={`Recibo nº ${receipt.number}`} fileName={`recibo-${receipt.number}.pdf`} onClose={() => setReceipt(null)} />}
      {cancelDebit && (
        <ConfirmDialog open onOpenChange={(v) => !v && setCancelDebit(null)} title="Cancelar este débito?"
          body={<><strong>{cancelDebit.description}</strong> ({formatMoney(cancelDebit.amountCents)}) sai do saldo do paciente e do fluxo de caixa. O registro fica no histórico.</>}
          confirmLabel="Cancelar débito" loading={cancelD.isPending} onConfirm={() => cancelD.mutate(cancelDebit)} />
      )}
      {cancelPay && (
        <ConfirmDialog open onOpenChange={(v) => !v && setCancelPay(null)} title="Cancelar este recebimento?"
          body={<>O valor de <strong>{formatMoney(cancelPay.amountCents)}</strong> ({methodLabel(cancelPay.method)}, {new Date(cancelPay.paidAt).toLocaleDateString('pt-BR')}) volta a ficar em aberto em “{cancelPay.description}”. Use quando o recebimento foi lançado errado.</>}
          confirmLabel="Cancelar recebimento" loading={cancelP.isPending} onConfirm={() => cancelP.mutate(cancelPay)} />
      )}
    </div>
  )
}

/** Débito avulso, com parcelas mensais (o resto da divisão vai na 1ª: a soma bate com o total). */
function NewDebitModal({ patientId, onClose, onDone }: { patientId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories') })
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState(0)
  const [installments, setInstallments] = useState(1)
  const [first, setFirst] = useState(today())
  const [categoryId, setCategoryId] = useState('')
  const [touched, setTouched] = useState(false)
  const base = Math.floor(amount / installments)
  const rest = amount - base * installments
  const invalid = !description.trim() || amount <= 0 || amount < installments || !first
  const save = useMutation({
    mutationFn: () => post<Debit[]>(`/patients/${patientId}/debits`, { description, amountCents: amount, installments, firstDueDate: first, categoryId: categoryId || undefined }),
    onSuccess: (r) => { onDone(); toast('success', r.length > 1 ? `${r.length} parcelas lançadas: ${formatMoney(amount)}.` : `Débito lançado: ${formatMoney(amount)}.`); onClose() },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível lançar.'),
  })
  const submit = () => { setTouched(true); if (!invalid && !save.isPending) save.mutate() }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Novo débito" description="Cobrança fora de orçamento: manutenção, urgência, material…"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={submit}>Lançar débito</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        <Field label="Descrição" required className="sm:col-span-2" error={touched && !description.trim() ? 'Descreva a cobrança.' : undefined}>
          <Input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Manutenção do aparelho" data-autofocus />
        </Field>
        <Field label="Valor total" required error={touched && amount <= 0 ? 'Informe o valor.' : amount > 0 && amount < installments ? 'Valor pequeno demais para tantas parcelas.' : undefined}>
          <MoneyInput value={amount} onValueChange={setAmount} />
        </Field>
        <Field label="Parcelas">
          <Select value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x</option>)}
          </Select>
        </Field>
        <Field label={installments > 1 ? '1º vencimento' : 'Vencimento'} required><Input type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Categoria">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sem categoria</option>
            {cats.data?.filter((c) => c.kind === 'income').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {installments > 1 && amount >= installments && (
          <p className="text-sm text-text-muted sm:col-span-2">{installments}x de <strong className="text-text tabular-nums">{formatMoney(base)}</strong>{rest ? ` (1ª parcela ${formatMoney(base + rest)})` : ''}, todo mês a partir do 1º vencimento.</p>
        )}
      </form>
    </Modal>
  )
}

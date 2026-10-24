import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ClipboardList, FileDown, Plus, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, post } from '../../api/client'
import type { Budget } from '../../api/types'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Choice'
import { Card, EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { EnterSubmits, Field, Input, Textarea } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { PdfViewer } from '../../ui/PdfViewer'
import { cn, formatMoney, plural } from '../../ui/cn'
import { toothText } from './TreatmentsTab'

const fmtDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00' : iso).toLocaleDateString('pt-BR')
const today = () => new Date().toISOString().slice(0, 10)

const BUDGET_STATUS: Record<Budget['status'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  open: { label: 'Em aberto', tone: 'warning' },
  approved: { label: 'Aprovado', tone: 'success' },
  partial: { label: 'Aprovado em parte', tone: 'success' },
  rejected: { label: 'Reprovado', tone: 'danger' },
}

/** S13 — Orçamentos do paciente; aprovar (tudo ou parte) gera tratamentos e débitos. */
export function BudgetsTab({ patientId, budgets, loading }: { patientId: string; budgets?: Budget[]; loading: boolean }) {
  const nav = useNavigate()
  const [approving, setApproving] = useState<Budget | null>(null)
  const [rejecting, setRejecting] = useState<Budget | null>(null)
  const [pdf, setPdf] = useState<Budget | null>(null)
  if (loading) return <Skeleton className="h-32 w-full" />
  return (
    <div className="flex flex-col gap-3">
      <div><Button icon={<Plus className="size-4" />} onClick={() => nav(`/pacientes/${patientId}/orcamentos/novo`)}>Novo orçamento</Button></div>
      {!budgets?.length ? (
        <EmptyState icon={<ClipboardList className="size-5" />} title="Nenhum orçamento ainda" body="Monte o primeiro orçamento marcando os dentes no odontograma." />
      ) : (
        budgets.map((b) => (
          <Card key={b.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Orçamento nº {b.number} <Badge tone={BUDGET_STATUS[b.status].tone} className="ml-2">{BUDGET_STATUS[b.status].label}</Badge></p>
                <p className="text-xs text-text-muted">{fmtDate(b.createdAt)} · {b.professionalName} · {b.installments}x</p>
              </div>
              <div className="text-right">
                {b.discountCents > 0 && <p className="text-xs text-text-muted line-through tabular-nums">{formatMoney(b.status === 'partial' ? b.totalCents + b.discountCents : b.subtotalCents)}</p>}
                <p className="text-lg font-bold tabular-nums">{formatMoney(b.totalCents)}</p>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-border text-sm">
              {b.items.map((i) => (
                <li key={i.id} className={cn('flex items-center justify-between gap-3 py-1.5', i.approved === false && 'text-text-muted')}>
                  <span className="min-w-0"><span className="mr-2 inline-block min-w-16 font-mono text-xs text-text-muted">{toothText(i)}</span>
                    <span className={cn(i.approved === false && 'line-through')}>{i.procedureName}</span>
                    {i.approved === false && <span className="ml-2 text-xs">(não aprovado)</span>}
                  </span>
                  <span className="tabular-nums">{formatMoney(i.priceCents)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {b.status === 'open' && <Button size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => setApproving(b)}>Aprovar</Button>}
              {b.status === 'open' && <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setRejecting(b)}>Reprovar</Button>}
              <Button size="sm" variant="secondary" icon={<FileDown className="size-4" />} onClick={() => setPdf(b)}>PDF para o paciente</Button>
            </div>
          </Card>
        ))
      )}
      {pdf && <PdfViewer path={`/budgets/${pdf.id}/pdf`} title={`Orçamento nº ${pdf.number}`} fileName={`orcamento-${pdf.number}.pdf`} onClose={() => setPdf(null)} />}
      {approving && <ApproveModal patientId={patientId} budget={approving} onClose={() => setApproving(null)} />}
      {rejecting && <RejectModal patientId={patientId} budget={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  )
}

const refreshAll = (qc: ReturnType<typeof useQueryClient>, patientId: string) => {
  ;['budgets', 'treatments', 'debits', 'patient'].forEach((k) => qc.invalidateQueries({ queryKey: [k, patientId] }))
  ;['cashflow', 'patients'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
}

/**
 * Aprovar tudo ou só os itens que o paciente aceitou. O desconto continua valendo sobre o que foi
 * aprovado; as parcelas são recalculadas sobre o novo total.
 */
function ApproveModal({ patientId, budget, onClose }: { patientId: string; budget: Budget; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [ids, setIds] = useState(() => budget.items.map((i) => i.id))
  const [first, setFirst] = useState(budget.firstDueDate ?? today())
  const chosen = budget.items.filter((i) => ids.includes(i.id))
  const total = Math.max(0, chosen.reduce((s, i) => s + i.priceCents, 0) - budget.discountCents)
  const all = ids.length === budget.items.length
  const n = budget.installments
  const base = Math.floor(total / n)
  const approve = useMutation({
    mutationFn: () => post<Budget>(`/budgets/${budget.id}/approve`, { itemIds: all ? [] : ids, firstDueDate: first }),
    onSuccess: (b) => {
      refreshAll(qc, patientId)
      toast('success', `Orçamento nº ${b.number} ${all ? 'aprovado' : 'aprovado em parte'}: ${plural(chosen.length, 'tratamento', 'tratamentos')}${total > 0 ? ` e ${plural(n, 'parcela lançada', 'parcelas lançadas')}` : ''}.`)
      onClose()
    },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível aprovar.'),
  })
  const submit = () => { if (ids.length && !approve.isPending) approve.mutate() }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Aprovar o orçamento nº ${budget.number}`} description="Desmarque o que o paciente não aceitou."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!ids.length} loading={approve.isPending} onClick={submit}>{all ? 'Aprovar tudo' : `Aprovar ${plural(ids.length, 'item', 'itens')}`}</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Itens</legend>
          <Checkbox label="Todos" checked={all} onCheckedChange={(v) => setIds(v ? budget.items.map((i) => i.id) : [])} />
          {budget.items.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 pl-6 text-sm">
              <Checkbox label={`${toothText(i)} · ${i.procedureName}`} checked={ids.includes(i.id)} onCheckedChange={(v) => setIds(v ? [...ids, i.id] : ids.filter((x) => x !== i.id))} />
              <span className="shrink-0 tabular-nums">{formatMoney(i.priceCents)}</span>
            </div>
          ))}
        </fieldset>
        {!ids.length && <p role="alert" className="text-sm text-danger">Marque ao menos um item, ou use Reprovar.</p>}
        <Field label="1º vencimento"><Input type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <dl className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
          {budget.discountCents > 0 && <div className="flex justify-between text-text-muted"><dt>Desconto</dt><dd className="tabular-nums">– {formatMoney(budget.discountCents)}</dd></div>}
          <div className="flex justify-between text-base font-bold"><dt>Total aprovado</dt><dd className="tabular-nums">{formatMoney(total)}</dd></div>
          {n > 1 && total > 0 && <p className="text-xs text-text-muted">{n}x de {formatMoney(base)}{total % n ? ` (1ª parcela ${formatMoney(base + (total - base * n))})` : ''}</p>}
          <p className="text-xs text-text-muted">Lança {plural(chosen.length, 'tratamento', 'tratamentos')} na ficha{total > 0 ? ` e ${plural(n, 'parcela', 'parcelas')} nos débitos` : ''}.</p>
        </dl>
      </form>
    </Modal>
  )
}

function RejectModal({ patientId, budget, onClose }: { patientId: string; budget: Budget; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const reject = useMutation({
    mutationFn: () => post<Budget>(`/budgets/${budget.id}/reject`, { reason }),
    onSuccess: (b) => { refreshAll(qc, patientId); toast('success', `Orçamento nº ${b.number} reprovado.`); onClose() },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível reprovar.'),
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Reprovar o orçamento nº ${budget.number}?`}
      description="Nada é lançado na ficha nem nos débitos. O orçamento fica no histórico como reprovado."
      footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}>Reprovar orçamento</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); reject.mutate() }}>
        <Field label="Motivo (opcional)" hint="Ajuda a entender por que os orçamentos não fecham.">
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: achou caro, vai pensar, fez em outro lugar" data-autofocus />
        </Field>
      </form>
    </Modal>
  )
}

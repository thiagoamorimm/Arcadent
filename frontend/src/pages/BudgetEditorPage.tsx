import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, History, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, get, post } from '../api/client'
import type { Budget, Patient, Procedure, Professional } from '../api/types'
import { Odontogram, type Face, type Selection } from '../domain/Odontogram'
import { Button, IconButton } from '../ui/Button'
import { Card, EmptyState, useToast } from '../ui/Feedback'
import { Field, Input, MoneyInput, Select, Textarea } from '../ui/Field'
import { formatMoney } from '../ui/cn'
import { Page } from './Layout'

type Draft = { key: string; procedure: Procedure; tooth: number | null; faces: Face[]; priceCents: number }
const today = () => new Date().toISOString().slice(0, 10)

/**
 * Rascunho do orçamento na sessão do navegador (por paciente): recarregar a página ou sair pelo menu
 * no meio da montagem não perde os itens. Sai ao salvar ou ao descartar.
 */
type Saved = { items: Draft[]; professionalId: string; discount: number; installments: number; firstDue: string; notes: string }
const draftKey = (patientId: string) => `clinica.orcamento.${patientId}`
function readDraft(patientId: string): Saved | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(draftKey(patientId)) ?? 'null') as Saved | null
    return d && Array.isArray(d.items) && d.items.length ? d : null
  } catch {
    return null
  }
}

/** S14 — Editor de orçamento: escolhe dentes/faces no odontograma, procedimento, e adiciona. */
export function BudgetEditorPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const patient = useQuery({ queryKey: ['patient', id], queryFn: () => get<Patient>(`/patients/${id}`) })
  const pros = useQuery({ queryKey: ['professionals'], queryFn: () => get<Professional[]>('/professionals') })
  const procs = useQuery({ queryKey: ['procedures'], queryFn: () => get<Procedure[]>('/procedures') })

  const [restored] = useState(() => readDraft(id))
  const [selection, setSelection] = useState<Selection>({})
  const [procId, setProcId] = useState('')
  const [items, setItems] = useState<Draft[]>(restored?.items ?? [])
  const [professionalId, setProfessionalId] = useState(restored?.professionalId ?? '')
  const [discount, setDiscount] = useState(restored?.discount ?? 0)
  const [installments, setInstallments] = useState(restored?.installments ?? 1)
  const [firstDue, setFirstDue] = useState(restored?.firstDue ?? today())
  const [notes, setNotes] = useState(restored?.notes ?? '')
  const [hint, setHint] = useState<string | null>(null)
  const [showRestored, setShowRestored] = useState(!!restored)

  // grava o rascunho a cada mudança; sem itens, não há o que guardar
  useEffect(() => {
    if (items.length) sessionStorage.setItem(draftKey(id), JSON.stringify({ items, professionalId, discount, installments, firstDue, notes } satisfies Saved))
    else sessionStorage.removeItem(draftKey(id))
  }, [id, items, professionalId, discount, installments, firstDue, notes])
  // fechar a aba com itens: aviso padrão do navegador
  useEffect(() => {
    if (!items.length) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [items.length])
  const discard = () => {
    sessionStorage.removeItem(draftKey(id))
    setItems([]); setDiscount(0); setInstallments(1); setFirstDue(today()); setNotes(''); setProfessionalId(''); setShowRestored(false)
  }

  const proc = procs.data?.find((p) => p.id === procId)
  const subtotal = items.reduce((s, i) => s + i.priceCents, 0)
  const total = Math.max(0, subtotal - discount)
  const perInstallment = installments > 0 ? Math.floor(total / installments) : total
  const selectedTeeth = Object.keys(selection).map(Number)

  /** Um item por dente selecionado (com as faces dele). Procedimento de boca toda dispensa dente. */
  const add = () => {
    if (!proc) { setHint('Escolha um procedimento.'); return }
    const needsTooth = proc.scope === 'tooth' || proc.scope === 'face'
    if (needsTooth && selectedTeeth.length === 0) { setHint('Selecione pelo menos um dente no odontograma.'); return }
    const targets = needsTooth ? selectedTeeth : [null]
    setItems((cur) => [
      ...cur,
      ...targets.map((t) => ({
        key: crypto.randomUUID(), procedure: proc, tooth: t,
        faces: t !== null && proc.scope === 'face' ? (selection[t] ?? []) : [],
        priceCents: proc.priceCents,
      })),
    ])
    setSelection({})
    setHint(null)
  }

  const save = useMutation({
    mutationFn: () => post<Budget>(`/patients/${id}/budgets`, {
      professionalId: professionalId || pros.data?.[0]?.id,
      items: items.map((i) => ({ procedureId: i.procedure.id, tooth: i.tooth ?? undefined, faces: i.faces, priceCents: i.priceCents })),
      discountCents: discount, installments, firstDueDate: firstDue, notes: notes || undefined,
    }),
    onSuccess: (b) => {
      sessionStorage.removeItem(draftKey(id))
      setItems([])
      qc.invalidateQueries({ queryKey: ['budgets', id] })
      toast('success', `Orçamento nº ${b.number} salvo. Aprove quando o paciente aceitar.`)
      nav(`/pacientes/${id}/orcamentos`)
    },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar o orçamento.'),
  })

  const marks = useMemo(() => {
    const m: Record<number, { planned: Face[] | 'all' }> = {}
    for (const i of items) if (i.tooth) m[i.tooth] = { planned: i.faces.length ? i.faces : 'all' }
    return m
  }, [items])

  return (
    <Page title="Novo orçamento">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/pacientes/${id}/orcamentos`} className="inline-flex items-center gap-1 text-sm text-accent-text hover:underline">
          <ArrowLeft className="size-4" /> {patient.data?.name ?? 'Paciente'}
        </Link>
      </div>
      {showRestored && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          <History aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">Recuperamos o orçamento que você estava montando ({items.length} {items.length === 1 ? 'item' : 'itens'}).</span>
          <Button size="sm" variant="ghost" onClick={discard}>Descartar rascunho</Button>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card className="flex flex-col gap-4 p-4">
          <h2 className="text-base font-semibold">1. Marque os dentes e as faces</h2>
          <Odontogram mode="select" selection={selection} onSelectionChange={(s) => { setSelection(s); setHint(null) }} marks={marks}
            facesHint={proc && proc.scope !== 'face' ? 'O procedimento escolhido vale para o dente inteiro: as faces não se aplicam.' : 'Para restaurações, marque as faces de cada dente.'} />
          <h2 className="text-base font-semibold">2. Escolha o procedimento</h2>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Procedimento" className="min-w-64 flex-1">
              <Select value={procId} onChange={(e) => { setProcId(e.target.value); setHint(null) }}>
                <option value="">Selecione…</option>
                {procs.data?.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.priceCents)}</option>)}
              </Select>
            </Field>
            <Button onClick={add} icon={<Plus className="size-4" />}>
              Adicionar{selectedTeeth.length > 1 ? ` (${selectedTeeth.length} dentes)` : ''}
            </Button>
          </div>
          {hint && <p role="alert" className="text-sm text-danger">{hint}</p>}
          {proc && (proc.scope === 'mouth' || proc.scope === 'arch' || proc.scope === 'region') && (
            <p className="text-xs text-text-muted">Este procedimento vale para a boca toda ou uma região: não precisa marcar dente.</p>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <h2 className="text-base font-semibold">Itens do orçamento</h2>
          {items.length === 0 ? (
            <EmptyState icon={<Plus className="size-5" />} title="Nenhum item" body="Marque dentes, escolha um procedimento e clique em Adicionar." />
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((i) => (
                <li key={i.key} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <span className="w-14 shrink-0 font-mono text-xs text-text-muted">{i.tooth ? `${i.tooth}${i.faces.length ? ' ' + i.faces.join('') : ''}` : 'Boca'}</span>
                  <span className="min-w-0 flex-1 truncate text-sm" title={i.procedure.name}>{i.procedure.name}</span>
                  <div className="w-32 shrink-0">
                    <MoneyInput aria-label={`Valor de ${i.procedure.name}`} value={i.priceCents} onValueChange={(v) => setItems((cur) => cur.map((x) => (x.key === i.key ? { ...x, priceCents: v } : x)))} />
                  </div>
                  <IconButton label={`Remover ${i.procedure.name}`} size="sm" onClick={() => setItems((cur) => cur.filter((x) => x.key !== i.key))}><Trash2 className="size-4" /></IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Profissional responsável" className="col-span-2">
              <Select value={professionalId || pros.data?.[0]?.id || ''} onChange={(e) => setProfessionalId(e.target.value)}>
                {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Desconto" error={discount > subtotal ? 'Desconto maior que o total.' : undefined}><MoneyInput value={discount} onValueChange={setDiscount} /></Field>
            <Field label="Parcelas">
              <Select value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x</option>)}
              </Select>
            </Field>
            <Field label="1º vencimento" className="col-span-2"><Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
            <Field label="Observações" className="col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <dl className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(subtotal)}</dd></div>
            {discount > 0 && <div className="flex justify-between text-text-muted"><dt>Desconto</dt><dd className="tabular-nums">− {formatMoney(Math.min(discount, subtotal))}</dd></div>}
            <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(total)}</dd></div>
            {installments > 1 && <p className="text-xs text-text-muted">{installments}x de {formatMoney(perInstallment)}{total % installments ? ' (a 1ª parcela leva os centavos que sobram)' : ''}</p>}
          </dl>
          <Button size="lg" disabled={!items.length || discount > subtotal} loading={save.isPending} onClick={() => save.mutate()}>Salvar orçamento</Button>
        </Card>
      </div>
    </Page>
  )
}

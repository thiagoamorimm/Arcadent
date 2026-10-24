import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Clock, FlaskConical, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, get, patch, post } from '../api/client'
import type { ProsthesisEvent, ProsthesisOrder, ProsthesisStage, Professional, Treatment } from '../api/types'
import { PatientPicker, type PickedPatient } from '../domain/PatientPicker'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, Skeleton, useToast } from '../ui/Feedback'
import { EnterSubmits, Field, Input, MoneyInput, Select, Textarea } from '../ui/Field'
import { ConfirmDialog, Modal } from '../ui/Overlay'
import { cn, formatMoney } from '../ui/cn'
import { Page } from './Layout'

export const STAGES: { key: ProsthesisStage; label: string; hint: string }[] = [
  { key: 'pre_lab', label: 'Pré-laboratório', hint: 'Moldagem, escaneamento, escolha de cor' },
  { key: 'envio', label: 'Envio', hint: 'Esperando ir para o laboratório' },
  { key: 'laboratorio', label: 'No laboratório', hint: 'Em confecção' },
  { key: 'prova', label: 'Prova / instalação', hint: 'Voltou: agendar e provar' },
  { key: 'realizado', label: 'Realizado', hint: 'Instalado (últimos 30 dias)' },
]
const stageLabel = (s: ProsthesisStage) => STAGES.find((x) => x.key === s)!.label
const fmtDate = (d: string | null) => (d ? new Date(d + 'T12:00').toLocaleDateString('pt-BR') : null)
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }

/** S27 — Controle de prótese: quadro com as 5 etapas do pedido ao laboratório. */
export function ProsthesisPage() {
  const q = useQuery({ queryKey: ['prosthesis'], queryFn: () => get<ProsthesisOrder[]>('/prosthesis') })
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<ProsthesisOrder | null>(null)
  const late = q.data?.filter((o) => o.late).length ?? 0
  return (
    <Page title="Controle de prótese" actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo pedido</Button>}>
      {late > 0 && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertTriangle aria-hidden className="size-4" />{late} {late === 1 ? 'pedido atrasado' : 'pedidos atrasados'}: o prazo da etapa já passou.
        </p>
      )}
      {!q.data ? <Skeleton className="h-96 w-full" /> : q.data.length === 0 ? (
        <EmptyState icon={<FlaskConical className="size-5" />} title="Nenhum pedido de prótese"
          body="Registre coroas, próteses e placas enviadas ao laboratório e acompanhe cada etapa até a instalação."
          action={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo pedido</Button>} />
      ) : (
        // No celular as colunas rolam para o lado dentro do próprio quadro.
        <div className="relative -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <ol className="grid min-w-[1050px] grid-cols-5 gap-3" aria-label="Etapas">
            {STAGES.map((st) => {
              const items = q.data.filter((o) => o.stage === st.key)
              return (
                <li key={st.key} className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-2" aria-labelledby={`col-${st.key}`}>
                  <div className="px-1">
                    <h2 id={`col-${st.key}`} className="text-sm font-semibold">{st.label} <span className="font-normal text-text-muted">({items.length})</span></h2>
                    <p className="text-xs text-text-muted">{st.hint}</p>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {items.map((o) => <OrderCard key={o.id} o={o} onOpen={() => setOpen(o)} />)}
                  </ul>
                </li>
              )
            })}
          </ol>
        </div>
      )}
      {creating && <OrderModal onClose={() => setCreating(false)} />}
      {open && <OrderModal order={open} onClose={() => setOpen(null)} />}
    </Page>
  )
}

function OrderCard({ o, onOpen }: { o: ProsthesisOrder; onOpen: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const idx = STAGES.findIndex((s) => s.key === o.stage)
  const next = STAGES[idx + 1]
  const advance = useMutation({
    mutationFn: () => post<ProsthesisOrder>(`/prosthesis/${o.id}/stage`, { stage: next.key, dueDate: next.key === 'realizado' ? undefined : inDays(7) }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['prosthesis'] }); toast('success', `${r.patientName}: ${stageLabel(r.stage)}.`) },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível mudar a etapa.'),
  })
  return (
    <li>
      <Card className={cn('flex flex-col gap-1.5 p-3', o.late && 'border-danger')}>
        <button type="button" onClick={onOpen} className="flex flex-col gap-0.5 rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-focus-ring">
          <span className="text-sm font-semibold">{o.patientName}</span>
          <span className="text-sm">{o.description}</span>
          {o.laboratory && <span className="text-xs text-text-muted">{o.laboratory}</span>}
        </button>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {o.late ? <Badge tone="danger"><AlertTriangle aria-hidden className="size-3" />Atrasado · prazo {fmtDate(o.dueDate)}</Badge>
            : o.dueDate ? <span className="flex items-center gap-1 text-text-muted"><Clock aria-hidden className="size-3" />Prazo {fmtDate(o.dueDate)}</span> : null}
          {o.stage !== 'realizado' && <span className="text-text-muted">{o.daysInStage === 0 ? 'Entrou hoje na etapa' : `${o.daysInStage} ${o.daysInStage === 1 ? 'dia' : 'dias'} na etapa`}</span>}
        </div>
        {next && (
          <Button size="sm" variant="secondary" className="self-start" icon={<ArrowRight className="size-3.5" />} loading={advance.isPending}
            onClick={() => advance.mutate()} aria-label={`Mover ${o.patientName}, ${o.description}, para ${next.label}`}>
            {next.label}
          </Button>
        )}
      </Card>
    </li>
  )
}

/** Novo pedido ou detalhe (editar, mudar etapa com prazo e observação, histórico, cancelar). */
function OrderModal({ order, onClose }: { order?: ProsthesisOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const pros = useQuery({ queryKey: ['professionals'], queryFn: () => get<Professional[]>('/professionals') })
  const labs = useQuery({ queryKey: ['prosthesis-labs'], queryFn: () => get<string[]>('/prosthesis/laboratories') })
  const events = useQuery({ queryKey: ['prosthesis-events', order?.id], queryFn: () => get<ProsthesisEvent[]>(`/prosthesis/${order!.id}/events`), enabled: !!order })
  const [patient, setPatient] = useState<PickedPatient | null>(order ? { id: order.patientId, name: order.patientName } : null)
  const treatments = useQuery({ queryKey: ['treatments', patient?.id], queryFn: () => get<Treatment[]>(`/patients/${patient!.id}/treatments`), enabled: !!patient?.id })
  const [f, setF] = useState({
    treatmentId: order?.treatmentId ?? '', professionalId: order?.professionalId ?? '', description: order?.description ?? '',
    laboratory: order?.laboratory ?? '', dueDate: order?.dueDate ?? (order ? '' : inDays(7)), costCents: order?.costCents ?? 0, notes: order?.notes ?? '',
  })
  const [stage, setStage] = useState<ProsthesisStage>(order?.stage ?? 'pre_lab')
  const [stageNote, setStageNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['prosthesis'] }); qc.invalidateQueries({ queryKey: ['prosthesis-labs'] }); toast('success', msg); onClose() }
  const fail = (e: unknown) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.')
  const body = () => ({
    patientId: patient?.id, treatmentId: f.treatmentId || undefined, professionalId: f.professionalId || undefined, description: f.description,
    laboratory: f.laboratory || undefined, dueDate: f.dueDate || undefined, costCents: f.costCents || undefined, notes: f.notes || undefined,
  })
  const save = useMutation({
    mutationFn: async () => {
      if (!order) return post<ProsthesisOrder>('/prosthesis', body())
      let r = await patch<ProsthesisOrder>(`/prosthesis/${order.id}`, body())
      if (stage !== order.stage) r = await post<ProsthesisOrder>(`/prosthesis/${order.id}/stage`, { stage, dueDate: f.dueDate || undefined, note: stageNote || undefined })
      return r
    },
    onSuccess: (r) => done(order ? `Pedido de ${r.patientName} salvo${stage !== order.stage ? ` · ${stageLabel(r.stage)}` : ''}.` : `Pedido de ${r.patientName} criado.`),
    onError: fail,
  })
  const cancel = useMutation({ mutationFn: () => post(`/prosthesis/${order!.id}/cancel`, {}), onSuccess: () => done('Pedido cancelado.'), onError: fail })
  const missing = !patient?.id ? 'Escolha um paciente cadastrado.' : !f.description.trim() ? 'Descreva o trabalho.' : null
  const submit = () => { setTouched(true); if (!missing && !save.isPending) save.mutate() }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const pickTreatment = (id: string) => {
    const t = treatments.data?.find((x) => x.id === id)
    setF({ ...f, treatmentId: id, description: f.description || (t ? `${t.procedureName}${t.tooth ? ` — ${t.tooth}` : ''}` : ''), professionalId: f.professionalId || t?.professionalId || '' })
  }
  return (
    <Modal open size="lg" onOpenChange={(v) => !v && onClose()} title={order ? `Prótese de ${order.patientName}` : 'Novo pedido de prótese'}
      description={order ? `Etapa atual: ${stageLabel(order.stage)}` : 'Do molde à instalação, com prazo por etapa.'}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <div>{order && <Button variant="ghost" onClick={() => setCanceling(true)}>Cancelar pedido</Button>}</div>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button loading={save.isPending} onClick={submit}>{order ? 'Salvar' : 'Criar pedido'}</Button></div>
        </div>
      }>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        {order ? (
          <p className="text-sm sm:col-span-2">Paciente: <Link className="font-medium text-accent-text underline-offset-2 hover:underline" to={`/pacientes/${order.patientId}/tratamentos`}>{order.patientName}</Link></p>
        ) : (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span id="pros-patient" className="text-xs font-semibold">Paciente <span aria-hidden className="text-danger">*</span></span>
            <PatientPicker value={patient} onChange={setPatient} invalid={touched && !patient?.id} labelledBy="pros-patient" />
          </div>
        )}
        {patient?.id && (treatments.data?.length ?? 0) > 0 && (
          <Field label="Tratamento ligado" className="sm:col-span-2">
            <Select value={f.treatmentId} onChange={(e) => pickTreatment(e.target.value)}>
              <option value="">Nenhum</option>
              {treatments.data!.filter((t) => t.status !== 'canceled').map((t) => <option key={t.id} value={t.id}>{t.procedureName}{t.tooth ? ` · dente ${t.tooth}` : ''}{t.status === 'done' ? ' (finalizado)' : ''}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Trabalho" required className="sm:col-span-2" error={touched && !f.description.trim() ? 'Descreva o trabalho.' : undefined}>
          <Input value={f.description} maxLength={200} onChange={set('description')} placeholder="Ex.: Coroa em porcelana — 11, cor A2" />
        </Field>
        <Field label="Laboratório">
          <Input value={f.laboratory} maxLength={120} onChange={set('laboratory')} list="labs" />
        </Field>
        <datalist id="labs">{labs.data?.map((l) => <option key={l} value={l} />)}</datalist>
        <Field label="Profissional">
          <Select value={f.professionalId} onChange={set('professionalId')}>
            <option value="">—</option>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {order && (
          <Field label="Etapa">
            <Select value={stage} onChange={(e) => setStage(e.target.value as ProsthesisStage)}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label={order ? 'Prazo da etapa' : 'Prazo da 1ª etapa'} hint="Passou do prazo, o pedido aparece como atrasado.">
          <Input type="date" value={f.dueDate} onChange={set('dueDate')} disabled={stage === 'realizado'} />
        </Field>
        <Field label="Custo do laboratório"><MoneyInput value={f.costCents} onValueChange={(v) => setF({ ...f, costCents: v })} /></Field>
        {order && stage !== order.stage && (
          <Field label="Observação da mudança de etapa" className="sm:col-span-2"><Input value={stageNote} maxLength={300} onChange={(e) => setStageNote(e.target.value)} placeholder="Ex.: prova não adaptou, volta para ajuste" /></Field>
        )}
        <Field label="Observações" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        {touched && missing && <p role="alert" className="text-sm text-danger sm:col-span-2">{missing}</p>}
      </form>
      {order && (
        <section aria-labelledby="hist" className="mt-4 border-t border-border pt-3">
          <h3 id="hist" className="mb-2 text-xs font-semibold">Histórico</h3>
          <ol className="flex flex-col gap-1.5 text-sm">
            {events.data?.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2"><span className="font-medium">{stageLabel(e.stage)}</span>
                <span className="text-text-muted">{new Date(e.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {e.userName ?? '—'}</span>
                {e.note && <span className="w-full text-text-muted">{e.note}</span>}</li>
            ))}
          </ol>
          {order.costCents ? <p className="mt-2 text-xs text-text-muted">Custo do laboratório: {formatMoney(order.costCents)}</p> : null}
        </section>
      )}
      {canceling && <ConfirmDialog open onOpenChange={(v) => !v && setCanceling(false)} title="Cancelar este pedido?" body="Ele sai do quadro. O histórico fica guardado." confirmLabel="Cancelar pedido" loading={cancel.isPending} onConfirm={() => cancel.mutate()} />}
    </Modal>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ClipboardCheck, FileDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ApiError, del, get, patch, post } from '../../api/client'
import { PdfViewer } from '../../ui/PdfViewer'
import type { Anamnesis, AnamnesisTemplate, Answer, Question } from '../../api/types'
import { useClinic } from '../../lib/useClinic'
import { dateTimeIn } from '../../lib/tz'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { Input, Select, Textarea } from '../../ui/Field'
import { ConfirmDialog } from '../../ui/Overlay'
import { cn } from '../../ui/cn'

const isAlert = (q: Question, a?: Answer) => !!q.alertOn && a?.value === q.alertOn

/** Aba Anamnese: lista, preencher (rascunho → concluída) e PDF para assinar. */
export function AnamnesisTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const list = useQuery({ queryKey: ['anamneses', patientId], queryFn: () => get<Anamnesis[]>(`/patients/${patientId}/anamneses`) })
  const templates = useQuery({ queryKey: ['anamnesis-templates'], queryFn: () => get<AnamnesisTemplate[]>('/anamnesis-templates') })
  const active = templates.data?.filter((t) => t.isActive) ?? []
  const [tplId, setTplId] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState<Anamnesis | null>(null)
  const [pdf, setPdf] = useState<Anamnesis | null>(null)

  const start = useMutation({
    mutationFn: () => post<Anamnesis>(`/patients/${patientId}/anamneses`, { templateId: tplId || active[0]?.id }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['anamneses', patientId] }); setOpen(a.id) },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível começar.'),
  })
  const discard = useMutation({
    mutationFn: (a: Anamnesis) => del(`/anamneses/${a.id}`),
    onSuccess: () => { setDiscarding(null); setOpen(null); qc.invalidateQueries({ queryKey: ['anamneses', patientId] }); toast('success', 'Rascunho descartado.') },
  })

  if (list.isLoading) return <Skeleton className="h-40 w-full" />
  const current = list.data?.find((a) => a.id === open)
  if (current) return <AnamnesisForm key={current.id} anamnesis={current} tz={tz} onClose={() => setOpen(null)} onDiscard={() => setDiscarding(current)} discardDialog={discarding && <ConfirmDialog open onOpenChange={(v) => !v && setDiscarding(null)} title="Descartar este rascunho?" body="As respostas preenchidas até agora serão perdidas." confirmLabel="Descartar rascunho" loading={discard.isPending} onConfirm={() => discard.mutate(discarding)} />} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        {active.length > 1 && (
          <div className="w-64">
            <Select aria-label="Modelo de anamnese" value={tplId || active[0]?.id} onChange={(e) => setTplId(e.target.value)}>
              {active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
        )}
        <Button icon={<Plus className="size-4" />} loading={start.isPending} disabled={!active.length} onClick={() => start.mutate()}>Nova anamnese</Button>
      </div>
      {!list.data?.length ? (
        <EmptyState icon={<ClipboardCheck className="size-5" />} title="Nenhuma anamnese" body="Faça a anamnese na primeira consulta. As respostas de risco viram alertas no topo da ficha." />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.templateName} {a.status === 'draft' ? <Badge tone="warning" className="ml-1">Rascunho</Badge> : <Badge tone="success" className="ml-1">Concluída</Badge>}</p>
                  <p className="text-xs text-text-muted">{dateTimeIn(a.completedAt ?? a.createdAt, tz)}{a.professionalName ? ` · ${a.professionalName}` : ''}</p>
                  {a.alerts.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">{a.alerts.map((al) => <Badge key={al} tone="danger"><AlertTriangle aria-hidden className="size-3" />{al}</Badge>)}</p>
                  )}
                </div>
                {a.status === 'draft'
                  ? <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setOpen(a.id)}>Continuar</Button>
                  : <Button size="sm" variant="secondary" onClick={() => setOpen(a.id)}>Ver respostas</Button>}
                <Button size="sm" variant="ghost" icon={<FileDown className="size-4" />} onClick={() => setPdf(a)}>PDF</Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {pdf && <PdfViewer path={`/anamneses/${pdf.id}/pdf`} title={`Anamnese — ${pdf.templateName}`} fileName="anamnese.pdf" onClose={() => setPdf(null)} />}
    </div>
  )
}

function AnamnesisForm({ anamnesis, tz, onClose, onDiscard, discardDialog }: { anamnesis: Anamnesis; tz: string; onClose: () => void; onDiscard: () => void; discardDialog: React.ReactNode }) {
  const qc = useQueryClient()
  const toast = useToast()
  const readOnly = anamnesis.status === 'completed'
  const [answers, setAnswers] = useState<Record<string, Answer>>(anamnesis.answers)
  const [confirm, setConfirm] = useState(false)
  const set = (id: string, a: Answer) => setAnswers((cur) => ({ ...cur, [id]: { ...cur[id], ...a } }))
  const unanswered = anamnesis.questions.filter((q) => q.type !== 'text' && !answers[q.id]?.value).length
  const alerts = anamnesis.questions.filter((q) => isAlert(q, answers[q.id])).map((q) => q.alert!)

  const save = useMutation({
    mutationFn: (complete: boolean) => patch<Anamnesis>(`/anamneses/${anamnesis.id}`, { answers, complete }),
    onSuccess: (a, complete) => {
      qc.invalidateQueries({ queryKey: ['anamneses', anamnesis.patientId] })
      qc.invalidateQueries({ queryKey: ['patient', anamnesis.patientId] })
      toast('success', complete ? `Anamnese concluída${a.alerts.length ? ` com ${a.alerts.length} alerta(s) na ficha` : ''}.` : 'Rascunho salvo.')
      setConfirm(false)
      if (complete) onClose()
    },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{anamnesis.templateName}</p>
          <p className="text-xs text-text-muted">{readOnly ? `Concluída em ${dateTimeIn(anamnesis.completedAt!, tz)}` : 'Rascunho — salve quando quiser e conclua ao terminar.'}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>Voltar para a lista</Button>
      </div>
      <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
        {anamnesis.questions.map((q, i) => {
          const a = answers[q.id]
          const warn = isAlert(q, a)
          return (
            <li key={q.id} className={cn('flex flex-col gap-2 px-4 py-3', warn && 'bg-danger-soft')}>
              <p id={`q-${q.id}`} className="text-sm font-medium">{i + 1}. {q.text}</p>
              {q.type === 'yesno' && (
                <div role="radiogroup" aria-labelledby={`q-${q.id}`} className="flex gap-2">
                  {(['sim', 'nao'] as const).map((v) => (
                    <label key={v} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm', a?.value === v ? 'border-accent bg-accent-soft' : 'border-border-strong bg-bg', readOnly && 'cursor-default')}>
                      <input type="radio" name={q.id} value={v} checked={a?.value === v} disabled={readOnly} onChange={() => set(q.id, { value: v })} className="accent-[var(--c-accent)]" />
                      {v === 'sim' ? 'Sim' : 'Não'}
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'choice' && (
                <div role="radiogroup" aria-labelledby={`q-${q.id}`} className="flex flex-wrap gap-2">
                  {q.options!.map((v) => (
                    <label key={v} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm', a?.value === v ? 'border-accent bg-accent-soft' : 'border-border-strong bg-bg')}>
                      <input type="radio" name={q.id} value={v} checked={a?.value === v} disabled={readOnly} onChange={() => set(q.id, { value: v })} className="accent-[var(--c-accent)]" />
                      {v}
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'text' && (
                <Textarea aria-labelledby={`q-${q.id}`} rows={2} value={a?.value ?? ''} readOnly={readOnly} onChange={(e) => set(q.id, { value: e.target.value })} />
              )}
              {q.withDetail && (a?.value === 'sim' || a?.detail) && (
                <Input aria-label={`Detalhes: ${q.text}`} placeholder="Quais? Detalhe aqui" value={a?.detail ?? ''} readOnly={readOnly} onChange={(e) => set(q.id, { detail: e.target.value })} />
              )}
              {warn && <p className="flex items-center gap-1 text-xs font-medium text-danger"><AlertTriangle aria-hidden className="size-3.5" />Vira alerta na ficha: {q.alert}</p>}
            </li>
          )
        })}
      </ol>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setConfirm(true)} icon={<ClipboardCheck className="size-4" />}>Concluir anamnese</Button>
          <Button variant="secondary" loading={save.isPending && !confirm} onClick={() => save.mutate(false)}>Salvar rascunho</Button>
          <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={onDiscard}>Descartar</Button>
          {unanswered > 0 && <span className="text-xs text-text-muted">{unanswered} pergunta(s) sem resposta</span>}
        </div>
      )}
      {confirm && (
        <ConfirmDialog open onOpenChange={setConfirm} title="Concluir a anamnese?" tone="primary"
          body={<>Depois de concluída ela <strong>não pode mais ser editada</strong> (faz parte do prontuário).{unanswered > 0 && <> Ainda há <strong>{unanswered} pergunta(s) sem resposta</strong>.</>}{alerts.length > 0 && <> Alertas que vão para a ficha: <strong>{alerts.join(', ')}</strong>.</>}</>}
          confirmLabel="Concluir" loading={save.isPending} onConfirm={() => save.mutate(true)} />
      )}
      {discardDialog}
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileDown, FileText, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { ApiError, get, post } from '../../api/client'
import { PdfViewer } from '../../ui/PdfViewer'
import type { DocItem } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { dateTimeIn, hm, partsIn, todayIn } from '../../lib/tz'
import { useClinic } from '../../lib/useClinic'
import { Badge } from '../../ui/Badge'
import { Button, IconButton } from '../../ui/Button'
import { Checkbox } from '../../ui/Choice'
import { Card, EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { Field, Input, Select, Textarea } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { cn } from '../../ui/cn'

/** Aba Documentos: receitas e atestados em PDF com o papel timbrado da clínica. */
export function DocumentsTab({ patientId }: { patientId: string }) {
  const { can } = useAuth()
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const docs = useQuery({ queryKey: ['documents', patientId], queryFn: () => get<DocItem[]>(`/patients/${patientId}/documents`) })
  const [modal, setModal] = useState<'prescription' | 'certificate' | null>(null)
  const [viewing, setViewing] = useState<{ id: string; title: string } | null>(null)
  const open = (id: string, title = 'Documento') => setViewing({ id, title })

  return (
    <div className="flex flex-col gap-4">
      {can('paciente.documents') && (
        <div className="flex flex-wrap gap-2">
          <Button icon={<FileText className="size-4" />} onClick={() => setModal('prescription')}>Nova receita</Button>
          <Button variant="secondary" icon={<Stethoscope className="size-4" />} onClick={() => setModal('certificate')}>Novo atestado</Button>
        </div>
      )}
      {docs.isLoading ? <Skeleton className="h-24 w-full" /> : !docs.data?.length ? (
        <EmptyState icon={<FileText className="size-5" />} title="Nenhum documento" body="Receitas e atestados emitidos ficam aqui e podem ser reabertos em PDF a qualquer momento." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {docs.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Badge tone={d.kind === 'prescription' ? 'accent' : 'info'}>{d.kind === 'prescription' ? 'Receita' : 'Atestado'}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-text-muted">{dateTimeIn(d.createdAt, tz)} · {d.professionalName}</p>
                </div>
                <Button size="sm" variant="secondary" icon={<FileDown className="size-4" />} onClick={() => open(d.id, d.title)}>Abrir PDF</Button>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2 text-xs text-text-muted">Documentos emitidos não são editados: se algo saiu errado, emita um novo. Receita de controle especial ainda não é suportada.</p>
        </Card>
      )}
      {modal === 'prescription' && <PrescriptionModal patientId={patientId} onClose={() => setModal(null)} onIssued={open} />}
      {modal === 'certificate' && <CertificateModal patientId={patientId} tz={tz} onClose={() => setModal(null)} onIssued={open} />}
      {viewing && <PdfViewer path={`/documents/${viewing.id}/pdf`} title={viewing.title} fileName={`${viewing.title.split(' (')[0].toLowerCase().replace(/\s+/g, '-')}.pdf`} onClose={() => setViewing(null)} />}
    </div>
  )
}

type Item = { key: string; medication: string; quantity: string; instructions: string; usage: 'interno' | 'externo' | 'topico' }
const blank = (): Item => ({ key: crypto.randomUUID(), medication: '', quantity: '', instructions: '', usage: 'interno' })

function PrescriptionModal({ patientId, onClose, onIssued }: { patientId: string; onClose: () => void; onIssued: (id: string, title: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const listId = useId()
  const meds = useQuery({ queryKey: ['medications'], queryFn: () => get<string[]>('/documents/medications') })
  const [items, setItems] = useState<Item[]>([blank()])
  const [notes, setNotes] = useState('')
  const set = (k: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === k ? { ...i, ...patch } : i)))
  const valid = items.length > 0 && items.every((i) => i.medication.trim())
  const issue = useMutation({
    mutationFn: () => post<DocItem>(`/patients/${patientId}/documents`, {
      kind: 'prescription',
      prescription: { items: items.map(({ medication, quantity, instructions, usage }) => ({ medication, quantity, instructions, usage })), notes },
    }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['documents', patientId] }); qc.invalidateQueries({ queryKey: ['medications'] }); toast('success', 'Receita emitida.'); onClose(); onIssued(d.id, d.title) },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível emitir.'),
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Nova receita" size="lg" description="Medicamentos já receitados na clínica aparecem como sugestão ao digitar."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!valid} loading={issue.isPending} onClick={() => issue.mutate()} icon={<FileDown className="size-4" />}>Emitir receita</Button></>}>
      <datalist id={listId}>{meds.data?.map((m) => <option key={m} value={m} />)}</datalist>
      <div className="flex flex-col gap-3">
        {items.map((i, n) => (
          <fieldset key={i.key} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_140px_130px_auto]">
            <legend className="px-1 text-xs font-semibold text-text-muted">Medicamento {n + 1}</legend>
            <Field label="Nome e concentração" required><Input list={listId} value={i.medication} onChange={(e) => set(i.key, { medication: e.target.value })} placeholder="Ex.: Ibuprofeno 600 mg" data-autofocus={n === 0 ? true : undefined} /></Field>
            <Field label="Quantidade"><Input value={i.quantity} onChange={(e) => set(i.key, { quantity: e.target.value })} placeholder="Ex.: 10 comprimidos" /></Field>
            <Field label="Uso">
              <Select value={i.usage} onChange={(e) => set(i.key, { usage: e.target.value as Item['usage'] })}>
                <option value="interno">Interno</option><option value="externo">Externo</option><option value="topico">Tópico</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <IconButton label={`Remover medicamento ${n + 1}`} disabled={items.length === 1} onClick={() => setItems((cur) => cur.filter((x) => x.key !== i.key))}><Trash2 className="size-4" /></IconButton>
            </div>
            <Field label="Como usar" className="sm:col-span-4"><Textarea rows={2} value={i.instructions} onChange={(e) => set(i.key, { instructions: e.target.value })} placeholder="Ex.: Tomar 1 comprimido de 8 em 8 horas por 3 dias, após as refeições." /></Field>
          </fieldset>
        ))}
        <div><Button size="sm" variant="ghost" icon={<Plus className="size-4" />} disabled={items.length >= 20} onClick={() => setItems((cur) => [...cur, blank()])}>Adicionar medicamento</Button></div>
        <Field label="Recomendações (opcional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function CertificateModal({ patientId, tz, onClose, onIssued }: { patientId: string; tz: string; onClose: () => void; onIssued: (id: string, title: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const now = partsIn(new Date(), tz).minutes
  const [type, setType] = useState<'comparecimento' | 'afastamento'>('comparecimento')
  const [date, setDate] = useState(todayIn(tz))
  const [from, setFrom] = useState(hm(Math.max(0, now - 60)))
  const [to, setTo] = useState(hm(now))
  const [days, setDays] = useState(1)
  const [cid, setCid] = useState('')
  const [cidOk, setCidOk] = useState(false)
  const [notes, setNotes] = useState('')
  const cidMissingConsent = !!cid.trim() && !cidOk
  const badHours = type === 'comparecimento' && to <= from
  const issue = useMutation({
    mutationFn: () => post<DocItem>(`/patients/${patientId}/documents`, {
      kind: 'certificate',
      certificate: { type, date, from: type === 'comparecimento' ? from : undefined, to: type === 'comparecimento' ? to : undefined, days: type === 'afastamento' ? days : undefined, cid: cid || undefined, cidAuthorized: cidOk, notes },
    }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['documents', patientId] }); toast('success', 'Atestado emitido.'); onClose(); onIssued(d.id, d.title) },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível emitir.'),
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Novo atestado"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={cidMissingConsent || badHours} loading={issue.isPending} onClick={() => issue.mutate()} icon={<FileDown className="size-4" />}>Emitir atestado</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div role="radiogroup" aria-label="Tipo de atestado" className="inline-flex w-fit rounded-md border border-border-strong p-0.5 sm:col-span-2">
          {(['comparecimento', 'afastamento'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
              className={cn('h-8 rounded-sm px-3 text-sm', type === t ? 'bg-accent text-on-accent' : 'hover:bg-surface')}>
              {t === 'comparecimento' ? 'Comparecimento' : 'Afastamento'}
            </button>
          ))}
        </div>
        <Field label="Data do atendimento" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {type === 'comparecimento' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Das" required><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Às" required error={badHours ? 'Depois do início.' : undefined}><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label="Dias de afastamento" required>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>{Array.from({ length: 15 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} {d === 1 ? 'dia' : 'dias'}</option>)}</Select>
          </Field>
        )}
        <Field label="CID (opcional)" hint="Só com autorização do paciente."><Input value={cid} maxLength={10} onChange={(e) => setCid(e.target.value.toUpperCase())} placeholder="Ex.: K04.0" /></Field>
        <div className="flex items-end pb-2">
          <Checkbox label="O paciente autorizou o CID no atestado" checked={cidOk} onCheckedChange={setCidOk} disabled={!cid.trim()} />
        </div>
        {cidMissingConsent && <p className="text-xs text-danger sm:col-span-2">Marque a autorização do paciente ou apague o CID.</p>}
        <Field label="Observação (opcional)" className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

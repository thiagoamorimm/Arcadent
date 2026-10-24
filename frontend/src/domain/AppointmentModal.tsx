import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarPlus, Copy, Clock, FileText, Lock, Pencil, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, del, get, patch, post } from '../api/client'
import type { Appointment, Label, Professional } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { hoursOf } from '../lib/useClinic'
import { addDays, hm, longDate, openRanges, parseHm, partsIn, zonedToUtc, type WeekHours, type Ymd } from '../lib/tz'
import { StatusBadge, statusMeta, type AppointmentStatus } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Choice'
import { useToast } from '../ui/Feedback'
import { Field, Input, Select, Textarea, EnterSubmits } from '../ui/Field'
import { ConfirmDialog, Modal } from '../ui/Overlay'
import { cn } from '../ui/cn'
import { PatientPicker, type PickedPatient } from './PatientPicker'

type Kind = Appointment['kind']
const KIND_LABEL: Record<Kind, string> = { consulta: 'Consulta', compromisso: 'Compromisso', bloqueio: 'Bloqueio' }
const KIND_HINT: Record<Kind, string> = {
  consulta: 'Atendimento de um paciente.',
  compromisso: 'Reunião, curso, retorno de ligação… ocupa o horário.',
  bloqueio: 'Horário fechado para marcação (almoço, folga, feriado).',
}
const DURATIONS = [15, 20, 30, 40, 45, 60, 90, 120, 180]
const FLOW: AppointmentStatus[] = ['agendado', 'confirmado', 'aguardando', 'em_atendimento', 'atendido', 'faltou', 'cancelado']
const dur = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`)

export type ModalTarget =
  | { mode: 'create'; ymd: Ymd; minutes: number; professionalId: string; kind?: Kind; from?: Appointment }
  | { mode: 'open'; appt: Appointment }

/** Duplicar: mesmo paciente, profissional, duração, rótulo e observação, na mesma hora da semana seguinte. */
export function duplicateTarget(a: Appointment, tz: string): ModalTarget {
  const s = partsIn(new Date(a.startAt), tz)
  return { mode: 'create', ymd: addDays(s.ymd, 7), minutes: s.minutes, professionalId: a.professionalId, kind: a.kind, from: a }
}

/** Fora do horário de atendimento? Devolve o texto do aviso (não bloqueia a marcação). */
function outsideHint(prof: Professional | undefined, clinicHours: WeekHours | undefined, ymd: Ymd, start: number, end: number) {
  const ranges = openRanges(hoursOf(prof, clinicHours), ymd)
  const anyHours = hoursOf(prof, clinicHours) && Object.values(hoursOf(prof, clinicHours)!).some((d) => d?.length)
  if (!anyHours) return null
  if (ranges.some(([a, b]) => start >= a && end <= b)) return null
  const when = ranges.length ? ranges.map(([a, b]) => `${hm(a)}–${b >= 1440 ? '24:00' : hm(b)}`).join(', ') : 'não atende neste dia'
  return `Fora do horário de atendimento de ${prof?.name ?? 'o profissional'} (${when}). Dá para marcar mesmo assim.`
}

/**
 * Criar, ver, editar e excluir consulta, compromisso ou bloqueio. Conflito de horário volta do servidor
 * dizendo com quem conflita, e a tela oferece "encaixar mesmo assim".
 */
export function AppointmentModal({
  target, tz, professionals, clinicHours, onClose, onDuplicate,
}: {
  target: ModalTarget; tz: string; professionals: Professional[]; clinicHours: WeekHours | undefined; onClose: () => void
  onDuplicate?: (a: Appointment) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { can, me } = useAuth()
  const labels = useQuery({ queryKey: ['labels'], queryFn: () => get<Label[]>('/labels') })
  const appt = target.mode === 'open' ? target.appt : null
  const from = target.mode === 'create' ? target.from ?? null : null
  const src = appt ?? from
  const [editing, setEditing] = useState(target.mode === 'create' || appt?.kind !== 'consulta')

  // estado do formulário (no fuso da clínica)
  const s0 = appt ? partsIn(new Date(appt.startAt), tz) : null
  const e0 = appt ? partsIn(new Date(appt.endAt), tz) : null
  const srcS = src ? partsIn(new Date(src.startAt), tz) : null
  const srcE = src ? partsIn(new Date(src.endAt), tz) : null
  const srcEnd = srcS && srcE ? (srcE.ymd !== srcS.ymd ? 1440 : srcE.minutes) : null
  const srcDuration = srcS && srcEnd !== null ? srcEnd - srcS.minutes : 30
  const [kind, setKind] = useState<Kind>(src?.kind ?? (target.mode === 'create' ? target.kind ?? 'consulta' : 'consulta'))
  const [patient, setPatient] = useState<PickedPatient | null>(src?.patientId ? { id: src.patientId, name: src.patientName ?? '' } : null)
  const [ymd, setYmd] = useState<Ymd>(s0?.ymd ?? (target.mode === 'create' ? target.ymd : ''))
  const [start, setStart] = useState(hm(s0?.minutes ?? (target.mode === 'create' ? target.minutes : 540)))
  const initialEnd = appt ? (e0!.ymd !== s0!.ymd ? 1440 : e0!.minutes) : (target.mode === 'create' ? Math.min(1440, target.minutes + srcDuration) : 570)
  const [end, setEnd] = useState(initialEnd >= 1440 ? '24:00' : hm(initialEnd))
  const [duration, setDuration] = useState(srcDuration)
  const [allDay, setAllDay] = useState(src?.kind === 'bloqueio' && srcS?.minutes === 0 && srcEnd !== null && srcEnd >= 1440)
  const [professionalId, setProfessionalId] = useState(appt?.professionalId ?? (target.mode === 'create' ? target.professionalId : ''))
  const [labelId, setLabelId] = useState(src?.labelId ?? '')
  const [title, setTitle] = useState(src?.title ?? '')
  const [notes, setNotes] = useState(src?.notes ?? '')
  const [conflict, setConflict] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const pickable = professionals.filter((p) => can('agenda.create_for_others') || p.id === me?.membership_id || p.id === appt?.professionalId)
  const prof = professionals.find((p) => p.id === professionalId)
  const startMin = allDay ? 0 : parseHm(start)
  const endMin = allDay ? 1440 : kind === 'consulta' ? startMin + duration : parseHm(end)
  const hint = useMemo(() => (kind === 'consulta' && ymd ? outsideHint(prof, clinicHours, ymd, startMin, endMin) : null), [kind, prof, clinicHours, ymd, startMin, endMin])
  const invalidTime = endMin <= startMin
  const missing = kind === 'consulta' ? !patient : !title.trim()

  const canEdit = can('agenda.create') && (!appt || appt.professionalId === me?.membership_id || can('agenda.create_for_others'))
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['appointments'] })
    qc.invalidateQueries({ queryKey: ['patients'] })
    toast('success', msg)
    onClose()
  }
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'APPOINTMENT_CONFLICT') { setConflict(e.message); setError(null) }
    else setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.')
  }

  const save = useMutation({
    mutationFn: (overlapAllowed: boolean) => {
      const startAt = zonedToUtc(ymd, startMin, tz).toISOString()
      const endAt = zonedToUtc(ymd, endMin, tz).toISOString()
      if (appt) {
        return patch<Appointment>(`/appointments/${appt.id}`, {
          startAt, endAt, professionalId, overlapAllowed: overlapAllowed || undefined,
          title: kind !== 'consulta' ? title : undefined, notes,
          labelId: labelId || undefined, clearLabel: kind === 'consulta' && !labelId && !!appt.labelId ? true : undefined,
        })
      }
      return post<Appointment>('/appointments', {
        kind, professionalId, startAt, endAt, overlapAllowed,
        patientId: kind === 'consulta' ? patient?.id ?? undefined : undefined,
        newPatient: kind === 'consulta' && patient && patient.id === null ? { name: patient.name, phone: patient.phone || undefined } : undefined,
        title: kind !== 'consulta' ? title : undefined,
        labelId: kind === 'consulta' ? labelId || undefined : undefined,
        notes: notes || undefined,
      })
    },
    onSuccess: (a) => {
      const when = `${longDate(ymd, { weekday: 'short', day: '2-digit', month: '2-digit' })}, ${hm(startMin)}`
      done(appt ? `${KIND_LABEL[a.kind]} atualizado: ${when}.` : a.kind === 'consulta' ? `Consulta marcada: ${a.patientName}, ${when}.` : `${KIND_LABEL[a.kind]} criado: ${when}.`)
    },
    onError: fail,
  })
  const setStatus = useMutation({
    mutationFn: (status: AppointmentStatus) => patch<Appointment>(`/appointments/${appt!.id}`, { status }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['appointments'] }); toast('success', `Status: ${statusMeta[a.status].label}.`); onClose() },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'APPOINTMENT_CONFLICT') toast('danger', `Não dá para reativar: ${e.message}`)
      else toast('danger', e instanceof ApiError ? e.message : 'Não foi possível mudar o status.')
    },
  })
  const remove = useMutation({
    mutationFn: () => del(`/appointments/${appt!.id}`),
    onSuccess: () => done(`${KIND_LABEL[appt!.kind]} excluído.`),
    onError: (e) => { setConfirmDelete(false); toast('danger', e instanceof ApiError ? e.message : 'Não foi possível excluir.') },
  })

  const submit = (overlap = false) => {
    setTouched(true)
    if (missing || invalidTime || !professionalId || !ymd) return
    save.mutate(overlap)
  }
  // qualquer mudança de horário/profissional invalida o aviso de conflito anterior
  const touchTime = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setConflict(null) }

  // ---------- modo leitura (consulta já marcada) ----------
  if (appt && !editing) {
    const when = `${longDate(s0!.ymd, { weekday: 'long', day: 'numeric', month: 'long' })}, ${hm(s0!.minutes)}–${hm(initialEnd % 1440)}`
    return (
      <Modal open onOpenChange={(v) => !v && onClose()} title={appt.patientName ?? 'Consulta'} description={`${when} · ${appt.professionalName}`}
        footer={
          <div className="flex w-full flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              {can('agenda.delete') && canEdit && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Excluir</Button>}
            </div>
            <div className="flex gap-2">
              {appt.patientId && <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => nav(`/pacientes/${appt.patientId}`)}>Abrir ficha</Button>}
              {canEdit && onDuplicate && <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => onDuplicate(appt)}>Duplicar</Button>}
              {canEdit && <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar ou mover</Button>}
            </div>
          </div>
        }>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">Status: <StatusBadge status={appt.status} />{appt.labelName && <span className="text-text-muted">· {appt.labelName}</span>}</div>
          {appt.outsideHours && <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><Clock aria-hidden className="mt-0.5 size-4 shrink-0" />Marcada fora do horário de atendimento.</p>}
          {appt.overlapAllowed && <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info"><Users aria-hidden className="mt-0.5 size-4 shrink-0" />Encaixe: divide o horário com outro atendimento.</p>}
          {appt.patientPhone && <p className="text-sm">Celular: <a className="text-accent-text underline" href={`tel:${appt.patientPhone.replace(/\D/g, '')}`}>{appt.patientPhone}</a></p>}
          {appt.notes && <p className="whitespace-pre-wrap rounded-md bg-surface p-3 text-sm">{appt.notes}</p>}
          {canEdit && (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold">Mudar status</legend>
              <div className="flex flex-wrap gap-2">
                {FLOW.filter((st) => st !== appt.status).map((st) => (
                  <Button key={st} size="sm" variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate(st)}>{statusMeta[st].label}</Button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        {confirmDelete && <DeleteConfirm appt={appt} loading={remove.isPending} onCancel={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} />}
      </Modal>
    )
  }

  // ---------- formulário (criar ou editar) ----------
  const titleText = appt ? `Editar ${KIND_LABEL[kind].toLowerCase()}` : from ? `Duplicar ${KIND_LABEL[kind].toLowerCase()}` : `Novo ${kind === 'consulta' ? 'agendamento' : KIND_LABEL[kind].toLowerCase()}`
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={titleText} size="md"
      description={appt ? undefined : from ? 'Mesmos dados da original. Escolha a nova data e o horário.' : KIND_HINT[kind]}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {appt && can('agenda.delete') && canEdit && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Excluir</Button>}
            {appt && appt.kind !== 'consulta' && canEdit && onDuplicate && <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => onDuplicate(appt)}>Duplicar</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => (appt && appt.kind === 'consulta' ? setEditing(false) : onClose())}>{appt && appt.kind === 'consulta' ? 'Voltar' : 'Cancelar'}</Button>
            {conflict
              ? <Button onClick={() => submit(true)} loading={save.isPending}>{kind === 'bloqueio' ? 'Bloquear mesmo assim' : 'Encaixar mesmo assim'}</Button>
              : <Button onClick={() => submit(false)} loading={save.isPending} icon={kind === 'bloqueio' ? <Lock className="size-4" /> : <CalendarPlus className="size-4" />}>
                  {appt ? 'Salvar' : kind === 'consulta' ? 'Marcar consulta' : kind === 'bloqueio' ? 'Bloquear horário' : 'Criar compromisso'}
                </Button>}
          </div>
        </div>
      }>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(false) }}>
        <EnterSubmits />
        {!appt && !from && (
          <div role="radiogroup" aria-label="Tipo" className="inline-flex w-fit rounded-md border border-border-strong p-0.5 sm:col-span-2">
            {(['consulta', 'compromisso', 'bloqueio'] as Kind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setConflict(null); setError(null) }}
                className={cn('h-8 rounded-sm px-3 text-sm', kind === k ? 'bg-accent text-on-accent' : 'text-text hover:bg-surface')}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{error}</p>}
        {conflict && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning sm:col-span-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{conflict} Escolha outro horário ou confirme {kind === 'bloqueio' ? 'o bloqueio' : 'o encaixe'}.</span>
          </p>
        )}

        {kind === 'consulta' ? (
          appt || from ? (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs font-semibold">Paciente</span>
              <p className="text-sm font-medium">{(appt ?? from)!.patientName}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span id="appt-patient-label" className="text-xs font-semibold">Paciente <span aria-hidden className="text-danger">*</span></span>
              <PatientPicker value={patient} onChange={setPatient} invalid={touched && !patient} labelledBy="appt-patient-label" />
              {touched && !patient && <p className="text-xs text-danger">Escolha um paciente ou cadastre um novo.</p>}
            </div>
          )
        ) : (
          <Field label={kind === 'bloqueio' ? 'Motivo' : 'Título'} required className="sm:col-span-2" error={touched && !title.trim() ? 'Dê um nome.' : undefined}>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'bloqueio' ? 'Ex.: Almoço, folga, curso' : 'Ex.: Reunião com laboratório'} data-autofocus />
          </Field>
        )}

        <Field label="Profissional" required>
          <Select value={professionalId} onChange={(e) => touchTime(setProfessionalId)(e.target.value)}>
            {pickable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Data" required><Input type="date" value={ymd} onChange={(e) => touchTime(setYmd)(e.target.value)} /></Field>

        {kind === 'bloqueio' && <div className="sm:col-span-2"><Checkbox label="Dia inteiro" checked={allDay} onCheckedChange={touchTime(setAllDay)} /></div>}
        {!allDay && (
          <>
            <Field label="Início" required><Input type="time" step={300} value={start} onChange={(e) => touchTime(setStart)(e.target.value)} /></Field>
            {kind === 'consulta' ? (
              <Field label="Duração">
                <Select value={duration} onChange={(e) => touchTime(setDuration)(Number(e.target.value))}>
                  {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{dur(m)}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Fim" required error={invalidTime ? 'O fim precisa ser depois do início.' : undefined}>
                <Input type="time" step={300} value={end} onChange={(e) => touchTime(setEnd)(e.target.value)} />
              </Field>
            )}
          </>
        )}
        {hint && <p className="flex items-start gap-2 text-xs text-warning sm:col-span-2"><Clock aria-hidden className="mt-0.5 size-3.5 shrink-0" />{hint}</p>}

        {kind === 'consulta' && (
          <Field label="Rótulo">
            <Select value={labelId} onChange={(e) => setLabelId(e.target.value)}>
              <option value="">Sem rótulo</option>
              {labels.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Observação" className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </form>
      {confirmDelete && appt && <DeleteConfirm appt={appt} loading={remove.isPending} onCancel={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} />}
    </Modal>
  )
}

function DeleteConfirm({ appt, loading, onCancel, onConfirm }: { appt: Appointment; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  const isConsulta = appt.kind === 'consulta'
  return (
    <ConfirmDialog open onOpenChange={(v) => !v && onCancel()} title={`Excluir ${isConsulta ? 'esta consulta' : `“${appt.title}”`}?`}
      body={isConsulta
        ? <>A consulta de <strong>{appt.patientName}</strong> sai da agenda de vez. Se o paciente desmarcou, prefira <strong>Cancelado</strong>: assim fica no histórico dele.</>
        : <>O horário volta a ficar livre na agenda.</>}
      confirmLabel={`Excluir ${KIND_LABEL[appt.kind].toLowerCase()}`} loading={loading} onConfirm={onConfirm} />
  )
}

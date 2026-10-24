import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Lock, Plus, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, get, patch } from '../api/client'
import type { Appointment, Professional } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import type { LabelColor } from '../domain/Agenda'
import { AppointmentModal, duplicateTarget, type ModalTarget } from '../domain/AppointmentModal'
import { TimeGrid, type GridColumn, type GridItem } from '../domain/TimeGrid'
import { addDays, dowOf, hasHours, hm, longDate, mondayOf, openRanges, partsIn, todayIn, zonedToUtc, type WeekHours, type Ymd } from '../lib/tz'
import { hoursOf, useClinic, useProfessionals } from '../lib/useClinic'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, Skeleton, useToast } from '../ui/Feedback'
import { Select } from '../ui/Field'
import { ConfirmDialog } from '../ui/Overlay'
import { cn } from '../ui/cn'
import { Page } from './Layout'

const DOW = ['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.', 'dom.']
/** Sem horário nenhum cadastrado = sem restrição (igual ao servidor): o dia todo aparece aberto. */
const openOf = (h: WeekHours | undefined, ymd: Ymd): [number, number][] => (hasHours(h) ? openRanges(h, ymd) : [[0, 1440]])
type View = 'day' | 'week'
type PendingMove = { appt: Appointment; ymd: Ymd; start: number; professionalId: string; message?: string }

/** S04/S05 — Agenda: semana (colunas = dias) ou dia (colunas = profissionais), no fuso da clínica. */
export function AgendaPage() {
  const toast = useToast()
  const qc = useQueryClient()
  const nav = useNavigate()
  const { can, me } = useAuth()
  const clinic = useClinic()
  const pros = useProfessionals()
  const tz = clinic.data?.timezone
  const [view, setView] = useState<View>(() => (window.innerWidth < 768 ? 'day' : 'week'))
  const [anchor, setAnchor] = useState<Ymd | null>(null)
  const [prof, setProf] = useState('')
  const [modal, setModal] = useState<ModalTarget | null>(null)
  const [pending, setPending] = useState<PendingMove | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  useEffect(() => { if (tz && !anchor) setAnchor(todayIn(tz)) }, [tz, anchor])

  const viewAll = can('agenda.view_all')
  const canCreate = can('agenda.create')
  const professionals = useMemo(() => pros.data ?? [], [pros.data])
  // Sem "ver todos", a pessoa só vê a própria agenda (o servidor também força isso).
  const shownPros: Professional[] = !viewAll
    ? professionals.filter((p) => p.id === me?.membership_id)
    : prof ? professionals.filter((p) => p.id === prof) : professionals
  const selectedPro = !viewAll ? shownPros[0] : professionals.find((p) => p.id === prof)
  const sundayOpen = !!clinic.data?.businessHours?.sun?.length

  const days: Ymd[] = useMemo(() => {
    if (!anchor) return []
    if (view === 'day') return [anchor]
    const mon = mondayOf(anchor)
    return Array.from({ length: sundayOpen ? 7 : 6 }, (_, i) => addDays(mon, i))
  }, [anchor, view, sundayOpen])

  const fromIso = tz && days.length ? zonedToUtc(days[0], 0, tz).toISOString() : ''
  const toIso = tz && days.length ? zonedToUtc(addDays(days[days.length - 1], 1), 0, tz).toISOString() : ''
  const filterProf = viewAll ? prof : me?.membership_id ?? ''
  const appts = useQuery({
    queryKey: ['appointments', fromIso, toIso, filterProf],
    queryFn: () => get<Appointment[]>(`/appointments?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}${filterProf ? `&professionalId=${filterProf}` : ''}`),
    enabled: !!fromIso,
  })

  const move = useMutation({
    mutationFn: ({ p, overlap }: { p: PendingMove; overlap: boolean }) => {
      const dur = new Date(p.appt.endAt).getTime() - new Date(p.appt.startAt).getTime()
      const startAt = zonedToUtc(p.ymd, p.start, tz!)
      return patch<Appointment>(`/appointments/${p.appt.id}`, {
        startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + dur).toISOString(),
        professionalId: p.professionalId, overlapAllowed: overlap || undefined,
      })
    },
    onSuccess: async (a) => {
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      setPending(null)
      const s = partsIn(new Date(a.startAt), tz!)
      toast('success', `Movido para ${longDate(s.ymd, { weekday: 'short', day: '2-digit', month: '2-digit' })}, ${hm(s.minutes)}${a.outsideHours ? ' (fora do horário de atendimento)' : ''}.`)
    },
    onError: (e, { p }) => {
      if (e instanceof ApiError && e.code === 'APPOINTMENT_CONFLICT') setPending({ ...p, message: e.message })
      else { setPending(null); toast('danger', e instanceof ApiError ? e.message : 'Não foi possível mover.') }
    },
  })

  if (clinic.isLoading || pros.isLoading || !anchor || !tz) {
    return <Page title="Agenda"><Skeleton className="h-[70vh] w-full" /></Page>
  }
  if (professionals.length === 0 || shownPros.length === 0) {
    return (
      <Page title="Agenda">
        <EmptyState icon={<UserRound className="size-5" />} title="Ninguém atendendo ainda"
          body={can('config.team') ? 'Marque em Ajustes › Equipe quem atende pacientes. Cada profissional que atende ganha uma agenda.' : 'Peça ao responsável pela clínica para liberar sua agenda.'}
          action={can('config.team') ? <Button onClick={() => nav('/ajustes/equipe')}>Abrir Equipe</Button> : undefined} />
      </Page>
    )
  }

  // ---------- colunas e itens ----------
  const today = todayIn(tz)
  const nowParts = partsIn(now, tz)
  const columns: GridColumn[] = view === 'week'
    ? days.map((d) => ({
        key: d, label: DOW[dowOf(d)], sub: String(Number(d.slice(8))), highlight: d === today,
        open: openOf(hoursOf(selectedPro, clinic.data?.businessHours), d),
      }))
    : shownPros.map((p) => ({ key: p.id, label: p.name, open: openOf(hoursOf(p, clinic.data?.businessHours), anchor) }))

  const items: GridItem[] = (appts.data ?? []).flatMap((a) => {
    const s = partsIn(new Date(a.startAt), tz), e = partsIn(new Date(a.endAt), tz)
    const col = view === 'week' ? days.indexOf(s.ymd) : shownPros.findIndex((p) => p.id === a.professionalId)
    if (col < 0) return []
    const end = e.ymd === s.ymd ? e.minutes : 1440
    const isMovable = canCreate && (a.professionalId === me?.membership_id || can('agenda.create_for_others'))
    // Enquanto o servidor confirma a mudança, o cartão já aparece no lugar novo.
    const pend = pending?.appt.id === a.id ? pending : null
    const pcol = pend ? (view === 'week' ? days.indexOf(pend.ymd) : shownPros.findIndex((p) => p.id === pend.professionalId)) : col
    const pstart = pend ? pend.start : s.minutes
    return [{
      id: a.id, col: pcol < 0 ? col : pcol, start: pstart, end: pstart + (end - s.minutes), kind: a.kind,
      title: a.kind === 'consulta' ? a.patientName ?? 'Paciente' : a.title ?? '',
      detail: [view === 'week' && !selectedPro ? a.professionalName.split(' ')[0] : null, a.labelName].filter(Boolean).join(' · ') || undefined,
      status: a.kind === 'consulta' ? a.status : undefined,
      label: (Number(a.labelColor) || 8) as LabelColor,
      movable: isMovable,
    }]
  })

  // faixa de horas: do primeiro horário aberto ao último (com 1h de folga), cobrindo também o que estiver fora
  const opens = columns.flatMap((c) => c.open).filter(([a, b]) => !(a === 0 && b === 1440))
  const lo = Math.min(...opens.map(([a]) => a), ...items.map((i) => i.start), 8 * 60)
  const hi = Math.max(...opens.map(([, b]) => b), ...items.map((i) => i.end), 18 * 60)
  const from = Math.max(0, Math.floor((lo - 60) / 60) * 60)
  const to = Math.min(1440, Math.ceil((hi + 60) / 60) * 60)

  const range = view === 'day'
    ? longDate(anchor)
    : `${Number(days[0].slice(8))} – ${longDate(days[days.length - 1], { day: 'numeric', month: 'long', year: 'numeric' })}`
  const defaultProf = selectedPro?.id ?? (can('agenda.create_for_others') ? professionals[0]?.id : me?.membership_id) ?? ''

  const openCreate = (col: number, minutes: number, kind?: 'consulta' | 'bloqueio') => setModal({
    mode: 'create', kind,
    ymd: view === 'week' ? days[col] : anchor,
    minutes,
    professionalId: view === 'day' ? shownPros[col].id : defaultProf,
  })

  return (
    <Page
      title="Agenda"
      actions={canCreate ? (
        <div className="flex gap-2">
          <span className="hidden sm:block">
            <Button variant="secondary" icon={<Lock className="size-4" />} onClick={() => openCreate(0, 12 * 60, 'bloqueio')}>Bloquear horário</Button>
          </span>
          <Button icon={<Plus className="size-4" />} onClick={() => openCreate(view === 'week' ? Math.max(0, days.indexOf(today)) : 0, 9 * 60)}>Agendar</Button>
        </div>
      ) : undefined}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {viewAll && (
          <div className="w-full sm:w-60">
            <Select aria-label="Profissional" value={prof} onChange={(e) => setProf(e.target.value)}>
              <option value="">Todos os profissionais</option>
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        )}
        <div className="flex items-center gap-1">
          <IconButton label={view === 'day' ? 'Dia anterior' : 'Semana anterior'} variant="secondary" onClick={() => setAnchor(addDays(anchor, view === 'day' ? -1 : -7))}><ChevronLeft className="size-4" /></IconButton>
          <Button variant="secondary" onClick={() => setAnchor(today)}>Hoje</Button>
          <IconButton label={view === 'day' ? 'Próximo dia' : 'Próxima semana'} variant="secondary" onClick={() => setAnchor(addDays(anchor, view === 'day' ? 1 : 7))}><ChevronRight className="size-4" /></IconButton>
        </div>
        <input type="date" aria-label="Ir para a data" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)}
          className="h-10 rounded-md border border-border-input bg-bg px-2 text-sm" />
        <p className="text-sm font-semibold first-letter:uppercase" aria-live="polite">{range}</p>
        <div className="ml-auto inline-flex rounded-md border border-border-strong p-0.5" role="radiogroup" aria-label="Visualização">
          {(['day', 'week'] as View[]).map((v) => (
            <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)}
              className={cn('h-8 rounded-sm px-3 text-sm', view === v ? 'bg-accent text-on-accent' : 'hover:bg-surface')}>
              {v === 'day' ? 'Dia' : 'Semana'}
            </button>
          ))}
        </div>
      </div>

      {appts.isError && (
        <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          Não foi possível carregar a agenda. <button className="underline" onClick={() => appts.refetch()}>Tentar de novo</button>
        </p>
      )}
      {appts.isSuccess && appts.data.length === 0 && (
        <p className="mb-3 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          Nada marcado {view === 'day' ? 'neste dia' : 'nesta semana'}.{canCreate && ' Clique num horário da grade para agendar.'}
        </p>
      )}
      {view === 'week' && !selectedPro && professionals.length > 1 && (
        <p className="mb-2 text-xs text-text-muted">Vendo todos: o fundo segue o expediente da clínica. Escolha um profissional para ver o horário dele, ou use a visão Dia para ver todos lado a lado.</p>
      )}

      <TimeGrid
        ariaLabel={view === 'day' ? `Agenda de ${range}` : `Agenda da semana ${range}`}
        columns={columns}
        items={items}
        from={from}
        to={to}
        nowCol={view === 'week' ? days.indexOf(nowParts.ymd) : nowParts.ymd === anchor ? 'all' : undefined}
        nowMinutes={nowParts.minutes}
        step={clinic.data?.slotMinutes ?? 15}
        onSlotClick={canCreate ? openCreate : undefined}
        onItemClick={(id) => { const a = appts.data?.find((x) => x.id === id); if (a) setModal({ mode: 'open', appt: a }) }}
        onItemMove={(id, col, start) => {
          const a = appts.data?.find((x) => x.id === id)
          if (!a) return
          const p: PendingMove = view === 'week'
            ? { appt: a, ymd: days[col], start, professionalId: a.professionalId }
            : { appt: a, ymd: anchor, start, professionalId: shownPros[col].id }
          setPending(p)
          move.mutate({ p, overlap: false })
        }}
      />

      {modal && (
        <AppointmentModal
          key={modal.mode === 'open' ? modal.appt.id : `${modal.ymd}-${modal.minutes}-${modal.from?.id ?? ''}`}
          target={modal} tz={tz} professionals={professionals} clinicHours={clinic.data?.businessHours}
          onClose={() => setModal(null)} onDuplicate={(a) => setModal(duplicateTarget(a, tz))}
        />
      )}
      {pending?.message && (
        <ConfirmDialog open onOpenChange={(v) => !v && setPending(null)} title="Esse horário já está ocupado"
          body={<>{pending.message} Quer encaixar mesmo assim? Os dois atendimentos ficam lado a lado.</>}
          confirmLabel="Encaixar mesmo assim" tone="primary" loading={move.isPending}
          onConfirm={() => move.mutate({ p: pending, overlap: true })} />
      )}
    </Page>
  )
}

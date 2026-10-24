import { Lock } from 'lucide-react'
import { statusMeta, type AppointmentStatus } from '../ui/Badge'
import { cn } from '../ui/cn'

export type LabelColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export interface AgendaItem {
  id: string
  day: number          // 0 = primeira coluna
  start: string        // "09:30" no fuso da clínica
  end: string
  kind: 'consulta' | 'compromisso' | 'bloqueio'
  title: string        // paciente ou título
  detail?: string      // procedimento / observação
  status?: AppointmentStatus
  label?: LabelColor
}

const labelCls: Record<LabelColor, string> = {
  1: 'bg-label-1-bg text-label-1-fg border-label-1-bar',
  2: 'bg-label-2-bg text-label-2-fg border-label-2-bar',
  3: 'bg-label-3-bg text-label-3-fg border-label-3-bar',
  4: 'bg-label-4-bg text-label-4-fg border-label-4-bar',
  5: 'bg-label-5-bg text-label-5-fg border-label-5-bar',
  6: 'bg-label-6-bg text-label-6-fg border-label-6-bar',
  7: 'bg-label-7-bg text-label-7-fg border-label-7-bar',
  8: 'bg-label-8-bg text-label-8-fg border-label-8-bar',
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** Consultas que se sobrepõem (encaixe) ficam lado a lado em vez de uma por cima da outra. */
function layoutLanes(items: AgendaItem[]) {
  const sorted = [...items].sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end))
  const out: { it: AgendaItem; lane: number; lanes: number }[] = []
  let cluster: { it: AgendaItem; lane: number }[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const flush = () => { cluster.forEach((c) => out.push({ ...c, lanes: laneEnds.length })); cluster = []; laneEnds = [] }
  for (const it of sorted) {
    const s = toMin(it.start), e = toMin(it.end)
    if (s >= clusterEnd) { flush(); clusterEnd = -1 }
    let lane = laneEnds.findIndex((end) => end <= s)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e) } else laneEnds[lane] = e
    cluster.push({ it, lane })
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return out
}

/** Cartão de consulta: cor = rótulo (barra à esquerda), status sempre em texto. */
export function AppointmentCard({ item, compact, onClick }: { item: AgendaItem; compact?: boolean; onClick?: () => void }) {
  if (item.kind === 'bloqueio') {
    return (
      <div
        onClick={onClick}
        className="flex h-full cursor-default items-start gap-1 overflow-hidden rounded-sm border border-border-strong px-1.5 py-1 text-xs text-text-muted"
        style={{ background: 'repeating-linear-gradient(135deg, var(--c-surface-sunken) 0 6px, var(--c-surface) 6px 12px)' }}
      >
        <Lock aria-hidden className="mt-px size-3 shrink-0" />
        <span className="truncate font-medium">{item.title}</span>
      </div>
    )
  }
  const canceled = item.status === 'cancelado' || item.status === 'faltou'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      aria-label={onClick ? `${item.start} às ${item.end}, ${item.title}${item.status ? ', ' + statusMeta[item.status].label : ''}` : undefined}
      className={cn(
        'flex h-full w-full flex-col items-start overflow-hidden rounded-sm border-l-4 px-1.5 py-1 text-left text-xs shadow-card',
        labelCls[item.label ?? 8],
        canceled && 'opacity-60',
      )}
    >
      <span className={cn('w-full truncate font-semibold', canceled && 'line-through')}>{item.title}</span>
      {!compact && (
        <span className="w-full truncate">
          {item.start}–{item.end}{item.detail ? ` · ${item.detail}` : ''}
        </span>
      )}
      {!compact && item.status && <span className="mt-auto truncate font-medium">{statusMeta[item.status].label}</span>}
    </Tag>
  )
}

/**
 * Grade da semana. Linhas de 15 min (altura do token agenda-slot-15min), fora do expediente
 * em surface-sunken, linha "agora" no dia atual. Clique numa área vazia → onSlotClick.
 */
export function WeekGrid({
  days, items, from = '08:00', to = '19:00', workFrom = '08:00', workTo = '18:00', todayIndex, nowMinutes, onSlotClick, onItemClick,
}: {
  days: { label: string; date: string }[]
  items: AgendaItem[]
  from?: string; to?: string; workFrom?: string; workTo?: string
  todayIndex?: number
  nowMinutes?: number
  onSlotClick?: (day: number, start: string) => void
  onItemClick?: (id: string) => void
}) {
  const SLOT = 20 // = --layout-agenda-slot-15min
  const start = toMin(from), end = toMin(to)
  const slots = (end - start) / 15
  const y = (min: number) => ((min - start) / 15) * SLOT
  const hours = Array.from({ length: (end - start) / 60 }, (_, i) => start + i * 60)
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

  return (
    <div className="relative overflow-auto rounded-lg border border-border bg-bg" role="grid" aria-label="Agenda da semana">
      <div className="grid min-w-[720px]" style={{ gridTemplateColumns: `var(--layout-agenda-time-gutter) repeat(${days.length}, minmax(96px, 1fr))` }}>
        <div className="sticky top-0 z-20 border-b border-border bg-bg" />
        {days.map((d, i) => (
          <div
            key={d.date}
            role="columnheader"
            className={cn('sticky top-0 z-20 border-b border-l border-border bg-bg px-2 py-2', i === todayIndex && 'bg-accent-soft')}
          >
            <p className={cn('text-xs', i === todayIndex ? 'text-accent-text font-semibold' : 'text-text-muted')}>{d.label}</p>
            <p className={cn('text-lg leading-6 font-semibold tabular-nums', i === todayIndex && 'text-accent-text')}>{d.date}</p>
          </div>
        ))}

        <div className="relative" style={{ height: slots * SLOT }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-xs text-text-muted tabular-nums" style={{ top: y(h) }}>
              {h === start ? '' : fmt(h)}
            </span>
          ))}
        </div>

        {days.map((d, di) => (
          <div key={d.date} className="relative border-l border-border" style={{ height: slots * SLOT }}>
            {/* fundo: fora do expediente + linhas */}
            <div className="absolute inset-x-0 top-0 bg-surface-sunken" style={{ height: y(toMin(workFrom)) }} />
            <div className="absolute inset-x-0 bg-surface-sunken" style={{ top: y(toMin(workTo)), bottom: 0 }} />
            {Array.from({ length: slots }, (_, s) => (
              <button
                key={s}
                type="button"
                tabIndex={-1}
                aria-label={`Marcar ${d.label} ${d.date} às ${fmt(start + s * 15)}`}
                onClick={() => onSlotClick?.(di, fmt(start + s * 15))}
                className={cn(
                  'absolute inset-x-0 border-t hover:bg-accent-soft/60',
                  s % 4 === 0 ? 'border-border' : 'border-border/50 border-dashed',
                )}
                style={{ top: s * SLOT, height: SLOT }}
              />
            ))}
            {layoutLanes(items.filter((it) => it.day === di)).map(({ it, lane, lanes }) => {
              const top = y(Math.max(toMin(it.start), start)), h = y(Math.min(toMin(it.end), end)) - top
              const w = 100 / lanes
              return (
                <div
                  key={it.id}
                  className="absolute z-10 px-0.5"
                  style={{ top: top + 1, height: Math.max(h - 2, 14), left: `calc(${lane * w}% + 2px)`, width: `calc(${w}% - 4px)` }}
                >
                  <AppointmentCard item={it} compact={h < 44} onClick={onItemClick ? () => onItemClick(it.id) : undefined} />
                </div>
              )
            })}
            {di === todayIndex && nowMinutes !== undefined && nowMinutes >= start && nowMinutes <= end && (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: y(nowMinutes) }}>
                <span className="-ml-1 size-2 rounded-pill bg-now-line" />
                <span className="h-0.5 flex-1 bg-now-line" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

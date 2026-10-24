import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { hm } from '../lib/tz'
import { cn } from '../ui/cn'
import { AppointmentCard, type AgendaItem, type LabelColor } from './Agenda'
import type { AppointmentStatus } from '../ui/Badge'

export interface GridColumn {
  key: string
  label: string
  sub?: string
  highlight?: boolean
  /** intervalos abertos em minutos; fora deles o fundo fica "fechado" */
  open: [number, number][]
}

export interface GridItem {
  id: string
  col: number
  start: number // minutos desde 00:00 no fuso da clínica
  end: number
  kind: 'consulta' | 'compromisso' | 'bloqueio'
  title: string
  detail?: string
  status?: AppointmentStatus
  label?: LabelColor
  movable?: boolean
}

const PX_PER_MIN = 20 / 15 // 20 px a cada 15 min = token --layout-agenda-slot-15min

/** Consultas que se sobrepõem (encaixe) ficam lado a lado. */
function lanes(items: GridItem[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: { it: GridItem; lane: number; lanes: number }[] = []
  let cluster: { it: GridItem; lane: number }[] = []
  let ends: number[] = []
  let clusterEnd = -1
  const flush = () => { cluster.forEach((c) => out.push({ ...c, lanes: ends.length })); cluster = []; ends = [] }
  for (const it of sorted) {
    if (it.start >= clusterEnd) { flush(); clusterEnd = -1 }
    let lane = ends.findIndex((e) => e <= it.start)
    if (lane === -1) { lane = ends.length; ends.push(it.end) } else ends[lane] = it.end
    cluster.push({ it, lane })
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  flush()
  return out
}

type Drag = { id: string; x0: number; y0: number; col0: number; start0: number; dur: number; col: number; start: number; moved: boolean }

/**
 * Grade de horários genérica: colunas = dias (semana) ou profissionais (dia).
 * Arrastar um cartão move (passo de 15 min, entre colunas); clique sem arrastar abre o cartão.
 * Teclado: o cartão abre com Enter e a edição de data/hora fica no modal.
 */
export function TimeGrid({
  columns, items, from, to, nowCol, nowMinutes, onSlotClick, onItemClick, onItemMove, ariaLabel, step = 15,
}: {
  columns: GridColumn[]
  items: GridItem[]
  from: number
  to: number
  /** coluna da linha "agora"; 'all' = todas (visão dia, colunas = profissionais) */
  nowCol?: number | 'all'
  nowMinutes?: number
  onSlotClick?: (col: number, minutes: number) => void
  onItemClick?: (id: string) => void
  onItemMove?: (id: string, col: number, start: number) => void
  ariaLabel: string
  /** intervalo da grade em minutos (Ajustes › Clínica) */
  step?: number
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClick = useRef(false)
  const slots = Math.ceil((to - from) / step)
  const y = (min: number) => (min - from) * PX_PER_MIN
  const height = (to - from) * PX_PER_MIN
  const hours = Array.from({ length: Math.ceil((to - from) / 60) }, (_, i) => from + i * 60)
  const minCol = columns.length > 1 ? 96 : 200

  const startDrag = (e: RPointerEvent, it: GridItem) => {
    if (!onItemMove || !it.movable || e.button !== 0) return
    setDrag({ id: it.id, x0: e.clientX, y0: e.clientY, col0: it.col, start0: it.start, dur: it.end - it.start, col: it.col, start: it.start, moved: false })
  }
  const moveDrag = (e: RPointerEvent) => {
    if (!drag || !bodyRef.current) return
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    // Só captura o ponteiro quando vira arrasto de verdade: capturar no pointerdown desviaria o clique simples.
    if (!drag.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const r = bodyRef.current.getBoundingClientRect()
    const col = Math.min(columns.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * columns.length)))
    const start = Math.min(to - drag.dur, Math.max(from, drag.start0 + Math.round(dy / (step * PX_PER_MIN)) * step))
    setDrag({ ...drag, col, start, moved: true })
  }
  const endDrag = () => {
    if (!drag) return
    if (drag.moved) {
      // ignora só o clique que o navegador dispara logo após soltar; no próximo ciclo volta ao normal
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 0)
      if (drag.col !== drag.col0 || drag.start !== drag.start0) onItemMove?.(drag.id, drag.col, drag.start)
    }
    setDrag(null)
  }

  return (
    // "group" e não "grid": não há linhas/células navegáveis por setas; cada horário é um botão com
    // nome completo ("Marcar Ana às 10:00") e cada consulta também. Grid sem linhas confunde o leitor.
    <div className="relative overflow-auto rounded-lg border border-border bg-bg" role="group" aria-label={ariaLabel}
      onKeyDown={(e) => { if (e.key === 'Escape' && drag) setDrag(null) }}>
      <div style={{ minWidth: 56 + columns.length * minCol }}>
        {/* cabeçalho */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-bg">
          <div className="w-[var(--layout-agenda-time-gutter)] shrink-0" />
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
            {columns.map((c) => (
              <div key={c.key} className={cn('min-w-0 border-l border-border px-2 py-2', c.highlight && 'bg-accent-soft')}>
                <p className={cn('truncate text-xs', c.highlight ? 'font-semibold text-accent-text' : 'text-text-muted')}>{c.label}</p>
                {c.sub && <p className={cn('truncate text-lg font-semibold leading-6 tabular-nums', c.highlight && 'text-accent-text')}>{c.sub}</p>}
              </div>
            ))}
          </div>
        </div>
        {/* corpo */}
        <div className="flex">
          <div className="relative w-[var(--layout-agenda-time-gutter)] shrink-0" style={{ height }}>
            {hours.map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-text-muted" style={{ top: y(h) }}>
                {h === from ? '' : hm(h)}
              </span>
            ))}
          </div>
          <div ref={bodyRef} className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, height }}>
            {columns.map((c, ci) => (
              <div key={c.key} className="relative border-l border-border">
                {/* fechado = tudo fora dos intervalos abertos */}
                <div aria-hidden className="absolute inset-0 bg-surface-sunken" />
                {c.open.map(([a, b]) => (
                  <div key={a} aria-hidden className="absolute inset-x-0 bg-bg"
                    style={{ top: y(Math.max(a, from)), height: Math.max(0, y(Math.min(b, to)) - y(Math.max(a, from))) }} />
                ))}
                {Array.from({ length: slots }, (_, s) => (
                  <button
                    key={s}
                    type="button"
                    tabIndex={-1}
                    aria-label={`Marcar ${c.label}${c.sub ? ' ' + c.sub : ''} às ${hm(from + s * step)}`}
                    onClick={() => onSlotClick?.(ci, from + s * step)}
                    disabled={!onSlotClick}
                    className={cn('absolute inset-x-0 border-t enabled:hover:bg-accent-soft/60', (from + s * step) % 60 === 0 ? 'border-border' : 'border-dashed border-border/50')}
                    style={{ top: s * step * PX_PER_MIN, height: Math.min(step, to - from - s * step) * PX_PER_MIN }}
                  />
                ))}
                {(nowCol === 'all' || ci === nowCol) && nowMinutes !== undefined && nowMinutes >= from && nowMinutes <= to && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: y(nowMinutes) }}>
                    <span className="-ml-1 size-2 rounded-pill bg-now-line" />
                    <span className="h-0.5 flex-1 bg-now-line" />
                  </div>
                )}
              </div>
            ))}
            {/* cartões por cima das colunas (posição absoluta pela coluna + raia) */}
            {/* Uma lista só (flatMap), com key estável: o cartão arrastado continua sendo o MESMO elemento
                ao trocar de coluna — senão o React recria o nó e o navegador perde a captura do ponteiro. */}
            {columns.flatMap((_, ci) => lanes(items.filter((it) => (drag?.id === it.id ? drag.col : it.col) === ci).map((it) => (drag?.id === it.id ? { ...it, col: drag.col, start: drag.start, end: drag.start + drag.dur } : it))).map((x) => ({ ...x, ci })))
              .map(({ it, lane, lanes: n, ci }) => {
                const top = y(Math.max(it.start, from)), h = y(Math.min(it.end, to)) - top
                const colW = 100 / columns.length, w = colW / n
                const dragging = drag?.id === it.id && drag.moved
                return (
                  <div
                    key={it.id}
                    className={cn('absolute z-10 px-0.5', it.movable && onItemMove && 'cursor-grab touch-none', dragging && 'z-30 cursor-grabbing opacity-90 drop-shadow-lg')}
                    style={{ top: top + 1, height: Math.max(h - 2, 14), left: `calc(${ci * colW + lane * w}% + 2px)`, width: `calc(${w}% - 4px)` }}
                    onPointerDown={(e) => startDrag(e, it)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={() => setDrag(null)}
                  >
                    {dragging && (
                      <span className="absolute -top-5 left-1 z-10 rounded-sm bg-text px-1.5 text-xs text-bg tabular-nums">
                        {hm(it.start)}–{hm(it.end)}
                      </span>
                    )}
                    <AppointmentCard
                      compact={h < 44}
                      item={{ ...toCard(it) }}
                      onClick={onItemClick ? () => { if (suppressClick.current) { suppressClick.current = false; return } onItemClick(it.id) } : undefined}
                    />
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}

const toCard = (it: GridItem): AgendaItem => ({
  id: it.id, day: it.col, start: hm(it.start), end: it.end >= 1440 ? '24:00' : hm(it.end), kind: it.kind,
  title: it.title, detail: it.detail, status: it.status, label: it.label,
})

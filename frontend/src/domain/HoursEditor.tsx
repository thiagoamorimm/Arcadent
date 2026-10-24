import { Copy, Plus, X } from 'lucide-react'
import { DAY_KEYS, parseHm, type DayKey, type WeekHours } from '../lib/tz'
import { Button, IconButton } from '../ui/Button'
import { Switch } from '../ui/Choice'
import { cn } from '../ui/cn'

const DAY_LABEL: Record<DayKey, string> = { mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta', fri: 'Sexta', sat: 'Sábado', sun: 'Domingo' }

/** Problemas do dia (fim antes do início, intervalos sobrepostos) — o servidor valida de novo. */
export function dayProblem(ranges: [string, string][]): string | null {
  const r = ranges.map(([a, b]) => [parseHm(a), parseHm(b)] as const).sort((x, y) => x[0] - y[0])
  if (r.some(([a, b]) => !(b > a))) return 'O fim precisa ser depois do início.'
  for (let i = 1; i < r.length; i++) if (r[i][0] < r[i - 1][1]) return 'Os intervalos se sobrepõem.'
  return null
}
export const hoursProblem = (h: WeekHours) => DAY_KEYS.some((d) => dayProblem(h[d] ?? []))

/**
 * Horário semanal: cada dia aberto/fechado e até 4 intervalos (ex.: manhã e tarde).
 * Usado no expediente da clínica e no horário de atendimento de cada profissional.
 */
export function HoursEditor({ value, onChange, disabled }: { value: WeekHours; onChange: (v: WeekHours) => void; disabled?: boolean }) {
  const set = (d: DayKey, ranges: [string, string][]) => onChange({ ...value, [d]: ranges })
  const copyMonToWeekdays = () => {
    const mon = value.mon ?? []
    onChange({ ...value, tue: mon, wed: mon, thu: mon, fri: mon })
  }
  return (
    <div className="flex flex-col gap-1">
      <ul className="divide-y divide-border rounded-md border border-border">
        {DAY_KEYS.map((d) => {
          const ranges = value[d] ?? []
          const open = ranges.length > 0
          const problem = dayProblem(ranges)
          return (
            <li key={d} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2.5">
              <div className="w-32 shrink-0 pt-1.5">
                <Switch label={DAY_LABEL[d]} checked={open} disabled={disabled}
                  onCheckedChange={(on) => set(d, on ? [['08:00', '12:00'], ['13:00', '18:00']] : [])} />
              </div>
              {open ? (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {ranges.map(([a, b], i) => (
                      <span key={i} className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-1', problem ? 'border-danger' : 'border-border-strong')}>
                        <input type="time" step={300} aria-label={`${DAY_LABEL[d]}, início do intervalo ${i + 1}`} value={a} disabled={disabled}
                          onChange={(e) => set(d, ranges.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
                          className="h-8 rounded-sm bg-transparent px-1 text-sm tabular-nums" />
                        <span aria-hidden className="text-text-muted">–</span>
                        <input type="time" step={300} aria-label={`${DAY_LABEL[d]}, fim do intervalo ${i + 1}`} value={b === '24:00' ? '23:59' : b} disabled={disabled}
                          onChange={(e) => set(d, ranges.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
                          className="h-8 rounded-sm bg-transparent px-1 text-sm tabular-nums" />
                        {ranges.length > 1 && (
                          <IconButton size="sm" label={`Remover intervalo ${i + 1} de ${DAY_LABEL[d]}`} disabled={disabled}
                            onClick={() => set(d, ranges.filter((_, j) => j !== i))} className="size-6"><X className="size-3.5" /></IconButton>
                        )}
                      </span>
                    ))}
                    {ranges.length < 4 && (
                      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} disabled={disabled}
                        onClick={() => { const last = ranges[ranges.length - 1]?.[1] ?? '08:00'; const s = parseHm(last); const st = Math.min(s + 60, 23 * 60); set(d, [...ranges, [toHm(st), toHm(Math.min(st + 120, 23 * 60 + 55))]]) }}>
                        Intervalo
                      </Button>
                    )}
                  </div>
                  {problem && <p className="text-xs text-danger">{problem}</p>}
                </div>
              ) : (
                <p className="pt-1.5 text-sm text-text-muted">Fechado</p>
              )}
            </li>
          )
        })}
      </ul>
      {!disabled && (
        <div>
          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={copyMonToWeekdays}>Copiar segunda para terça a sexta</Button>
        </div>
      )}
    </div>
  )
}

const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

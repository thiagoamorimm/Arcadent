import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Cake, Minus, PartyPopper, Table2, BarChart3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { get } from '../api/client'
import type { InsightNumbers, InsightTasks, Performance } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { DataTable, type Column } from '../ui/DataTable'
import { Card, EmptyState, Skeleton } from '../ui/Feedback'
import { Select } from '../ui/Field'
import { Tabs } from '../ui/Overlay'
import { cn, formatMoney } from '../ui/cn'
import { Page } from './Layout'

const ymd = (d: Date) => d.toLocaleDateString('en-CA')
const PERIODS = {
  mes: { label: 'Este mês', range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(n)] } },
  anterior: { label: 'Mês passado', range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))] } },
  '90': { label: 'Últimos 90 dias', range: () => { const n = new Date(); const f = new Date(n); f.setDate(f.getDate() - 89); return [ymd(f), ymd(n)] } },
  ano: { label: 'Este ano', range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), 0, 1)), ymd(n)] } },
} as const
type PeriodKey = keyof typeof PERIODS
const pct = (a: number, b: number) => (b > 0 ? a / b : null)
const fmtPct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const MONTH = (m: string) => new Date(m + '-15').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')

/** S25 — Indicadores: desempenho do período e painel do dia. */
export function InsightsPage() {
  const { tab } = useParams()
  const nav = useNavigate()
  const { can } = useAuth()
  const tabs = [
    ...(can('insight.performance') ? [{ value: 'desempenho', label: 'Desempenho', content: <PerformanceTab /> }] : []),
    ...(can('insight.tasks') ? [{ value: 'painel', label: 'Painel do dia', content: <TasksTab /> }] : []),
  ]
  const current = tabs.find((t) => t.value === tab)?.value ?? tabs[0]?.value ?? 'painel'
  return (
    <Page title="Indicadores">
      <Tabs label="Indicadores" value={current} onValueChange={(v) => nav(`/indicadores/${v}`, { replace: true })} tabs={tabs} />
    </Page>
  )
}

function PerformanceTab() {
  const [period, setPeriod] = useState<PeriodKey>('mes')
  const [from, to] = PERIODS[period].range()
  const q = useQuery({ queryKey: ['insights', from, to], queryFn: () => get<Performance>(`/insights/performance?from=${from}&to=${to}`) })
  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-48"><Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select></div>
        <p className="text-xs text-text-muted">Comparado com os {period === 'mes' || period === 'anterior' ? 'mesmos dias do período anterior' : 'dias imediatamente anteriores'}.</p>
      </div>
      {!q.data ? <Skeleton className="h-64 w-full" /> : <PerformanceView p={q.data} />}
    </div>
  )
}

function PerformanceView({ p }: { p: Performance }) {
  const c = p.current, b = p.previous
  const noShow = (n: InsightNumbers) => pct(n.noShows, n.attended + n.noShows)
  const conv = (n: InsightNumbers) => pct(n.budgetsApproved, n.budgetsCreated)
  const ticket = (n: InsightNumbers) => (n.budgetsApproved ? Math.round(n.budgetsApprovedCents / n.budgetsApproved) : null)
  const empty = c.appointments + c.budgetsCreated + c.receivedCents + c.paidCents + c.newPatients === 0
  return (
    <>
      {empty && <p role="status" className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">Nada registrado neste período ainda. Os números aparecem conforme a agenda, os orçamentos e o caixa forem usados.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Consultas atendidas" value={String(c.attended)} now={c.attended} before={b.attended} hint={`${c.appointments} marcadas · ${c.canceled} canceladas`} />
        <Stat label="Taxa de faltas" value={fmtPct(noShow(c))} now={noShow(c)} before={noShow(b)} lowerIsBetter hint={`${c.noShows} ${c.noShows === 1 ? 'falta' : 'faltas'}`} />
        <Stat label="Conversão de orçamentos" value={fmtPct(conv(c))} now={conv(c)} before={conv(b)} hint={`${c.budgetsApproved} de ${c.budgetsCreated} aprovados`} />
        <Stat label="Ticket médio" value={ticket(c) === null ? '—' : formatMoney(ticket(c)!)} now={ticket(c)} before={ticket(b)} hint="Valor médio por orçamento aprovado" />
        <Stat label="Recebido" value={formatMoney(c.receivedCents)} now={c.receivedCents} before={b.receivedCents} hint={`Pago: ${formatMoney(c.paidCents)}`} />
        <Stat label="Pacientes novos" value={String(c.newPatients)} now={c.newPatients} before={b.newPatients} />
      </div>
      <IncomeExpenseChart months={p.months} />
      <section aria-labelledby="by-pro">
        <h3 id="by-pro" className="mb-2 text-sm font-semibold">Por profissional no período</h3>
        <DataTable caption="Atendimentos e produção por profissional" rows={p.byProfessional} rowKey={(r) => r.professional}
          empty={<EmptyState icon={<BarChart3 className="size-5" />} title="Nenhum profissional que atende" body="Ative 'Atende pacientes' na equipe." />}
          columns={[
            { key: 'p', header: 'Profissional', value: (r) => r.professional },
            { key: 'a', header: 'Atendidas', value: (r) => r.attended, align: 'right' },
            { key: 'f', header: 'Faltas', value: (r) => r.no_shows, align: 'right' },
            { key: 'v', header: 'Produção (tratamentos finalizados)', value: (r) => r.produced_cents, align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(r.produced_cents)}</span> },
          ]} />
      </section>
    </>
  )
}

/** Número do período + seta contra o anterior (texto diz a direção: não depende só da cor). */
function Stat({ label, value, now, before, hint, lowerIsBetter }: {
  label: string; value: string; now: number | null; before: number | null; hint?: string; lowerIsBetter?: boolean
}) {
  let trend: 'up' | 'down' | 'same' | null = null
  if (now !== null && before !== null) trend = now > before ? 'up' : now < before ? 'down' : 'same'
  const good = trend === 'same' || trend === null ? null : (trend === 'up') !== !!lowerIsBetter
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      {trend && before !== null && (
        <p className={cn('flex items-center gap-1 text-xs', good === null ? 'text-text-muted' : good ? 'text-success' : 'text-danger')}>
          <Icon aria-hidden className="size-3.5" />
          {trend === 'same' ? 'Igual ao período anterior' : `${trend === 'up' ? 'Subiu' : 'Caiu'} em relação ao período anterior`}
        </p>
      )}
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </Card>
  )
}

/**
 * Receitas × despesas dos últimos 6 meses: barras agrupadas, um eixo só (R$), legenda + valor no
 * topo da barra mais recente, dica ao passar o mouse/focar e a mesma informação em tabela.
 */
function IncomeExpenseChart({ months }: { months: Performance['months'] }) {
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  // desenha na largura real do quadro: texto do gráfico fica no tamanho normal em qualquer tela
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [asTable])
  const max = Math.max(1, ...months.flatMap((m) => [m.receivedCents, m.paidCents]))
  const H = 240, padL = 64, padB = 28, padT = 20
  const plotW = W - padL - 8, plotH = H - padB - padT
  const group = plotW / months.length, bar = Math.min(28, group / 3.2)
  const y = (v: number) => padT + plotH - (v / max) * plotH
  // sem movimento (max = 1) as marcas repetiriam: fica só o zero
  const ticks = max <= 1 ? [0] : [0, 0.5, 1].map((f) => Math.round(max * f))
  const short = (c: number) => (c >= 100000_00 ? `${Math.round(c / 100000_00)} mi` : c >= 1000_00 ? `${(c / 1000_00).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : formatMoney(c))
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Receitas × despesas (6 meses, pelo dia em que o dinheiro entrou ou saiu)</h3>
        <Button size="sm" variant="ghost" icon={asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />} onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Ver gráfico' : 'Ver em tabela'}
        </Button>
      </div>
      <ul className="flex gap-4 text-xs text-text-muted" aria-label="Legenda">
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-chart-income" />Recebido</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-chart-expense" />Pago</li>
      </ul>
      {asTable ? (
        <div className="relative overflow-x-auto"><table className="w-full text-sm">
          <caption className="sr-only">Recebido e pago por mês</caption>
          <thead className="text-xs text-text-muted"><tr><th scope="col" className="py-1 text-left">Mês</th><th scope="col" className="py-1 text-right">Recebido</th><th scope="col" className="py-1 text-right">Pago</th><th scope="col" className="py-1 text-right">Saldo</th></tr></thead>
          <tbody>{months.map((m) => (
            <tr key={m.month} className="border-t border-border"><td className="py-1.5">{MONTH(m.month)}/{m.month.slice(2, 4)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(m.receivedCents)}</td><td className="py-1.5 text-right tabular-nums">{formatMoney(m.paidCents)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(m.receivedCents - m.paidCents)}</td></tr>
          ))}</tbody>
        </table></div>
      ) : (
        <div className="relative" ref={box}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`Gráfico de barras: recebido e pago nos últimos 6 meses. ${months.map((m) => `${MONTH(m.month)}: recebido ${formatMoney(m.receivedCents)}, pago ${formatMoney(m.paidCents)}`).join('; ')}.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-text-muted text-[11px]">{short(t)}</text>
              </g>
            ))}
            {months.map((m, i) => {
              const cx = padL + group * i + group / 2
              const bars = [{ v: m.receivedCents, cls: 'fill-chart-income', x: cx - bar - 1 }, { v: m.paidCents, cls: 'fill-chart-expense', x: cx + 1 }]
              return (
                <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={cx - group / 2} y={padT} width={group} height={plotH} className={cn('fill-transparent', hover === i && 'fill-surface')} />
                  {bars.map((b, k) => {
                    const h = Math.max(0, padT + plotH - y(b.v))
                    // fim arredondado em cima, base reta no eixo
                    const r = Math.min(4, h, bar / 2)
                    const top = padT + plotH - h
                    return h > 0 ? <path key={k} className={b.cls} d={`M${b.x} ${padT + plotH} V${top + r} Q${b.x} ${top} ${b.x + r} ${top} H${b.x + bar - r} Q${b.x + bar} ${top} ${b.x + bar} ${top + r} V${padT + plotH} Z`} /> : null
                  })}
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-text-muted text-[11px]">{MONTH(m.month)}</text>
                  {i === months.length - 1 && m.receivedCents > 0 && (
                    <text x={cx - bar / 2 - 1} y={y(m.receivedCents) - 5} textAnchor="middle" className="fill-text text-[10px] font-semibold">{short(m.receivedCents)}</text>
                  )}
                </g>
              )
            })}
            <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} className="stroke-border-strong" strokeWidth={1} />
          </svg>
          {hover !== null && (
            <div role="tooltip" className="pointer-events-none absolute top-0 rounded-md border border-border bg-bg px-3 py-2 text-xs shadow-pop"
              style={{ left: `${Math.min(70, Math.max(0, ((padL + group * hover) / W) * 100))}%` }}>
              <p className="mb-1 font-semibold capitalize">{new Date(months[hover].month + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p>
              <p className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-income" />Recebido <strong className="ml-auto pl-3 tabular-nums">{formatMoney(months[hover].receivedCents)}</strong></p>
              <p className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-expense" />Pago <strong className="ml-auto pl-3 tabular-nums">{formatMoney(months[hover].paidCents)}</strong></p>
              <p className="mt-1 border-t border-border pt-1 text-text-muted">Saldo <strong className="float-right pl-3 tabular-nums text-text">{formatMoney(months[hover].receivedCents - months[hover].paidCents)}</strong></p>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Painel do dia: o que pede contato hoje (aniversário, cobrança, tratamento parado). */
function TasksTab() {
  const q = useQuery({ queryKey: ['insights-tasks'], queryFn: () => get<InsightTasks>('/insights/tasks') })
  const link = (id: string, name: string, tab = '') => <Link className="text-accent-text underline-offset-2 hover:underline" to={`/pacientes/${id}${tab}`}>{name}</Link>
  if (!q.data) return <Skeleton className="mt-4 h-64 w-full" />
  const t = q.data
  const bCols: Column<InsightTasks['birthdays'][number]>[] = [
    { key: 'd', header: 'Dia', value: (r) => r.day, align: 'right', render: (r) => r.today ? <Badge tone="success"><PartyPopper aria-hidden className="size-3" />Hoje</Badge> : <span className="tabular-nums">{r.day}</span> },
    { key: 'n', header: 'Paciente', value: (r) => r.name, render: (r) => link(r.id, r.name) },
    { key: 'i', header: 'Faz', value: (r) => r.turns, align: 'right', render: (r) => `${r.turns} anos` },
    { key: 'c', header: 'Celular', value: (r) => r.phone ?? '', render: (r) => r.phone ?? '—' },
  ]
  const dCols: Column<InsightTasks['debtors'][number]>[] = [
    { key: 'n', header: 'Paciente', value: (r) => r.name, render: (r) => link(r.id, r.name, '/debitos') },
    { key: 'v', header: 'Em atraso', value: (r) => r.overdueCents, align: 'right', render: (r) => <span className="font-semibold tabular-nums text-danger">{formatMoney(r.overdueCents)}</span> },
    { key: 'd', header: 'Dias de atraso', value: (r) => r.daysLate, align: 'right' },
    { key: 'c', header: 'Celular', value: (r) => r.phone ?? '', render: (r) => r.phone ?? '—' },
  ]
  const nCols: Column<InsightTasks['withoutAppointment'][number]>[] = [
    { key: 'n', header: 'Paciente', value: (r) => r.name, render: (r) => link(r.id, r.name, '/tratamentos') },
    { key: 't', header: 'Tratamentos em aberto', value: (r) => r.openTreatments, align: 'right' },
    { key: 'u', header: 'Última consulta', value: (r) => r.lastVisit ?? '', render: (r) => (r.lastVisit ? new Date(r.lastVisit).toLocaleDateString('pt-BR') : 'Nunca atendido') },
    { key: 'c', header: 'Celular', value: (r) => r.phone ?? '', render: (r) => r.phone ?? '—' },
  ]
  const total = t.debtors.reduce((s, d) => s + d.overdueCents, 0)
  return (
    <div className="flex flex-col gap-6 pt-4">
      <section aria-labelledby="bday" className="flex flex-col gap-2">
        <h3 id="bday" className="flex items-center gap-2 text-sm font-semibold"><Cake aria-hidden className="size-4" />Aniversariantes do mês ({t.birthdays.length})</h3>
        <DataTable caption="Aniversariantes do mês" rows={t.birthdays} rowKey={(r) => r.id} columns={bCols}
          empty={<EmptyState icon={<Cake className="size-5" />} title="Ninguém faz aniversário este mês" body="Cadastre a data de nascimento dos pacientes para aparecerem aqui." />} />
      </section>
      <section aria-labelledby="debt" className="flex flex-col gap-2">
        <h3 id="debt" className="text-sm font-semibold">Inadimplência ({t.debtors.length} {t.debtors.length === 1 ? 'paciente' : 'pacientes'} · {formatMoney(total)})</h3>
        <DataTable caption="Pacientes com parcelas vencidas" rows={t.debtors} rowKey={(r) => r.id} columns={dCols}
          empty={<EmptyState icon={<BarChart3 className="size-5" />} title="Nenhuma parcela vencida" body="Todos os pacientes estão em dia." />} />
      </section>
      <section aria-labelledby="novisit" className="flex flex-col gap-2">
        <h3 id="novisit" className="text-sm font-semibold">Tratamento em aberto sem consulta marcada ({t.withoutAppointment.length})</h3>
        <DataTable caption="Pacientes com tratamento em aberto e sem consulta marcada" rows={t.withoutAppointment} rowKey={(r) => r.id} columns={nCols}
          empty={<EmptyState icon={<BarChart3 className="size-5" />} title="Todos com consulta marcada" body="Quem tem tratamento em aberto já tem a próxima consulta." />} />
      </section>
    </div>
  )
}

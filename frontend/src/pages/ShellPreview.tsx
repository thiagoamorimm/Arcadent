import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { AppShell } from '../domain/AppShell'
import { WeekGrid, type AgendaItem } from '../domain/Agenda'
import { Button, IconButton } from '../ui/Button'
import { Select } from '../ui/Field'
import { useToast } from '../ui/Feedback'

const DAYS = [
  { label: 'seg.', date: '26' }, { label: 'ter.', date: '27' }, { label: 'qua.', date: '28' },
  { label: 'qui.', date: '29' }, { label: 'sex.', date: '30' }, { label: 'sáb.', date: '31' },
]
const ITEMS: AgendaItem[] = [
  { id: 'a', day: 0, start: '08:30', end: '09:15', kind: 'consulta', title: 'Marina Lopes', detail: 'Avaliação', status: 'atendido', label: 1 },
  { id: 'b', day: 0, start: '10:00', end: '11:00', kind: 'consulta', title: 'João Pedro Alves', detail: 'Canal 46', status: 'atendido', label: 4 },
  { id: 'c', day: 1, start: '09:00', end: '09:30', kind: 'consulta', title: 'Beatriz Nogueira', detail: 'Manutenção orto', status: 'faltou', label: 5 },
  { id: 'd', day: 2, start: '12:00', end: '13:30', kind: 'bloqueio', title: 'Almoço' },
  { id: 'e', day: 3, start: '14:00', end: '15:00', kind: 'consulta', title: 'Carlos Henrique Dias', detail: 'Restauração 16', status: 'em_atendimento', label: 2 },
  { id: 'f', day: 3, start: '15:15', end: '15:45', kind: 'consulta', title: 'Lia Martins', detail: 'Limpeza', status: 'aguardando', label: 6 },
  { id: 'g', day: 3, start: '16:00', end: '16:45', kind: 'consulta', title: 'Rafael Souza', detail: 'Clareamento', status: 'confirmado', label: 3 },
  { id: 'h', day: 4, start: '09:00', end: '10:30', kind: 'consulta', title: 'Paula Reis', detail: 'Implante', status: 'agendado', label: 7 },
  { id: 'i', day: 5, start: '08:00', end: '12:00', kind: 'bloqueio', title: 'Congresso' },
]

export function ShellPreview() {
  const toast = useToast()
  return (
    <AppShell clinic="Clínica Exemplo" user="Ana Prado" title="Agenda" trialDaysLeft={6}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select aria-label="Profissional" defaultValue="ana">
            <option value="ana">Dra. Ana Prado</option>
            <option value="todos">Todos os profissionais</option>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Semana anterior" variant="secondary"><ChevronLeft className="size-4" /></IconButton>
          <Button variant="secondary">Hoje</Button>
          <IconButton label="Próxima semana" variant="secondary"><ChevronRight className="size-4" /></IconButton>
        </div>
        <p className="text-sm font-semibold">26 – 31 de outubro de 2026</p>
        <div className="ml-auto inline-flex rounded-md border border-border-strong p-0.5" role="radiogroup" aria-label="Visualização">
          {['Dia', 'Semana', 'Cadeiras'].map((v) => (
            <button key={v} role="radio" aria-checked={v === 'Semana'} className={v === 'Semana' ? 'h-8 rounded-sm bg-accent px-3 text-sm text-on-accent' : 'h-8 rounded-sm px-3 text-sm hover:bg-surface'}>{v}</button>
          ))}
        </div>
        <Button icon={<Plus className="size-4" />}>Nova consulta</Button>
      </div>
      <WeekGrid
        days={DAYS}
        items={ITEMS}
        todayIndex={3}
        nowMinutes={15 * 60 + 5}
        onSlotClick={(d, t) => toast('success', `Nova consulta: ${DAYS[d].label} ${DAYS[d].date} às ${t}`)}
      />
    </AppShell>
  )
}

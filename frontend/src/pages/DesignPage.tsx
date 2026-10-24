import { CalendarPlus, MoreHorizontal, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Odontogram, type Selection } from '../domain/Odontogram'
import { AppointmentCard } from '../domain/Agenda'
import { Badge, StatusBadge, statusMeta, type AppointmentStatus } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { Checkbox, Switch } from '../ui/Choice'
import { DataTable } from '../ui/DataTable'
import { Avatar, Card, EmptyState, Kpi, Skeleton, useToast } from '../ui/Feedback'
import { Field, Input, MoneyInput, Select, Textarea } from '../ui/Field'
import { ConfirmDialog, Drawer, MenuButton, Modal, Tabs, Tooltip } from '../ui/Overlay'
import { formatMoney } from '../ui/cn'

const COLORS = [
  'bg', 'surface', 'surface-sunken', 'border', 'border-strong', 'border-input', 'text', 'text-muted',
  'accent', 'accent-hover', 'accent-soft', 'danger', 'danger-soft', 'success', 'success-soft',
  'warning', 'warning-soft', 'info', 'info-soft', 'tooth-planned', 'tooth-done',
]

type Patient = { id: string; name: string; phone: string; lastVisit: string; balance: number }
const PATIENTS: Patient[] = [
  { id: '1', name: 'Marina Lopes', phone: '(48) 99812-3301', lastVisit: '2026-10-02', balance: 45000 },
  { id: '2', name: 'Carlos Henrique Dias', phone: '(48) 98455-1029', lastVisit: '2026-09-18', balance: 0 },
  { id: '3', name: 'Beatriz Nogueira', phone: '(48) 99120-7754', lastVisit: '2026-10-20', balance: 12000 },
  { id: '4', name: 'João Pedro Alves', phone: '(48) 99677-0042', lastVisit: '2026-08-30', balance: 98000 },
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6">
      <h2 id={`${id}-h`} className="mb-4 text-lg font-semibold">{title}</h2>
      <Card className="p-6">{children}</Card>
    </section>
  )
}

export function DesignPage() {
  const toast = useToast()
  const [modal, setModal] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [tab, setTab] = useState('orcamentos')
  const [check, setCheck] = useState(true)
  const [sw, setSw] = useState(false)
  const [money, setMoney] = useState(25000)
  const [sel, setSel] = useState<Selection>({ 16: ['O', 'M'], 21: [] })

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">Design system</p>
          <h1 className="text-xl font-bold">Primitivos do app</h1>
          <p className="mt-1 text-sm text-text-muted">Tokens próprios · cor de destaque provisória até o rebrand · contraste AA em todos os pares.</p>
        </div>
        <Link to="/design/shell" className="text-sm font-semibold text-accent-text underline underline-offset-2">Ver a moldura do app com a agenda →</Link>
      </header>

      <Section id="cores" title="Cores (papéis)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {COLORS.map((c) => (
            <div key={c} className="flex flex-col gap-1">
              <div className="h-12 rounded-md border border-border" style={{ background: `var(--c-${c})` }} />
              <code className="text-xs text-text-muted">{c}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section id="tipo" title="Tipografia">
        <div className="flex flex-col gap-2">
          <p className="text-display font-bold">Display 40</p>
          <p className="text-xl font-bold">Título de página 28</p>
          <p className="text-lg font-semibold">Título de seção 20</p>
          <p className="text-base">Texto de leitura 16 — fichas e documentos.</p>
          <p className="text-sm">Texto de interface 14 — tabelas, formulários, botões.</p>
          <p className="text-xs font-medium text-text-muted">Legenda 12 — rótulos e ajuda.</p>
          <p className="text-sm tabular-nums">Números tabulares: {formatMoney(123456)} · {formatMoney(9900)}</p>
        </div>
      </Section>

      <Section id="botoes" title="Botões">
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<Plus className="size-4" />}>Nova consulta</Button>
          <Button variant="secondary">Cancelar</Button>
          <Button variant="ghost">Ver detalhes</Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />}>Excluir</Button>
          <Button loading>Salvando</Button>
          <Button disabled>Indisponível</Button>
          <Button size="sm">Pequeno</Button>
          <Button size="lg">Grande</Button>
          <Tooltip content="Editar paciente"><IconButton label="Editar paciente"><Pencil className="size-4" /></IconButton></Tooltip>
          <IconButton label="Mais ações" variant="secondary"><MoreHorizontal className="size-4" /></IconButton>
        </div>
      </Section>

      <Section id="form" title="Formulário">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome do paciente" required hint="Só o nome é obrigatório para começar.">
            <Input placeholder="Ex.: Maria da Silva" />
          </Field>
          <Field label="Celular" error="Informe DDD + número, ex.: (48) 99999-0000">
            <Input defaultValue="9999" inputMode="tel" />
          </Field>
          <Field label="Tabela de preço">
            <Select defaultValue="particular">
              <option value="particular">Particular</option>
              <option value="convenio-a">Convênio A</option>
            </Select>
          </Field>
          <Field label="Valor">
            <MoneyInput value={money} onValueChange={setMoney} />
          </Field>
          <Field label="Observações" className="md:col-span-2">
            <Textarea placeholder="Alergias, preferências de horário…" />
          </Field>
          <Field label="Desabilitado">
            <Input disabled value="Somente leitura" readOnly />
          </Field>
          <div className="flex flex-col justify-end gap-3">
            <Checkbox label="Paciente estrangeiro" checked={check} onCheckedChange={setCheck} />
            <Switch label="Enviar confirmação automática" checked={sw} onCheckedChange={setSw} />
          </div>
        </div>
      </Section>

      <Section id="status" title="Status, rótulos e badges">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(statusMeta) as AppointmentStatus[]).map((s) => <StatusBadge key={s} status={s} />)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Neutro</Badge><Badge tone="accent">Orto</Badge><Badge tone="success">Pago</Badge>
            <Badge tone="warning">Vence hoje</Badge><Badge tone="danger">Em atraso</Badge><Badge tone="info">Convênio</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((l) => (
              <div key={l} className="h-16">
                <AppointmentCard item={{ id: String(l), day: 0, start: '09:00', end: '09:45', kind: 'consulta', title: 'Marina Lopes', detail: 'Limpeza', status: 'confirmado', label: l }} />
              </div>
            ))}
            <div className="h-16"><AppointmentCard item={{ id: 'b', day: 0, start: '12:00', end: '13:00', kind: 'bloqueio', title: 'Almoço' }} /></div>
            <div className="h-16"><AppointmentCard item={{ id: 'c', day: 0, start: '14:00', end: '14:30', kind: 'consulta', title: 'Carlos Dias', status: 'faltou', label: 2 }} /></div>
          </div>
        </div>
      </Section>

      <Section id="odontograma" title="Odontograma">
        <Tabs
          label="Modos do odontograma"
          value={tab === 'tratamentos' ? 'tratamentos' : 'orcamentos'}
          onValueChange={setTab}
          tabs={[
            {
              value: 'orcamentos', label: 'Montar orçamento', content: (
                <div className="flex flex-col gap-3">
                  <Odontogram mode="select" selection={sel} onSelectionChange={setSel} marks={{ 36: { done: 'all' } }} />
                  <p className="text-sm text-text-muted">
                    Selecionado: {Object.entries(sel).map(([t, f]) => `${t}${f.length ? ' (' + f.join('') + ')' : ''}`).join(', ') || 'nada'}
                    {' '}· Clique nas faces ou use Tab + M/D/O/V/L.
                  </p>
                </div>
              ),
            },
            {
              value: 'tratamentos', label: 'Acompanhar', count: 4, content: (
                <Odontogram mode="view" marks={{ 16: { planned: ['O', 'M'] }, 11: { done: ['V'] }, 26: { planned: 'all', note: true }, 46: { done: 'all' } }} />
              ),
            },
          ]}
        />
      </Section>

      <Section id="tabela" title="Tabela (filtro ▾ e ordenação em toda coluna)">
        <DataTable
          caption="Pacientes"
          rows={PATIENTS}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', header: 'Paciente', value: (r) => r.name, render: (r) => <span className="flex items-center gap-2"><Avatar name={r.name} size={24} />{r.name}</span> },
            { key: 'phone', header: 'Celular', value: (r) => r.phone },
            { key: 'last', header: 'Última consulta', value: (r) => r.lastVisit, render: (r) => new Date(r.lastVisit + 'T12:00').toLocaleDateString('pt-BR') },
            { key: 'bal', header: 'Saldo devedor', align: 'right', value: (r) => r.balance, render: (r) => r.balance ? <span className="text-danger">{formatMoney(r.balance)}</span> : <Badge tone="success">Em dia</Badge> },
          ]}
          empty={<EmptyState icon={<Search className="size-5" />} title="Nenhum paciente encontrado" body="Nenhum cadastro bate com os filtros. Ajuste ou limpe os filtros das colunas." />}
        />
      </Section>

      <Section id="vazio" title="Estados vazio e carregando">
        <div className="grid gap-6 md:grid-cols-2">
          <EmptyState
            icon={<Users className="size-5" />}
            title="Sua lista de pacientes está vazia"
            body="Cadastre o primeiro paciente ou importe sua planilha. Só o nome é obrigatório."
            action={<Button icon={<Plus className="size-4" />}>Cadastrar paciente</Button>}
          />
          <div className="flex flex-col gap-3 p-6" aria-busy="true" aria-label="Carregando">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </Section>

      <Section id="kpi" title="Indicadores">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Consultas na semana" value="48" hint="6 a mais que a anterior" />
          <Kpi label="Taxa de faltas" value="7,5%" hint="meta: abaixo de 10%" />
          <Kpi label="Orçamentos aprovados" value="62%" />
          <Kpi label="Recebido no mês" value={formatMoney(1843200)} />
        </div>
      </Section>

      <Section id="sobreposicao" title="Modal, painel, menu, confirmação e aviso">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setModal(true)} icon={<CalendarPlus className="size-4" />}>Abrir modal</Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>Abrir painel lateral</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>Excluir consulta</Button>
          <Button variant="secondary" onClick={() => toast('success', 'Consulta marcada para ter., 28/10 às 09:00.')}>Aviso de sucesso</Button>
          <Button variant="secondary" onClick={() => toast('danger', 'Esse horário acabou de ser ocupado. Escolha outro.')}>Aviso de erro</Button>
          <MenuButton
            trigger={<Button variant="secondary" icon={<MoreHorizontal className="size-4" />}>Menu</Button>}
            items={[
              { label: 'Editar', onSelect: () => {}, icon: <Pencil className="size-4" /> },
              { label: 'Duplicar', onSelect: () => {} },
              { label: 'Excluir', onSelect: () => setConfirm(true), danger: true, icon: <Trash2 className="size-4" /> },
            ]}
          />
        </div>
        <Modal
          open={modal}
          onOpenChange={setModal}
          title="Nova consulta"
          description="Escolha o paciente, o horário e o profissional."
          footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button><Button onClick={() => { setModal(false); toast('success', 'Consulta marcada.') }}>Marcar</Button></>}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paciente" required className="sm:col-span-2"><Input placeholder="Buscar por nome, CPF ou celular" /></Field>
            <Field label="Data"><Input type="date" defaultValue="2026-10-28" /></Field>
            <Field label="Horário"><Input type="time" defaultValue="09:00" /></Field>
          </div>
        </Modal>
        <Drawer open={drawer} onOpenChange={setDrawer} title="Marina Lopes">
          <p className="text-sm text-text-muted">Resumo rápido do paciente: próxima consulta, alertas e saldo.</p>
        </Drawer>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Excluir esta consulta?"
          body={<>A consulta de <strong>Marina Lopes</strong> em 28/10 às 09:00 sai da agenda. Essa ação fica registrada no histórico.</>}
          confirmLabel="Excluir consulta"
          onConfirm={() => { setConfirm(false); toast('success', 'Consulta excluída.') }}
        />
      </Section>
    </div>
  )
}

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../../api/client'
import type { Team } from '../../api/types'
import { useClinic } from '../../lib/useClinic'
import { dateTimeIn } from '../../lib/tz'
import { Button } from '../../ui/Button'
import { DataTable, type Column } from '../../ui/DataTable'
import { EmptyState, Skeleton } from '../../ui/Feedback'
import { Field, Select } from '../../ui/Field'
import { SettingsLayout } from './SettingsLayout'

interface Entry {
  id: number; at: string; action: string; entity: string; entityId: string | null; userId: string | null; userName: string | null
  label: string | null; patientId: string | null; patientName: string | null; diff: string | null
}
interface AuditPage { items: Entry[]; nextBefore: number | null }

/** Texto de cada ação registrada (o código fica estável no banco; o texto é da tela). */
const ACTION: Record<string, string> = {
  'patient.view': 'Abriu a ficha', 'patient.update': 'Editou os dados do paciente',
  'anamnesis.complete': 'Concluiu anamnese', 'evolution.edit': 'Corrigiu evolução', 'evolution.delete': 'Excluiu evolução',
  'document.issue': 'Emitiu documento', 'file.delete': 'Removeu arquivo', 'tooth_note.delete': 'Apagou anotação de dente',
  'treatment.create': 'Lançou tratamento', 'treatment.cancel': 'Cancelou tratamento', 'treatment.update': 'Editou tratamento',
  'treatment.finish': 'Finalizou tratamento', 'treatment.delete': 'Excluiu tratamento',
  'budget.approve': 'Aprovou orçamento', 'budget.approve_partial': 'Aprovou orçamento em parte', 'budget.reject': 'Reprovou orçamento',
  'debit.create': 'Lançou débito', 'debit.cancel': 'Cancelou débito', 'payment.create': 'Registrou recebimento', 'payment.cancel': 'Cancelou recebimento',
  'receipt.issue': 'Emitiu recibo', 'receipt.cancel': 'Cancelou recibo', 'income.create': 'Lançou receita sem vínculo',
  'expense.create': 'Lançou despesa', 'expense.update': 'Editou despesa', 'expense.pay': 'Pagou despesa', 'expense.unpay': 'Desfez pagamento de despesa', 'expense.delete': 'Excluiu despesa',
  'appointment.delete': 'Excluiu consulta', 'clinic.update': 'Alterou dados da clínica',
  'team.invite': 'Convidou alguém', 'team.invite_revoke': 'Cancelou convite', 'team.update': 'Alterou acesso de alguém', 'team.join': 'Entrou na equipe',
}
const GROUPS: [string, string][] = [
  ['', 'Tudo'], ['patient.view', 'Fichas abertas'], ['patient.', 'Cadastro de pacientes'], ['evolution.', 'Evoluções'],
  ['budget.', 'Orçamentos'], ['treatment.', 'Tratamentos'], ['payment.', 'Recebimentos'], ['debit.', 'Débitos'], ['receipt.', 'Recibos'],
  ['expense.', 'Despesas'], ['team.', 'Equipe'],
]
const PERIODS: [number, string][] = [[1, 'Hoje'], [7, 'Últimos 7 dias'], [30, 'Últimos 30 dias'], [90, 'Últimos 90 dias'], [0, 'Tudo']]
const ymdAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10) }

/** Ajustes > Auditoria: quem fez o quê e quem abriu cada ficha (LGPD). Só leitura. */
export function AuditSettings() {
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const team = useQuery({ queryKey: ['team'], queryFn: () => get<Team>('/team') })
  const [days, setDays] = useState(7)
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const params = new URLSearchParams()
  if (days) params.set('from', ymdAgo(days))
  if (userId) params.set('userId', userId)
  if (action) params.set('action', action)
  const q = useInfiniteQuery({
    queryKey: ['audit', days, userId, action],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => get<AuditPage>(`/audit?${params}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextBefore,
  })
  const rows = q.data?.pages.flatMap((p) => p.items) ?? []
  const columns: Column<Entry>[] = [
    { key: 'at', header: 'Quando', value: (r) => r.at, render: (r) => <span className="whitespace-nowrap tabular-nums">{dateTimeIn(r.at, tz)}</span> },
    { key: 'who', header: 'Quem', value: (r) => r.userName ?? '—', render: (r) => <span className="whitespace-nowrap">{r.userName ?? '—'}</span> },
    { key: 'what', header: 'O quê', value: (r) => ACTION[r.action] ?? r.action },
    {
      key: 'patient', header: 'Paciente', value: (r) => r.patientName ?? '',
      render: (r) => r.patientId ? <Link className="text-accent-text underline-offset-2 hover:underline" to={`/pacientes/${r.patientId}`}>{r.patientName}</Link> : '—',
    },
    { key: 'detail', header: 'Detalhe', value: (r) => r.label ?? '', render: (r) => <span className="text-text-muted">{r.label ?? ''}</span> },
  ]
  return (
    <SettingsLayout title="Auditoria" description="Registro de quem fez o quê na clínica, inclusive quem abriu cada ficha. Ninguém consegue alterar ou apagar este registro.">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Período"><Select value={days} onChange={(e) => setDays(Number(e.target.value))}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Pessoa">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todas</option>
            {team.data?.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Tipo"><Select value={action} onChange={(e) => setAction(e.target.value)}>{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      </div>
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : (
        <>
          <DataTable caption="Trilha de auditoria" columns={columns} rows={rows} rowKey={(r) => String(r.id)}
            empty={<EmptyState icon={<ShieldCheck className="size-5" />} title="Nada registrado" body="Nenhuma ação com esses filtros no período." />} />
          {q.hasNextPage && <div className="mt-3"><Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Carregar mais</Button></div>}
        </>
      )}
    </SettingsLayout>
  )
}

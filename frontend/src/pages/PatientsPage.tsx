import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, get, post } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Page as PageT, Patient, PatientRow } from '../api/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Choice'
import { DataTable } from '../ui/DataTable'
import { Avatar, EmptyState, Skeleton } from '../ui/Feedback'
import { Field, Input, Textarea, EnterSubmits } from '../ui/Field'
import { Modal } from '../ui/Overlay'
import { formatMoney } from '../ui/cn'
import { Page } from './Layout'

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

/** S10 — Lista de pacientes: busca no servidor + filtro/ordenação por coluna. */
export function PatientsPage() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [creating, setCreating] = useState(false)
  const canEdit = useAuth().can('paciente.edit')
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const list = useQuery({
    queryKey: ['patients', 'list', debounced],
    queryFn: () => get<PageT<PatientRow>>(`/patients?size=200&q=${encodeURIComponent(debounced)}`),
  })

  const noneAtAll = list.isSuccess && list.data.total === 0 && !debounced

  return (
    <Page title="Pacientes" actions={canEdit ? <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo paciente</Button> : undefined}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input aria-label="Buscar paciente" placeholder="Buscar por nome, celular ou CPF" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.isSuccess && <span className="text-sm text-text-muted">{list.data.total} {list.data.total === 1 ? 'paciente' : 'pacientes'}</span>}
      </div>

      {list.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Carregando pacientes">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}
      {list.isError && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          Não foi possível carregar os pacientes. <button className="underline" onClick={() => list.refetch()}>Tentar de novo</button>
        </p>
      )}
      {noneAtAll && (
        <div className="rounded-lg border border-border bg-bg">
          <EmptyState
            icon={<Users className="size-5" />}
            title="Sua lista de pacientes está vazia"
            body="Cadastre o primeiro paciente aqui ou direto ao marcar uma consulta na agenda. Só o nome é obrigatório."
            action={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Cadastrar paciente</Button>}
          />
        </div>
      )}
      {list.isSuccess && !noneAtAll && (
        <DataTable
          caption="Pacientes da clínica"
          rows={list.data.items}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'name', header: 'Paciente', value: (r) => r.name,
              render: (r) => (
                <Link to={`/pacientes/${r.id}`} className="flex items-center gap-2 font-medium hover:text-accent-text hover:underline">
                  <Avatar name={r.name} size={28} /><span className="max-w-[28ch] truncate">{r.name}</span>
                </Link>
              ),
            },
            { key: 'phone', header: 'Celular', value: (r) => r.phone ?? '' , render: (r) => r.phone ?? '—' },
            { key: 'next', header: 'Próxima consulta', value: (r) => r.nextVisit ?? '', render: (r) => fmtDate(r.nextVisit) },
            { key: 'last', header: 'Último atendimento', value: (r) => r.lastVisit ?? '', render: (r) => fmtDate(r.lastVisit) },
            {
              key: 'bal', header: 'Saldo devedor', align: 'right', value: (r) => r.balanceCents,
              render: (r) => (r.balanceCents ? <span className="text-danger">{formatMoney(r.balanceCents)}</span> : <Badge tone="success">Em dia</Badge>),
            },
          ]}
          empty={<EmptyState icon={<Search className="size-5" />} title="Ninguém encontrado" body="Nenhum paciente bate com a busca ou com os filtros das colunas." />}
        />
      )}
      {creating && <NewPatientModal onClose={() => setCreating(false)} />}
    </Page>
  )
}

function NewPatientModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [f, setF] = useState({ name: '', phone: '', cpf: '', birthDate: '', email: '', notes: '' })
  const [foreign, setForeign] = useState(false)
  const [touched, setTouched] = useState(false)
  const save = useMutation({
    mutationFn: () => post<Patient>('/patients', { ...f, birthDate: f.birthDate || undefined, isForeign: foreign }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['patients'] }); nav(`/pacientes/${p.id}`) },
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const submit = () => { setTouched(true); if (f.name.trim()) save.mutate() }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title="Novo paciente" description="Só o nome é obrigatório. O resto dá para completar depois."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={submit}>Salvar e abrir ficha</Button></>}
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        {save.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{save.error instanceof ApiError ? save.error.message : 'Não foi possível salvar.'}</p>}
        <Field label="Nome completo" required className="sm:col-span-2" error={touched && !f.name.trim() ? 'Informe o nome do paciente.' : undefined}>
          <Input value={f.name} onChange={set('name')} data-autofocus />
        </Field>
        <Field label="Celular" hint="Usado para confirmar consultas."><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Data de nascimento"><Input type="date" value={f.birthDate} onChange={set('birthDate')} /></Field>
        <Field label={foreign ? 'Documento' : 'CPF'}><Input value={f.cpf} onChange={set('cpf')} inputMode={foreign ? 'text' : 'numeric'} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <div className="sm:col-span-2"><Checkbox label="Paciente estrangeiro (documento e telefone de outro país)" checked={foreign} onCheckedChange={setForeign} /></div>
        <Field label="Observações" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  )
}

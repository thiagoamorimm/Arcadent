import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, get, patch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Budget, Debit, Patient, Treatment } from '../api/types'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Choice'
import { Avatar, Card, EmptyState, Skeleton, useToast } from '../ui/Feedback'
import { Field, Input, Textarea } from '../ui/Field'
import { Tabs } from '../ui/Overlay'
import { formatMoney } from '../ui/cn'
import { Page } from './Layout'
import { AnamnesisTab } from './patient/AnamnesisTab'
import { BudgetsTab } from './patient/BudgetsTab'
import { DebitsTab } from './patient/DebitsTab'
import { TreatmentsTab } from './patient/TreatmentsTab'
import { DocumentsTab } from './patient/DocumentsTab'
import { EvolutionsTab } from './patient/EvolutionsTab'
import { FilesTab } from './patient/FilesTab'


/** S11 — Ficha do paciente com abas. */
export function PatientPage() {
  const { id = '', tab = 'resumo' } = useParams()
  const nav = useNavigate()
  const { can } = useAuth()
  // Prontuário clínico (anamnese, evoluções, documentos, imagens): só quem atende.
  const clinical = ['paciente.anamnesis', 'paciente.treatments', 'paciente.documents', 'paciente.files', 'paciente.evolution_edit'].some(can)
  const patient = useQuery({ queryKey: ['patient', id], queryFn: () => get<Patient>(`/patients/${id}`) })
  const budgets = useQuery({ queryKey: ['budgets', id], queryFn: () => get<Budget[]>(`/patients/${id}/budgets`), enabled: can('paciente.budgets') })
  const treatments = useQuery({ queryKey: ['treatments', id], queryFn: () => get<Treatment[]>(`/patients/${id}/treatments`) })
  const debits = useQuery({ queryKey: ['debits', id], queryFn: () => get<Debit[]>(`/patients/${id}/debits`), enabled: can('fin.debits_view') })

  if (patient.isError) {
    return (
      <Page title="Paciente">
        <EmptyState icon={<AlertTriangle className="size-5" />} title="Paciente não encontrado"
          body="Ele pode ter sido removido ou o link está incorreto." action={<Button variant="secondary" onClick={() => nav('/pacientes')}>Voltar para a lista</Button>} />
      </Page>
    )
  }
  const p = patient.data
  return (
    <Page title={p?.name ?? 'Paciente'}>
      {!p ? (
        <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-wrap items-center gap-4 p-4">
            <Avatar name={p.name} size={48} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-lg font-semibold">{p.name}</p>
              <p className="text-sm text-text-muted">{[p.phone, p.birthDate && `${age(p.birthDate)} anos`].filter(Boolean).join(' · ') || 'Sem celular cadastrado'}</p>
            </div>
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div><dt className="text-xs text-text-muted">Próxima consulta</dt><dd className="font-medium">{p.nextVisit ? new Date(p.nextVisit).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</dd></div>
              <div><dt className="text-xs text-text-muted">Tratamentos em aberto</dt><dd className="font-medium tabular-nums">{p.openTreatments}</dd></div>
              <div><dt className="text-xs text-text-muted">Saldo devedor</dt><dd className={p.balanceCents ? 'font-semibold text-danger tabular-nums' : 'font-medium tabular-nums'}>{formatMoney(p.balanceCents)}</dd></div>
            </dl>
          </Card>
          {p.clinicalAlerts?.length > 0 && clinical && (
            <div role="note" aria-label="Alertas clínicos" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger bg-danger-soft px-4 py-2.5">
              <AlertTriangle aria-hidden className="size-4 text-danger" />
              <span className="text-sm font-semibold text-danger">Atenção:</span>
              {p.clinicalAlerts.map((a) => <span key={a} className="rounded-pill bg-bg px-2 py-0.5 text-sm font-medium text-danger">{a}</span>)}
            </div>
          )}
          <Card className="p-4">
            <Tabs
              label="Ficha do paciente"
              value={tab}
              onValueChange={(v) => nav(`/pacientes/${id}/${v}`, { replace: true })}
              tabs={[
                { value: 'resumo', label: 'Dados', content: <PatientForm patient={p} readOnly={!can('paciente.edit')} /> },
                ...(can('paciente.budgets') ? [{ value: 'orcamentos', label: 'Orçamentos', count: budgets.data?.length, content: <BudgetsTab patientId={id} budgets={budgets.data} loading={budgets.isLoading} /> }] : []),
                ...(can('paciente.anamnesis') ? [{ value: 'anamnese', label: 'Anamnese', content: <AnamnesisTab patientId={id} /> }] : []),
                { value: 'tratamentos', label: 'Tratamentos', count: treatments.data?.filter((t) => t.status === 'open').length, content: <TreatmentsTab patientId={id} treatments={treatments.data} loading={treatments.isLoading} /> },
                ...(clinical ? [
                  { value: 'evolucoes', label: 'Evoluções', content: <EvolutionsTab patientId={id} /> },
                  { value: 'documentos', label: 'Documentos', content: <DocumentsTab patientId={id} /> },
                  { value: 'imagens', label: 'Imagens', content: <FilesTab patientId={id} /> },
                ] : []),
                ...(can('fin.debits_view') ? [{ value: 'debitos', label: 'Débitos', count: debits.data?.filter((d) => d.status !== 'paid').length, content: <DebitsTab patientId={id} debits={debits.data} loading={debits.isLoading} guardian={p.guardian} /> }] : []),
              ]}
            />
          </Card>
        </div>
      )}
    </Page>
  )
}

function age(birth: string) {
  const b = new Date(birth + 'T12:00'), n = new Date()
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
}

function PatientForm({ patient, readOnly }: { patient: Patient; readOnly?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({
    name: patient.name, phone: patient.phone ?? '', cpf: patient.cpf ?? '', birthDate: patient.birthDate ?? '',
    email: patient.email ?? '', notes: patient.notes ?? '',
  })
  const [foreign, setForeign] = useState(patient.isForeign)
  const [g, setG] = useState({ name: patient.guardian?.name ?? '', cpf: patient.guardian?.cpf ?? '', phone: patient.guardian?.phone ?? '', relation: patient.guardian?.relation ?? '' })
  const minor = !!f.birthDate && age(f.birthDate) < 18
  const [showGuardian, setShowGuardian] = useState(!!patient.guardian)
  const guardianOpen = showGuardian || minor
  const guardianMissing = guardianOpen && !g.name.trim() && (g.cpf.trim() || g.phone.trim() || g.relation.trim())
  const save = useMutation({
    mutationFn: () => patch<Patient>(`/patients/${patient.id}`, { ...f, birthDate: f.birthDate || null, isForeign: foreign, guardian: guardianOpen && g.name.trim() ? g : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient', patient.id] }); qc.invalidateQueries({ queryKey: ['patients'] }); toast('success', 'Dados do paciente salvos.') },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="grid max-w-3xl gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (f.name.trim() && !guardianMissing && !readOnly) save.mutate() }}>
      <fieldset disabled={readOnly} className="contents">
      <Field label="Nome completo" required className="sm:col-span-2" error={!f.name.trim() ? 'Informe o nome.' : undefined}><Input value={f.name} onChange={set('name')} /></Field>
      <Field label="Celular"><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
      <Field label="Data de nascimento"><Input type="date" value={f.birthDate} onChange={set('birthDate')} /></Field>
      <Field label={foreign ? 'Documento' : 'CPF'}><Input value={f.cpf} onChange={set('cpf')} /></Field>
      <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
      <div className="sm:col-span-2"><Checkbox label="Paciente estrangeiro" checked={foreign} onCheckedChange={setForeign} /></div>
      <fieldset className="grid gap-4 rounded-md border border-border p-3 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-xs font-semibold">Responsável</legend>
        {minor
          ? <p className="text-xs text-text-muted sm:col-span-2">Paciente menor de idade: informe quem responde por ele. O recibo pode sair no nome do responsável.</p>
          : <div className="sm:col-span-2"><Checkbox label="Tem responsável (quem acompanha ou paga)" checked={showGuardian} onCheckedChange={setShowGuardian} /></div>}
        {guardianOpen && (
          <>
            <Field label="Nome do responsável" className="sm:col-span-2" error={guardianMissing ? 'Informe o nome (ou apague os outros campos).' : undefined}>
              <Input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
            </Field>
            <Field label="Parentesco"><Input value={g.relation} placeholder="Ex.: mãe, pai, filho" onChange={(e) => setG({ ...g, relation: e.target.value })} /></Field>
            <Field label="CPF do responsável"><Input value={g.cpf} onChange={(e) => setG({ ...g, cpf: e.target.value })} /></Field>
            <Field label="Celular do responsável"><Input inputMode="tel" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} /></Field>
          </>
        )}
      </fieldset>
      <Field label="Observações" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      {!readOnly && <div className="sm:col-span-2"><Button type="submit" loading={save.isPending}>Salvar alterações</Button></div>}
      </fieldset>
    </form>
  )
}

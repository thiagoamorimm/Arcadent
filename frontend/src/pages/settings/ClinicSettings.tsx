import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, patch } from '../../api/client'
import type { Clinic } from '../../api/types'
import { HoursEditor, hoursProblem } from '../../domain/HoursEditor'
import { BR_TIMEZONES, partsIn, hm } from '../../lib/tz'
import { useClinic } from '../../lib/useClinic'
import { Button } from '../../ui/Button'
import { Card, Skeleton, useToast } from '../../ui/Feedback'
import { Field, Input, Select } from '../../ui/Field'
import { SettingsLayout } from './SettingsLayout'

/** S28 — Dados da clínica, fuso horário e expediente. */
export function ClinicSettings() {
  const clinic = useClinic()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState<Clinic | null>(null)
  useEffect(() => { if (clinic.data && !f) setF(clinic.data) }, [clinic.data, f])
  const save = useMutation({
    mutationFn: () => patch<Clinic>('/clinic', f),
    onSuccess: (c) => {
      qc.setQueryData(['clinic'], c)
      qc.invalidateQueries({ queryKey: ['me'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      toast('success', 'Dados da clínica salvos.')
    },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })
  if (!f) return <SettingsLayout title="Clínica"><Skeleton className="h-96 w-full" /></SettingsLayout>
  const tzKnown = BR_TIMEZONES.some(([z]) => z === f.timezone)
  const nowThere = hm(partsIn(new Date(), f.timezone).minutes)
  const invalid = !f.name.trim() || hoursProblem(f.businessHours)

  return (
    <SettingsLayout title="Clínica" description="Dados que aparecem nos documentos, fuso horário e expediente da agenda.">
      <form className="flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Nome da clínica" required className="sm:col-span-2" error={!f.name.trim() ? 'Informe o nome.' : undefined}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Telefone"><Input inputMode="tel" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="CPF ou CNPJ"><Input value={f.document ?? ''} onChange={(e) => setF({ ...f, document: e.target.value })} /></Field>
        </Card>

        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Fuso horário" hint={`Agora na clínica: ${nowThere}. Toda a agenda e os lembretes usam este fuso, não o do computador de quem acessa.`}>
            <Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {!tzKnown && <option value={f.timezone}>{f.timezone}</option>}
              {BR_TIMEZONES.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Intervalo da grade" hint="De quanto em quanto tempo os horários aparecem para marcar.">
            <Select value={f.slotMinutes} onChange={(e) => setF({ ...f, slotMinutes: Number(e.target.value) })}>
              {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
            </Select>
          </Field>
        </Card>

        <section aria-labelledby="exp-h">
          <h3 id="exp-h" className="mb-1 text-base font-semibold">Expediente da clínica</h3>
          <p className="mb-3 text-sm text-text-muted">Fora destes horários a agenda aparece em cinza. Quem atende pode ter um horário próprio em Equipe; sem horário próprio, segue este.</p>
          <HoursEditor value={f.businessHours} onChange={(h) => setF({ ...f, businessHours: h })} />
        </section>

        <div><Button type="submit" size="lg" loading={save.isPending} disabled={invalid}>Salvar</Button></div>
      </form>
    </SettingsLayout>
  )
}

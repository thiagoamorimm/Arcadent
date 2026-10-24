import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, History, MessageSquarePlus, Pencil, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError, del, get, patch, post } from '../../api/client'
import type { Procedure, Professional, ToothNote, Treatment, TreatmentHistory } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Odontogram, type Face, type Selection, type ToothMark } from '../../domain/Odontogram'
import { Button, IconButton } from '../../ui/Button'
import { Checkbox } from '../../ui/Choice'
import { EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { EnterSubmits, Field, Input, MoneyInput, Select, Textarea } from '../../ui/Field'
import { ConfirmDialog, Modal } from '../../ui/Overlay'
import { cn, formatMoney, plural } from '../../ui/cn'

const fmtDate = (iso: string | null) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00' : iso).toLocaleDateString('pt-BR') : '—')
export const toothText = (t: { tooth: number | null; faces: Face[]; region: string | null }) =>
  t.tooth ? `${t.tooth}${t.faces.length ? ' · ' + t.faces.join('') : ''}` : t.region ?? 'Boca toda'
const today = () => new Date().toISOString().slice(0, 10)

/** S15 — Tratamentos + odontograma de acompanhamento (clicar no dente abre as anotações dele). */
export function TreatmentsTab({ patientId, treatments, loading }: { patientId: string; treatments?: Treatment[]; loading: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAuth()
  const canEdit = can('paciente.treatments')
  const clinical = ['paciente.anamnesis', 'paciente.treatments', 'paciente.documents', 'paciente.files', 'paciente.evolution_edit'].some(can)
  const notes = useQuery({ queryKey: ['tooth-notes', patientId], queryFn: () => get<ToothNote[]>(`/patients/${patientId}/tooth-notes`), enabled: clinical })
  const [sel, setSel] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Treatment | null>(null)
  const [editing, setEditing] = useState<Treatment | null>(null)
  // finalizado é prontuário: editar/excluir pede a permissão de editar prontuário
  const canChange = (t: Treatment) => canEdit && (t.status === 'open' || can('paciente.evolution_edit'))
  const [tooth, setTooth] = useState<number | null>(null)
  const marks = useMemo(() => {
    const m: Record<number, ToothMark> = {}
    for (const t of treatments ?? []) {
      if (!t.tooth || t.status === 'canceled') continue
      const cur = (m[t.tooth] ??= {})
      const key = t.status === 'open' ? 'planned' : 'done'
      const faces: Face[] | 'all' = t.faces.length ? t.faces : 'all'
      const prev = cur[key]
      cur[key] = prev === 'all' || faces === 'all' ? 'all' : [...(prev ?? []), ...faces]
    }
    for (const n of notes.data ?? []) (m[n.tooth] ??= {}).note = true
    return m
  }, [treatments, notes.data])
  const refresh = () => ['treatments', 'patient', 'debits'].forEach((k) => qc.invalidateQueries({ queryKey: [k, patientId] }))
  const finish = useMutation({
    mutationFn: () => post<Treatment[]>('/treatments/finish', { ids: sel }),
    onSuccess: (r) => { setSel([]); refresh(); toast('success', `${plural(r.length, 'tratamento finalizado', 'tratamentos finalizados')}.`) },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível finalizar.'),
  })
  const remove = useMutation({
    mutationFn: (t: Treatment) => del(`/treatments/${t.id}`).then(() => t),
    onSuccess: (t) => {
      setDeleting(null); setSel((s) => s.filter((x) => x !== t.id)); refresh(); qc.invalidateQueries({ queryKey: ['cashflow'] })
      toast('success', `${t.procedureName} (${toothText(t)}) excluído. Fica registrado no histórico.`)
    },
    onError: (e) => { setDeleting(null); toast('danger', e instanceof ApiError ? e.message : 'Não foi possível excluir.') },
  })
  const actions = (t: Treatment) => canChange(t) && (
    <span className="flex shrink-0 gap-0.5">
      <IconButton size="sm" label={`Editar ${t.procedureName}, ${toothText(t)}`} onClick={() => setEditing(t)}><Pencil className="size-4" /></IconButton>
      <IconButton size="sm" label={`Excluir ${t.procedureName}, ${toothText(t)}`} onClick={() => setDeleting(t)}><Trash2 className="size-4" /></IconButton>
    </span>
  )
  if (loading) return <Skeleton className="h-48 w-full" />
  const open = treatments?.filter((t) => t.status === 'open') ?? []
  const done = treatments?.filter((t) => t.status === 'done') ?? []
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {clinical && <p className="text-xs text-text-muted">Clique num dente para ver e escrever anotações.</p>}
        {canEdit && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo tratamento</Button>}
      </div>
      <Odontogram mode="view" marks={marks} onPick={clinical ? setTooth : undefined} />
      {!open.length && !done.length ? (
        <EmptyState icon={<Stethoscope className="size-5" />} title="Nenhum tratamento lançado"
          body="Os tratamentos aparecem aqui quando um orçamento é aprovado — ou lance um avulso em Novo tratamento." />
      ) : (
        <>
          <section aria-labelledby="t-open">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="t-open" className="text-sm font-semibold">Em aberto ({open.length})</h3>
              {canEdit && open.length > 0 && <Button size="sm" disabled={!sel.length} loading={finish.isPending} onClick={() => finish.mutate()}>Finalizar selecionados</Button>}
            </div>
            {open.length === 0 ? <p className="text-sm text-text-muted">Tudo finalizado.</p> : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {open.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    {canEdit && <Checkbox hideLabel label={`Selecionar ${t.procedureName}, ${toothText(t)}`} checked={sel.includes(t.id)} onCheckedChange={(v) => setSel(v ? [...sel, t.id] : sel.filter((x) => x !== t.id))} />}
                    <span className="w-20 shrink-0 font-mono text-xs text-text-muted">{toothText(t)}</span>
                    <span className="min-w-0 flex-1">{t.procedureName}<span className="sr-only">, dente {toothText(t)}</span>
                      <span className="block text-xs text-text-muted">{t.budgetNumber ? `Orçamento nº ${t.budgetNumber}` : 'Avulso'}<span className="sm:hidden"> · {t.professionalName}</span></span>
                    </span>
                    <span className="hidden text-xs text-text-muted sm:inline">{t.professionalName}</span>
                    {actions(t)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {done.length > 0 && (
            <section aria-labelledby="t-done">
              <h3 id="t-done" className="mb-2 text-sm font-semibold">Finalizados ({done.length})</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {done.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm text-text-muted">
                    <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
                    <span className="w-20 shrink-0 font-mono text-xs">{toothText(t)}</span>
                    <span className="flex-1 text-text">{t.procedureName}</span>
                    <span className="text-xs">{fmtDate(t.doneAt)}</span>
                    {actions(t)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {creating && <NewTreatmentModal patientId={patientId} onClose={() => setCreating(false)} onDone={refresh} />}
      {tooth !== null && (
        <ToothModal patientId={patientId} tooth={tooth} canWrite={canEdit} actions={actions}
          treatments={(treatments ?? []).filter((t) => t.tooth === tooth && t.status !== 'canceled')}
          notes={(notes.data ?? []).filter((n) => n.tooth === tooth)} onClose={() => setTooth(null)} />
      )}
      {deleting && (
        <ConfirmDialog open onOpenChange={(v) => !v && setDeleting(null)} title={`Excluir ${deleting.procedureName} (${toothText(deleting)})?`}
          body={<>Sai da lista e do odontograma. {deleting.budgetNumber ? 'As parcelas do orçamento continuam nos débitos.' : 'O débito dele, se ainda não recebeu nada, é cancelado junto.'} Fica registrado quem excluiu, quando e como estava (prontuário não é apagado de verdade).</>}
          confirmLabel="Excluir tratamento" loading={remove.isPending} onConfirm={() => remove.mutate(deleting)} />
      )}
      {editing && <EditTreatmentModal treatment={editing} onClose={() => setEditing(null)} onDone={() => { refresh(); qc.invalidateQueries({ queryKey: ['cashflow'] }) }} />}
    </div>
  )
}

/** Tratamento avulso: marca os dentes, escolhe o procedimento e, se quiser, já lança o débito. */
function NewTreatmentModal({ patientId, onClose, onDone }: { patientId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { can, me } = useAuth()
  const pros = useQuery({ queryKey: ['professionals'], queryFn: () => get<Professional[]>('/professionals') })
  const procs = useQuery({ queryKey: ['procedures'], queryFn: () => get<Procedure[]>('/procedures') })
  const [selection, setSelection] = useState<Selection>({})
  const [procId, setProcId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [charge, setCharge] = useState(can('fin.debits_create'))
  const [due, setDue] = useState(today())
  const [touched, setTouched] = useState(false)
  const proc = procs.data?.find((p) => p.id === procId)
  const byTooth = proc && (proc.scope === 'tooth' || proc.scope === 'face')
  const teeth = Object.keys(selection).map(Number)
  const unit = price ?? proc?.priceCents ?? 0
  const count = byTooth ? teeth.length : 1
  const pro = professionalId || pros.data?.find((p) => p.id === me?.membership_id)?.id || pros.data?.[0]?.id || ''
  const problem = !proc ? 'Escolha um procedimento.' : byTooth && !teeth.length ? 'Marque ao menos um dente no odontograma.' : !pro ? 'Nenhum profissional que atende cadastrado.' : null
  const save = useMutation({
    mutationFn: () => post<Treatment[]>(`/patients/${patientId}/treatments`, {
      procedureId: procId, professionalId: pro, priceCents: unit, charge, dueDate: charge ? due : undefined,
      teeth: byTooth ? teeth.map((t) => ({ tooth: t, faces: proc!.scope === 'face' ? selection[t] : [] })) : [],
    }),
    onSuccess: (r) => {
      onDone()
      if (charge) ['cashflow', 'patients'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      toast('success', `${plural(r.length, 'tratamento lançado', 'tratamentos lançados')}${charge && unit > 0 ? ` e ${plural(r.length, 'débito', 'débitos')} de ${formatMoney(unit)}` : ''}.`)
      onClose()
    },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível lançar.'),
  })
  const submit = () => { setTouched(true); if (!problem && !save.isPending) save.mutate() }
  return (
    <Modal open size="lg" onOpenChange={(v) => !v && onClose()} title="Novo tratamento" description="Fora de orçamento: urgência, manutenção, retorno…"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={submit}>Lançar{count > 1 ? ` (${count} dentes)` : ''}</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Procedimento" required>
            <Select value={procId} onChange={(e) => { setProcId(e.target.value); setPrice(null) }} data-autofocus>
              <option value="">Selecione…</option>
              {procs.data?.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.priceCents)}</option>)}
            </Select>
          </Field>
          <Field label="Profissional" required>
            <Select value={pro} onChange={(e) => setProfessionalId(e.target.value)}>
              {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        {proc && (byTooth
          ? <div className="flex flex-col gap-1.5"><span className="text-xs font-semibold">Dentes{proc.scope === 'face' ? ' e faces' : ''} <span aria-hidden className="text-danger">*</span></span>
              <Odontogram mode="select" selection={selection} onSelectionChange={setSelection}
                facesHint={proc.scope === 'face' ? 'Marque as faces tratadas em cada dente.' : 'Este procedimento vale para o dente inteiro: as faces não se aplicam.'} /></div>
          : <p className="text-xs text-text-muted">Este procedimento vale para a boca toda ou uma região: não precisa marcar dente.</p>)}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={count > 1 ? 'Valor por dente' : 'Valor'}><MoneyInput value={unit} onValueChange={setPrice} /></Field>
          {can('fin.debits_create') && (
            <>
              <div className="flex items-end pb-2"><Checkbox label="Lançar débito" checked={charge} onCheckedChange={setCharge} /></div>
              {charge && <Field label="Vencimento"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
            </>
          )}
        </div>
        {charge && unit > 0 && count > 0 && <p className="text-sm">Débito: <strong className="tabular-nums">{count > 1 ? `${count} × ${formatMoney(unit)} = ` : ''}{formatMoney(unit * count)}</strong></p>}
        {touched && problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      </form>
    </Modal>
  )
}

/** Um dente: o que foi planejado/feito nele e as anotações (com quem escreveu e quando). */
function ToothModal({ patientId, tooth, treatments, notes, canWrite, actions, onClose }: {
  patientId: string; tooth: number; treatments: Treatment[]; notes: ToothNote[]; canWrite: boolean; onClose: () => void
  actions: (t: Treatment) => React.ReactNode
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [text, setText] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['tooth-notes', patientId] })
  const add = useMutation({
    mutationFn: () => post<ToothNote>(`/patients/${patientId}/tooth-notes`, { tooth, note: text }),
    onSuccess: () => { setText(''); refresh(); toast('success', `Anotação salva no dente ${tooth}.`) },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`/tooth-notes/${id}`),
    onSuccess: () => { refresh(); toast('success', 'Anotação apagada.') },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível apagar.'),
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Dente ${tooth}`} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-4">
        <section aria-labelledby="tooth-t">
          <h3 id="tooth-t" className="mb-1.5 text-xs font-semibold">Tratamentos</h3>
          {treatments.length === 0 ? <p className="text-sm text-text-muted">Nenhum tratamento neste dente.</p> : (
            <ul className="flex flex-col gap-1 text-sm">
              {treatments.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">{t.procedureName}{t.faces.length ? ` (${t.faces.join('')})` : ''} · <span className="text-text-muted">{t.status === 'done' ? `realizado em ${fmtDate(t.doneAt)}` : 'planejado'}</span></span>
                  {actions(t)}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="tooth-n">
          <h3 id="tooth-n" className="mb-1.5 text-xs font-semibold">Anotações</h3>
          {notes.length === 0 ? <p className="text-sm text-text-muted">Nenhuma anotação ainda.</p> : (
            <ul className="flex flex-col gap-2">
              {notes.map((n) => (
                <li key={n.id} className="flex items-start gap-2 rounded-md bg-surface p-2.5 text-sm">
                  <span className="min-w-0 flex-1"><span className="whitespace-pre-wrap break-words">{n.note}</span>
                    <span className="block text-xs text-text-muted">{n.authorName ?? '—'} · {new Date(n.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></span>
                  {n.canDelete && <IconButton size="sm" label="Apagar anotação" disabled={remove.isPending} onClick={() => remove.mutate(n.id)}><Trash2 className="size-4" /></IconButton>}
                </li>
              ))}
            </ul>
          )}
        </section>
        {canWrite && (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate() }}>
            <Field label="Nova anotação" hint="Fica no prontuário. Você pode apagar a sua nas primeiras 24 horas.">
              <Textarea rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: sensibilidade ao frio, fratura na distal" />
            </Field>
            <div><Button type="submit" size="sm" variant="secondary" icon={<MessageSquarePlus className="size-4" />} disabled={!text.trim()} loading={add.isPending}>Salvar anotação</Button></div>
          </form>
        )}
      </div>
    </Modal>
  )
}

const ALL_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
  55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75]
const FACE_LIST: { f: Face; name: string }[] = [{ f: 'M', name: 'mesial' }, { f: 'D', name: 'distal' }, { f: 'O', name: 'oclusal/incisal' }, { f: 'V', name: 'vestibular' }, { f: 'L', name: 'lingual/palatina' }]

/** Editar tratamento: dente, faces, procedimento, profissional, valor. Mostra o histórico (quem, quando, o quê). */
function EditTreatmentModal({ treatment: t, onClose, onDone }: { treatment: Treatment; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const pros = useQuery({ queryKey: ['professionals'], queryFn: () => get<Professional[]>('/professionals') })
  const procs = useQuery({ queryKey: ['procedures'], queryFn: () => get<Procedure[]>('/procedures') })
  const [procId, setProcId] = useState(t.procedureId)
  const [professionalId, setProfessionalId] = useState(t.professionalId)
  const [tooth, setTooth] = useState<number | null>(t.tooth)
  const [faces, setFaces] = useState<Face[]>(t.faces)
  const [price, setPrice] = useState(t.priceCents)
  const proc = procs.data?.find((p) => p.id === procId)
  // procedimento desativado (ou de outra tabela) não vem na lista: mantém o atual como opção
  const options = procs.data && !proc ? [{ id: t.procedureId, name: t.procedureName, priceCents: t.priceCents, scope: tooth ? (faces.length ? 'face' : 'tooth') : 'mouth' } as Procedure, ...procs.data] : procs.data ?? []
  const scope = (proc ?? options.find((p) => p.id === procId))?.scope ?? 'tooth'
  const byTooth = scope === 'tooth' || scope === 'face'
  const save = useMutation({
    mutationFn: () => patch<Treatment>(`/treatments/${t.id}`, { procedureId: procId, professionalId, tooth: byTooth ? tooth : null, faces: scope === 'face' ? faces : [], priceCents: price }),
    onSuccess: (r) => { onDone(); qc.invalidateQueries({ queryKey: ['treatment-history', t.id] }); toast('success', `${r.procedureName} (${toothText(r)}) salvo. A alteração ficou no histórico.`); onClose() },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })
  const missing = byTooth && !tooth ? 'Escolha o dente.' : null
  const submit = () => { if (!missing && !save.isPending) save.mutate() }
  return (
    <Modal open size="lg" onOpenChange={(v) => !v && onClose()} title={`Editar ${t.procedureName}`}
      description={`${toothText(t)} · ${t.status === 'done' ? `realizado em ${fmtDate(t.doneAt)}` : 'em aberto'}${t.budgetNumber ? ` · orçamento nº ${t.budgetNumber}` : ' · avulso'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} disabled={!!missing} onClick={submit}>Salvar alterações</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        <Field label="Procedimento" className="sm:col-span-2">
          <Select value={procId} onChange={(e) => { setProcId(e.target.value); const np = procs.data?.find((p) => p.id === e.target.value); if (np) setPrice(np.priceCents) }}>
            {options.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.priceCents)}</option>)}
          </Select>
        </Field>
        {byTooth && (
          <Field label="Dente" required error={missing ?? undefined}>
            <Select value={tooth ?? ''} onChange={(e) => setTooth(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Escolha…</option>
              {ALL_TEETH.map((n) => <option key={n} value={n}>{n}{n >= 51 ? ' (decíduo)' : ''}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Profissional">
          <Select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {scope === 'face' && (
          <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
            <legend className="mb-1 text-xs font-semibold">Faces</legend>
            <div className="flex flex-wrap gap-1.5">
              {FACE_LIST.map(({ f, name }) => {
                const on = faces.includes(f)
                return (
                  <button key={f} type="button" aria-pressed={on} title={name} aria-label={`Face ${name}`}
                    onClick={() => setFaces(on ? faces.filter((x) => x !== f) : [...faces, f])}
                    className={cn('h-8 min-w-8 rounded-md border px-2 text-sm font-semibold', on ? 'border-accent bg-accent text-on-accent' : 'border-border-strong bg-bg hover:bg-surface')}>
                    {f}
                  </button>
                )
              })}
              <span className="self-center text-xs text-text-muted">{faces.length ? '' : 'Nenhuma = dente inteiro'}</span>
            </div>
          </fieldset>
        )}
        <Field label="Valor" hint={t.budgetNumber ? 'As parcelas do orçamento aprovado não mudam.' : 'O débito avulso ainda não pago acompanha o novo valor.'}>
          <MoneyInput value={price} onValueChange={setPrice} />
        </Field>
      </form>
      <TreatmentHistoryList id={t.id} />
    </Modal>
  )
}

const ACTION_LABEL: Record<string, string> = {
  'treatment.create': 'Lançado', 'treatment.update': 'Editado', 'treatment.finish': 'Finalizado',
  'treatment.delete': 'Excluído', 'treatment.cancel': 'Cancelado',
}
const FIELD_LABEL: Record<string, string> = { tooth: 'Dente', faces: 'Faces', procedure: 'Procedimento', priceCents: 'Valor', professional: 'Profissional', region: 'Região', status: 'Situação' }
const showValue = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? '—' : k === 'priceCents' ? formatMoney(Number(v)) : String(v))

/** Linha do tempo do tratamento: quem fez o quê e quando, com o antes → depois de cada edição. */
function TreatmentHistoryList({ id }: { id: string }) {
  // sempre busca de novo: acabou de editar e reabriu, a edição tem que aparecer
  const q = useQuery({ queryKey: ['treatment-history', id], queryFn: () => get<TreatmentHistory[]>(`/treatments/${id}/history`), staleTime: 0, refetchOnMount: 'always' })
  return (
    <section aria-labelledby={`hist-${id}`} className="mt-4 border-t border-border pt-3">
      <h3 id={`hist-${id}`} className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><History aria-hidden className="size-3.5" />Histórico</h3>
      {!q.data ? <Skeleton className="h-12 w-full" /> : (
        <ol className="flex flex-col gap-2 text-sm">
          {q.data.map((h, i) => {
            const before = h.before ? JSON.parse(h.before) as Record<string, unknown> : null
            const after = h.after ? JSON.parse(h.after) as Record<string, unknown> : null
            const changes = h.action === 'treatment.update' && before && after
              ? Object.keys(FIELD_LABEL).filter((k) => k !== 'status' && JSON.stringify(before[k]) !== JSON.stringify(after[k])) : []
            return (
              <li key={i} className="rounded-md bg-surface px-3 py-2">
                <p><span className="font-semibold">{ACTION_LABEL[h.action] ?? h.action}</span>
                  <span className="text-text-muted"> · {new Date(h.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {h.userName ?? 'sistema'}</span></p>
                {h.note && <p className="text-xs text-text-muted">{h.note}</p>}
                {changes.length > 0 && (
                  <ul className="mt-1 text-xs">
                    {changes.map((k) => <li key={k}>{FIELD_LABEL[k]}: <span className="text-text-muted line-through">{showValue(k, before![k])}</span> → <strong>{showValue(k, after![k])}</strong></li>)}
                  </ul>
                )}
                {h.action === 'treatment.delete' && before && <p className="text-xs text-text-muted">Estava: {String(before.procedure)} · {before.tooth ? `dente ${before.tooth}` : 'boca toda'}{before.faces ? ` (${before.faces})` : ''} · {showValue('priceCents', before.priceCents)}</p>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

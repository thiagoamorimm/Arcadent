import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowUp, Archive, ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ApiError, del, get, patch, post } from '../../api/client'
import type { AnamnesisTemplate, Question, QuestionType } from '../../api/types'
import { Badge } from '../../ui/Badge'
import { Button, IconButton } from '../../ui/Button'
import { Checkbox } from '../../ui/Choice'
import { Card, EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { Field, Input, Select } from '../../ui/Field'
import { ConfirmDialog, Modal } from '../../ui/Overlay'
import { plural } from '../../ui/cn'
import { SettingsLayout } from './SettingsLayout'

const TYPE: Record<QuestionType, string> = { yesno: 'Sim ou não', choice: 'Escolha entre opções', text: 'Texto livre' }

/** Ajustes › Modelos de anamnese: perguntas, tipo e qual resposta vira alerta na ficha. */
export function AnamnesisSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['anamnesis-templates'], queryFn: () => get<AnamnesisTemplate[]>('/anamnesis-templates') })
  const [editing, setEditing] = useState<AnamnesisTemplate | 'new' | null>(null)
  const [archiving, setArchiving] = useState<AnamnesisTemplate | null>(null)
  const archive = useMutation({
    mutationFn: (t: AnamnesisTemplate) => del(`/anamnesis-templates/${t.id}`),
    onSuccess: () => { setArchiving(null); qc.invalidateQueries({ queryKey: ['anamnesis-templates'] }); toast('success', 'Modelo arquivado.') },
    onError: (e) => { setArchiving(null); toast('danger', e instanceof ApiError ? e.message : 'Não foi possível arquivar.') },
  })
  return (
    <SettingsLayout title="Modelos de anamnese" description="Monte as perguntas do jeito da sua clínica. Anamneses já feitas guardam as perguntas da época: mudar o modelo não altera o que o paciente respondeu."
      actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo modelo</Button>}>
      {list.isLoading ? <Skeleton className="h-32 w-full" /> : !list.data?.length ? (
        <EmptyState icon={<ClipboardList className="size-5" />} title="Nenhum modelo" body="Crie o primeiro modelo de anamnese." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {list.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name} {!t.isActive && <Badge tone="neutral" className="ml-1">Arquivado</Badge>}</p>
                  <p className="text-xs text-text-muted">{plural(t.questions.length, 'pergunta', 'perguntas')} · {plural(t.questions.filter((q) => q.alertOn).length, 'gera alerta', 'geram alerta')} · {t.usage ? plural(t.usage, 'anamnese feita', 'anamneses feitas') : 'ainda não usado'}</p>
                </div>
                <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(t)}>Editar</Button>
                {t.isActive && <IconButton size="sm" label={`Arquivar ${t.name}`} onClick={() => setArchiving(t)}><Archive className="size-4" /></IconButton>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {archiving && (
        <ConfirmDialog open onOpenChange={(v) => !v && setArchiving(null)} title={`Arquivar “${archiving.name}”?`}
          body="Ele deixa de aparecer para novas anamneses. As já feitas continuam na ficha dos pacientes." confirmLabel="Arquivar" tone="primary"
          loading={archive.isPending} onConfirm={() => archive.mutate(archiving)} />
      )}
    </SettingsLayout>
  )
}

const newQ = (): Question => ({ id: 'q' + crypto.randomUUID().slice(0, 8), text: '', type: 'yesno' })

function TemplateEditor({ template, onClose }: { template: AnamnesisTemplate | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(template?.name ?? '')
  const [qs, setQs] = useState<Question[]>(template?.questions ?? [newQ()])
  const set = (i: number, p: Partial<Question>) => setQs((cur) => cur.map((q, j) => (j === i ? { ...q, ...p } : q)))
  const move = (i: number, d: -1 | 1) => setQs((cur) => { const n = [...cur]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n })
  const problems = qs.map((q) =>
    !q.text.trim() ? 'Escreva a pergunta.'
      : q.type === 'choice' && (q.options?.filter((o) => o.trim()).length ?? 0) < 2 ? 'Informe pelo menos 2 opções.'
      : q.alertOn && !q.alert?.trim() ? 'Dê um nome ao alerta.'
      : q.type === 'choice' && q.alertOn && !q.options?.includes(q.alertOn) ? 'Escolha qual opção gera alerta.'
      : null)
  const invalid = !name.trim() || qs.length === 0 || problems.some(Boolean)
  const save = useMutation({
    mutationFn: () => {
      const body = { name, questions: qs.map((q) => ({ ...q, options: q.type === 'choice' ? q.options?.map((o) => o.trim()).filter(Boolean) : undefined })) }
      return template ? patch(`/anamnesis-templates/${template.id}`, body) : post('/anamnesis-templates', body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['anamnesis-templates'] }); toast('success', 'Modelo salvo.'); onClose() },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  })
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={template ? 'Editar modelo' : 'Novo modelo de anamnese'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Salvar modelo</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nome do modelo" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Anamnese infantil" data-autofocus /></Field>
        <ol className="flex flex-col gap-3">
          {qs.map((q, i) => (
            <li key={q.id} className="rounded-md border border-border p-3">
              <div className="flex items-start gap-2">
                <span className="mt-2 w-6 shrink-0 text-right text-sm text-text-muted tabular-nums">{i + 1}.</span>
                <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_200px]">
                  <Input aria-label={`Pergunta ${i + 1}`} value={q.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Escreva a pergunta" />
                  <Select aria-label={`Tipo da pergunta ${i + 1}`} value={q.type}
                    onChange={(e) => { const type = e.target.value as QuestionType; set(i, { type, alertOn: undefined, alert: undefined, withDetail: undefined, options: type === 'choice' ? (q.options ?? ['', '']) : undefined }) }}>
                    {(Object.keys(TYPE) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE[t]}</option>)}
                  </Select>
                  {q.type === 'choice' && (
                    <Field label="Opções (separe por vírgula)" className="sm:col-span-2">
                      <Input value={q.options?.join(', ') ?? ''} onChange={(e) => set(i, { options: e.target.value.split(',').map((o) => o.trimStart()) })} placeholder="Ex.: Não, Grávida, Amamentando" />
                    </Field>
                  )}
                  {q.type !== 'text' && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
                      {q.type === 'yesno' && <Checkbox label='Pedir detalhes quando "Sim"' checked={!!q.withDetail} onCheckedChange={(v) => set(i, { withDetail: v || undefined })} />}
                      <Checkbox label="Gera alerta na ficha" checked={!!q.alertOn} onCheckedChange={(v) => set(i, v ? { alertOn: q.type === 'yesno' ? 'sim' : q.options?.[1] ?? '', alert: '' } : { alertOn: undefined, alert: undefined })} />
                      {q.alertOn !== undefined && (
                        <>
                          <div className="w-40">
                            <Select aria-label="Resposta que gera alerta" value={q.alertOn} onChange={(e) => set(i, { alertOn: e.target.value })}>
                              {(q.type === 'yesno' ? ['sim', 'nao'] : q.options?.filter((o) => o.trim()) ?? []).map((o) => <option key={o} value={o}>quando “{o === 'sim' ? 'Sim' : o === 'nao' ? 'Não' : o}”</option>)}
                            </Select>
                          </div>
                          <div className="flex items-center gap-1"><AlertTriangle aria-hidden className="size-4 text-danger" /><Input aria-label="Nome do alerta" className="w-48" value={q.alert ?? ''} onChange={(e) => set(i, { alert: e.target.value })} placeholder="Ex.: Alergia" maxLength={60} /></div>
                        </>
                      )}
                    </div>
                  )}
                  {problems[i] && q.text !== '' && <p className="text-xs text-danger sm:col-span-2">{problems[i]}</p>}
                </div>
                <div className="flex flex-col">
                  <IconButton size="sm" label={`Subir pergunta ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconButton>
                  <IconButton size="sm" label={`Descer pergunta ${i + 1}`} disabled={i === qs.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconButton>
                  <IconButton size="sm" label={`Remover pergunta ${i + 1}`} disabled={qs.length === 1} onClick={() => setQs((cur) => cur.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div><Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setQs((cur) => [...cur, newQ()])}>Adicionar pergunta</Button></div>
      </div>
    </Modal>
  )
}

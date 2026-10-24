import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, NotebookPen, Paperclip, Pencil, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { ApiError, del, get, patch, post, upload } from '../../api/client'
import type { Evolution, Treatment } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { dateTimeIn } from '../../lib/tz'
import { useClinic } from '../../lib/useClinic'
import { Avatar, Card, EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { Button, IconButton } from '../../ui/Button'
import { Select, Textarea } from '../../ui/Field'
import { ConfirmDialog, Modal } from '../../ui/Overlay'
import { PdfViewer } from '../../ui/PdfViewer'
import { ACCEPT, AuthImage, MAX } from './FilesTab'

type Att = Evolution['files'][number]

/** Aba Evoluções: diário clínico em ordem do mais recente. */
export function EvolutionsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAuth()
  const tz = useClinic().data?.timezone ?? 'America/Sao_Paulo'
  const list = useQuery({ queryKey: ['evolutions', patientId], queryFn: () => get<Evolution[]>(`/patients/${patientId}/evolutions`) })
  const treatments = useQuery({ queryKey: ['treatments', patientId], queryFn: () => get<Treatment[]>(`/patients/${patientId}/treatments`) })
  const [body, setBody] = useState('')
  const [treatmentId, setTreatmentId] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [removing, setRemoving] = useState<Evolution | null>(null)
  const [pending, setPending] = useState<File[]>([])
  const [viewing, setViewing] = useState<Att | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const later = useRef<HTMLInputElement>(null)
  const canAttach = can('paciente.files')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['evolutions', patientId] }); qc.invalidateQueries({ queryKey: ['files', patientId] }) }

  /** Envia os arquivos como anexos da evolução (aparecem também na aba Imagens). Devolve os que falharam. */
  const attach = async (evolutionId: string, files: File[]) => {
    const failed: string[] = []
    for (const f of files) {
      if (f.size > MAX) { failed.push(`${f.name} (maior que 50 MB)`); continue }
      const form = new FormData()
      form.append('file', f)
      form.append('evolutionId', evolutionId)
      try { await upload(`/patients/${patientId}/files`, form) } catch (e) { failed.push(`${f.name} (${e instanceof ApiError ? e.message : 'falhou'})`) }
    }
    return failed
  }
  const create = useMutation({
    mutationFn: async () => {
      const ev = await post<Evolution>(`/patients/${patientId}/evolutions`, { body, treatmentId: treatmentId || undefined })
      return { ev, failed: pending.length ? await attach(ev.id, pending) : [] }
    },
    onSuccess: ({ failed }) => {
      setBody(''); setTreatmentId(''); setPending([]); refresh()
      if (failed.length) toast('danger', `Evolução registrada, mas não anexou: ${failed.join(', ')}.`)
      else toast('success', 'Evolução registrada.')
    },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível registrar.'),
  })
  const attachLater = async (evolutionId: string, files: File[]) => {
    setAttaching(evolutionId)
    const failed = await attach(evolutionId, files)
    setAttaching(null)
    refresh()
    toast(failed.length ? 'danger' : 'success', failed.length ? `Não anexou: ${failed.join(', ')}.` : `${files.length > 1 ? `${files.length} arquivos anexados` : 'Arquivo anexado'}.`)
  }
  const update = useMutation({
    mutationFn: () => patch<Evolution>(`/evolutions/${editing!.id}`, { body: editing!.body }),
    onSuccess: () => { setEditing(null); refresh(); toast('success', 'Evolução corrigida. A versão anterior fica no histórico.') },
    onError: (e) => toast('danger', e instanceof ApiError ? e.message : 'Não foi possível corrigir.'),
  })
  const remove = useMutation({
    mutationFn: (e: Evolution) => del(`/evolutions/${e.id}`),
    onSuccess: () => { setRemoving(null); refresh(); toast('success', 'Evolução removida da ficha.') },
  })

  return (
    <div className="flex flex-col gap-4">
      {can('paciente.treatments') && (
        <Card className="flex flex-col gap-3 p-3">
          <label htmlFor="evo-new" className="text-sm font-semibold">Nova evolução</label>
          <Textarea id="evo-new" rows={3} placeholder="O que foi feito hoje, observações, próximos passos…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-72">
              <Select aria-label="Tratamento relacionado" value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)}>
                <option value="">Sem tratamento vinculado</option>
                {treatments.data?.filter((t) => t.status !== 'canceled').map((t) => (
                  <option key={t.id} value={t.id}>{t.procedureName}{t.tooth ? ` · dente ${t.tooth}` : ''}{t.status === 'done' ? ' (finalizado)' : ''}</option>
                ))}
              </Select>
            </div>
            {canAttach && (
              <>
                <input ref={pick} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
                  onChange={(ev) => { if (ev.target.files) setPending([...pending, ...Array.from(ev.target.files)]); ev.target.value = '' }} />
                <Button variant="secondary" icon={<Paperclip className="size-4" />} onClick={() => pick.current?.click()}>Anexar imagem</Button>
              </>
            )}
            <Button disabled={!body.trim()} loading={create.isPending} onClick={() => create.mutate()}>Registrar</Button>
          </div>
          {pending.length > 0 && (
            <ul aria-label="Arquivos a anexar" className="flex flex-wrap gap-2">
              {pending.map((f, i) => (
                <li key={i} className="flex items-center gap-1 rounded-pill bg-surface py-0.5 pl-3 pr-1 text-xs">
                  <span className="max-w-48 truncate">{f.name}</span>
                  <IconButton size="sm" label={`Tirar ${f.name}`} onClick={() => setPending(pending.filter((_, j) => j !== i))}><X className="size-3.5" /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {list.isLoading ? <Skeleton className="h-32 w-full" /> : !list.data?.length ? (
        <EmptyState icon={<NotebookPen className="size-5" />} title="Nenhuma evolução" body="Registre o que foi feito em cada atendimento. O histórico fica aqui, do mais recente para o mais antigo." />
      ) : (
        <ol className="flex flex-col gap-3">
          {list.data.map((e) => (
            <li key={e.id}>
              <Card className="p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Avatar name={e.professionalName} size={24} />
                  <span className="text-sm font-medium">{e.professionalName}</span>
                  <span className="text-xs text-text-muted">{dateTimeIn(e.occurredAt, tz)}{e.edited ? ' · editada' : ''}</span>
                  {e.treatmentLabel && <span className="rounded-pill bg-accent-soft px-2 text-xs text-accent-text">{e.treatmentLabel}</span>}
                  <span className="ml-auto flex gap-1">
                    {e.canEdit && canAttach && <Button size="sm" variant="ghost" icon={<Paperclip className="size-3.5" />} loading={attaching === e.id}
                      onClick={() => { later.current!.dataset.evo = e.id; later.current!.click() }}>Anexar</Button>}
                    {e.canEdit && editing?.id !== e.id && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing({ id: e.id, body: e.body })}>Corrigir</Button>}
                    {can('paciente.evolution_edit') && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(e)}>Excluir</Button>}
                  </span>
                </div>
                {editing?.id === e.id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea aria-label="Corrigir evolução" rows={3} value={editing.body} onChange={(ev) => setEditing({ id: e.id, body: ev.target.value })} autoFocus />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!editing.body.trim()} loading={update.isPending} onClick={() => update.mutate()}>Salvar correção</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-base leading-relaxed">{e.body}</p>
                )}
                {e.files.length > 0 && (
                  <ul aria-label="Anexos" className="mt-3 flex flex-wrap gap-2">
                    {e.files.map((f) => (
                      <li key={f.id}>
                        <button type="button" onClick={() => setViewing(f)} title={f.fileName}
                          className="flex size-20 items-center justify-center overflow-hidden rounded-md border border-border bg-surface outline-none hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus-ring">
                          {f.mimeType.startsWith('image/')
                            ? <AuthImage fileId={f.id} alt={f.fileName} className="size-full object-cover" />
                            : <span className="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-text-muted"><FileText className="size-5" /><span className="line-clamp-2 break-all">{f.fileName}</span></span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <input ref={later} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(ev) => { const id = ev.target.dataset.evo; if (id && ev.target.files?.length) attachLater(id, Array.from(ev.target.files)); ev.target.value = '' }} />
      {viewing && (viewing.mimeType === 'application/pdf'
        ? <PdfViewer path={`/files/${viewing.id}/content`} title={viewing.fileName} fileName={viewing.fileName} onClose={() => setViewing(null)} />
        : viewing.mimeType.startsWith('image/')
          ? <Modal open size="lg" onOpenChange={(v) => !v && setViewing(null)} title={viewing.fileName} footer={<Button variant="secondary" onClick={() => setViewing(null)}>Fechar</Button>}>
              <AuthImage fileId={viewing.id} alt={viewing.fileName} className="mx-auto max-h-[70vh] w-auto rounded-md" />
            </Modal>
          : <Modal open onOpenChange={(v) => !v && setViewing(null)} title={viewing.fileName} footer={<Button variant="secondary" onClick={() => setViewing(null)}>Fechar</Button>}>
              <p className="text-sm text-text-muted">Este tipo de arquivo não tem visualização aqui. Baixe pela aba Imagens.</p>
            </Modal>)}
      {removing && (
        <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title="Excluir esta evolução?"
          body="Ela sai da ficha do paciente, mas continua guardada no histórico da clínica (o prontuário não é apagado de verdade)."
          confirmLabel="Excluir evolução" loading={remove.isPending} onConfirm={() => remove.mutate(removing)} />
      )}
    </div>
  )
}

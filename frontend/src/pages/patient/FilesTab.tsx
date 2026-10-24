import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Download, FileText, ImageIcon, ScanLine, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ApiError, del, get, getBlob, patch, upload } from '../../api/client'
import { PdfViewer } from '../../ui/PdfViewer'
import type { FileKind, PatientFile } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Badge } from '../../ui/Badge'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, Skeleton, useToast } from '../../ui/Feedback'
import { Input, Select } from '../../ui/Field'
import { ConfirmDialog, Modal } from '../../ui/Overlay'
import { cn } from '../../ui/cn'

const KIND: Record<FileKind, string> = { photo: 'Foto', xray: 'Radiografia', ct: 'Tomografia', stl: 'Modelo 3D (STL)', pdf: 'PDF', other: 'Outro' }
export const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.stl,.dcm,image/jpeg,image/png,image/webp,application/pdf'
export const MAX = 50 * 1024 * 1024
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const isImage = (f: PatientFile) => f.mimeType.startsWith('image/')

/** Imagem protegida: baixa com o token e mostra via URL local; libera a memória ao sair. */
export function AuthImage({ fileId, alt, className }: { fileId: string; alt: string; className?: string }) {
  const q = useQuery({ queryKey: ['file-blob', fileId], queryFn: () => getBlob(`/files/${fileId}/content`), staleTime: 5 * 60_000 })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!q.data) return
    const u = URL.createObjectURL(q.data)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [q.data])
  if (!url) return <Skeleton className={className} />
  return <img src={url} alt={alt} className={className} />
}

type Uploading = { key: string; name: string; pct: number; error?: string }

/** Aba Imagens: arrastar ou escolher arquivos, galeria por tipo, visualizador. */
export function FilesTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAuth()
  const files = useQuery({ queryKey: ['files', patientId], queryFn: () => get<PatientFile[]>(`/patients/${patientId}/files`) })
  const [filter, setFilter] = useState<FileKind | 'all'>('all')
  const [kind, setKind] = useState<FileKind | 'auto'>('auto')
  const [takenAt, setTakenAt] = useState('')
  const [queue, setQueue] = useState<Uploading[]>([])
  const [over, setOver] = useState(false)
  const [viewing, setViewing] = useState<PatientFile | null>(null)
  const [removing, setRemoving] = useState<PatientFile | null>(null)
  const [pdf, setPdf] = useState<PatientFile | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const send = async (list: FileList | File[]) => {
    const arr = Array.from(list)
    for (const f of arr) {
      const key = crypto.randomUUID()
      if (f.size > MAX) { setQueue((q) => [...q, { key, name: f.name, pct: 0, error: 'Maior que 50 MB.' }]); continue }
      setQueue((q) => [...q, { key, name: f.name, pct: 0 }])
      const form = new FormData()
      form.append('file', f)
      if (kind !== 'auto') form.append('kind', kind)
      if (takenAt) form.append('takenAt', takenAt)
      try {
        await upload(`/patients/${patientId}/files`, form, (pct) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, pct } : x))))
        setQueue((q) => q.filter((x) => x.key !== key))
      } catch (e) {
        setQueue((q) => q.map((x) => (x.key === key ? { ...x, error: e instanceof ApiError ? e.message : 'Falhou.' } : x)))
      }
    }
    qc.invalidateQueries({ queryKey: ['files', patientId] })
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) send(e.dataTransfer.files) }

  const remove = useMutation({
    mutationFn: (f: PatientFile) => del(`/files/${f.id}`),
    onSuccess: () => { setRemoving(null); setViewing(null); qc.invalidateQueries({ queryKey: ['files', patientId] }); toast('success', 'Arquivo removido da ficha.') },
  })
  const reclass = useMutation({
    mutationFn: ({ f, k }: { f: PatientFile; k: FileKind }) => patch<PatientFile>(`/files/${f.id}`, { kind: k }),
    onSuccess: (f) => { setViewing(f); qc.invalidateQueries({ queryKey: ['files', patientId] }) },
  })
  const download = async (f: PatientFile) => {
    if (f.mimeType === 'application/pdf') { setViewing(null); setPdf(f); return }
    const url = URL.createObjectURL(await getBlob(`/files/${f.id}/content`))
    const a = document.createElement('a'); a.href = url; a.download = f.fileName; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const shown = (files.data ?? []).filter((f) => filter === 'all' || f.kind === filter)
  const counts = (files.data ?? []).reduce<Record<string, number>>((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {})

  return (
    <div className="flex flex-col gap-4">
      {can('paciente.files') && (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn('flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-5 text-center transition-colors', over ? 'border-accent bg-accent-soft' : 'border-border-strong bg-bg')}
        >
          <Upload aria-hidden className="size-6 text-text-muted" />
          <p className="text-sm">Arraste fotos, radiografias, tomografias, STL ou PDF para cá, ou</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" onClick={() => input.current?.click()}>Escolher arquivos</Button>
            <div className="w-40"><Select aria-label="Tipo dos arquivos" value={kind} onChange={(e) => setKind(e.target.value as FileKind | 'auto')}>
              <option value="auto">Tipo automático</option>
              {(Object.keys(KIND) as FileKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
            </Select></div>
            <div className="w-44"><Input type="date" aria-label="Data do exame (opcional)" title="Data do exame (opcional)" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} /></div>
          </div>
          <p className="text-xs text-text-muted">Até 50 MB por arquivo · JPG, PNG, WEBP, PDF, STL, DICOM</p>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
            onChange={(e) => { if (e.target.files?.length) send(e.target.files); e.target.value = '' }} />
        </div>
      )}
      {queue.length > 0 && (
        <ul className="flex flex-col gap-1" aria-live="polite">
          {queue.map((u) => (
            <li key={u.key} className="flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.error ? <span className="text-danger">{u.error}</span> : (
                <span className="flex w-40 items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-sunken"><span className="block h-full bg-accent" style={{ width: `${u.pct}%` }} /></span><span className="w-9 text-right text-xs tabular-nums">{u.pct}%</span></span>
              )}
              {u.error && <IconButton size="sm" label="Dispensar" onClick={() => setQueue((q) => q.filter((x) => x.key !== u.key))}>×</IconButton>}
            </li>
          ))}
        </ul>
      )}
      {files.data && files.data.length > 0 && (
        <div role="radiogroup" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1">
          {(['all', ...Object.keys(counts)] as (FileKind | 'all')[]).map((k) => (
            <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}
              className={cn('h-8 rounded-pill border px-3 text-sm', filter === k ? 'border-accent bg-accent-soft text-accent-text' : 'border-border-strong hover:bg-surface')}>
              {k === 'all' ? `Todos (${files.data!.length})` : `${KIND[k]} (${counts[k]})`}
            </button>
          ))}
        </div>
      )}
      {files.isLoading ? <Skeleton className="h-40 w-full" /> : !files.data?.length ? (
        <EmptyState icon={<ImageIcon className="size-5" />} title="Nenhuma imagem ou arquivo" body="As fotos e exames do paciente ficam organizados aqui, por tipo e data." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => setViewing(f)} className="group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-bg text-left hover:shadow-card">
                <div className="flex aspect-[4/3] items-center justify-center bg-surface-sunken">
                  {isImage(f) ? <AuthImage fileId={f.id} alt={f.fileName} className="size-full object-cover" />
                    : f.kind === 'stl' ? <Box aria-hidden className="size-10 text-text-muted" />
                    : f.kind === 'ct' ? <ScanLine aria-hidden className="size-10 text-text-muted" />
                    : <FileText aria-hidden className="size-10 text-text-muted" />}
                </div>
                <div className="flex flex-col gap-0.5 p-2">
                  <span className="truncate text-sm font-medium">{f.fileName}</span>
                  <span className="flex items-center gap-1 text-xs text-text-muted"><Badge className="h-5">{KIND[f.kind]}</Badge>{f.takenAt ? new Date(f.takenAt + 'T12:00').toLocaleDateString('pt-BR') : size(f.sizeBytes)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <Modal open onOpenChange={(v) => !v && setViewing(null)} title={viewing.fileName} size="lg"
          description={`${KIND[viewing.kind]} · ${size(viewing.sizeBytes)}${viewing.uploadedBy ? ` · enviado por ${viewing.uploadedBy}` : ''}`}
          footer={
            <div className="flex w-full flex-wrap justify-between gap-2">
              {can('paciente.files') ? <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setRemoving(viewing)}>Excluir</Button> : <span />}
              <div className="flex gap-2">
                {can('paciente.files') && (
                  <div className="w-44"><Select aria-label="Tipo" value={viewing.kind} onChange={(e) => reclass.mutate({ f: viewing, k: e.target.value as FileKind })}>
                    {(Object.keys(KIND) as FileKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
                  </Select></div>
                )}
                <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(viewing)}>{viewing.mimeType === 'application/pdf' ? 'Abrir PDF' : 'Baixar'}</Button>
              </div>
            </div>
          }>
          {isImage(viewing)
            ? <AuthImage fileId={viewing.id} alt={viewing.fileName} className="mx-auto max-h-[65vh] w-auto max-w-full rounded-md object-contain" />
            : <p className="text-sm text-text-muted">{viewing.kind === 'stl' ? 'Modelos 3D ainda não têm visualização aqui. Baixe para abrir no programa de escaneamento.' : 'Use o botão para abrir ou baixar o arquivo.'}</p>}
        </Modal>
      )}
      {pdf && <PdfViewer path={`/files/${pdf.id}/content`} title={pdf.fileName} fileName={pdf.fileName} onClose={() => setPdf(null)} />}
      {removing && (
        <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title="Excluir este arquivo?"
          body="Ele sai da ficha do paciente, mas continua guardado pela clínica (prontuário)." confirmLabel="Excluir arquivo"
          loading={remove.isPending} onConfirm={() => remove.mutate(removing)} />
      )}
    </div>
  )
}

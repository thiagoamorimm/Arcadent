import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, getBlob } from '../api/client'
import { buttonClass } from './Button'
import { Skeleton } from './Feedback'
import { Modal } from './Overlay'

/**
 * PDF protegido mostrado dentro do app (sem pop-up, que o navegador pode bloquear).
 * "Abrir em nova aba" e "Baixar" são links reais clicados pela pessoa, então não são bloqueados.
 * No celular, onde o navegador não desenha PDF embutido, os botões continuam funcionando.
 */
export function PdfViewer({ path, title, fileName, onClose }: { path: string; title: string; fileName: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pdf', path], queryFn: () => getBlob(path), staleTime: 60_000, retry: false })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!q.data) return
    const u = URL.createObjectURL(new Blob([q.data], { type: 'application/pdf' }))
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [q.data])
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={title} size="lg"
      footer={url ? (
        <>
          <a href={url} target="_blank" rel="noreferrer" className={buttonClass('secondary')}><ExternalLink aria-hidden className="size-4" />Abrir em nova aba</a>
          <a href={url} download={fileName} className={buttonClass('primary')}><Download aria-hidden className="size-4" />Baixar PDF</a>
        </>
      ) : undefined}>
      {q.isError && <p role="alert" className="text-sm text-danger">{q.error instanceof ApiError ? q.error.message : 'Não foi possível abrir o PDF.'}</p>}
      {!url && !q.isError && <Skeleton className="h-[70vh] w-full" />}
      {url && <iframe title={title} src={url} className="h-[70vh] w-full rounded-md border border-border bg-surface" />}
    </Modal>
  )
}

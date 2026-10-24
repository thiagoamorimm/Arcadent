import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { get } from '../api/client'
import type { Page, PatientRow } from '../api/types'
import { cn } from '../ui/cn'

export type PickedPatient = { id: string; name: string } | { id: null; name: string; phone: string }

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

/**
 * Combobox de paciente (ARIA combobox + listbox). Setas navegam, Enter escolhe, Esc fecha.
 * A última opção cadastra o texto digitado como paciente novo (só nome; celular opcional).
 */
export function PatientPicker({ value, onChange, invalid, labelledBy }: {
  value: PickedPatient | null; onChange: (p: PickedPatient | null) => void; invalid?: boolean
  /** id do rótulo visível ("Paciente"): sem isso o leitor de tela só ouve o placeholder */
  labelledBy?: string
}) {
  const id = useId()
  const [text, setText] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [newPhone, setNewPhone] = useState('')
  const q = useDebounced(text.trim())
  const search = useQuery({
    queryKey: ['patients', 'search', q],
    queryFn: () => get<Page<PatientRow>>(`/patients?size=8&q=${encodeURIComponent(q)}`),
    enabled: open && q.length >= 2,
  })
  const options = search.data?.items ?? []
  const canCreate = q.length >= 2
  const total = options.length + (canCreate ? 1 : 0)

  const choose = (i: number) => {
    if (i < options.length) {
      onChange({ id: options[i].id, name: options[i].name })
      setText(options[i].name)
    } else if (canCreate) {
      onChange({ id: null, name: q, phone: newPhone })
      setText(q)
    }
    setOpen(false)
  }

  if (value && value.id === null) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
        <p className="text-sm">
          Novo paciente: <strong>{value.name}</strong>{' '}
          <button type="button" className="text-xs text-accent-text underline" onClick={() => { onChange(null); setText(''); requestAnimationFrame(() => document.getElementById(id)?.focus()) }}>trocar</button>
        </p>
        <label className="text-xs font-semibold" htmlFor={`${id}-phone`}>Celular (opcional, para confirmar a consulta)</label>
        <input
          id={`${id}-phone`}
          autoFocus
          inputMode="tel"
          placeholder="(00) 00000-0000"
          value={value.phone}
          onChange={(e) => { setNewPhone(e.target.value); onChange({ ...value, phone: e.target.value }) }}
          className="h-10 rounded-md border border-border-input bg-bg px-3 text-sm"
        />
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : 'Paciente'}
        data-autofocus
        aria-expanded={open && total > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && total > 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        placeholder="Nome, celular ou CPF"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); if (value) onChange(null) }}
        onFocus={() => { clearTimeout(closing.current); setOpen(true) }}
        // fecha com atraso (o clique na opção acontece depois do blur); voltar o foco cancela
        onBlur={() => { closing.current = setTimeout(() => setOpen(false), 150) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, total - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && open && total > 0) { e.preventDefault(); choose(active) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        className="h-10 w-full rounded-md border border-border-input bg-bg px-3 text-sm aria-[invalid=true]:border-danger"
      />
      {open && q.length >= 2 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-bg p-1 shadow-pop">
          {search.isLoading && <li className="px-2 py-2 text-sm text-text-muted">Buscando…</li>}
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={active === i}
              onMouseDown={(e) => { e.preventDefault(); choose(i) }}
              className={cn('flex cursor-pointer flex-col rounded-sm px-2 py-1.5', active === i && 'bg-surface')}
            >
              <span className="text-sm font-medium">{o.name}</span>
              {o.phone && <span className="text-xs text-text-muted">{o.phone}</span>}
            </li>
          ))}
          {canCreate && (
            <li
              id={`${id}-opt-${options.length}`}
              role="option"
              aria-selected={active === options.length}
              onMouseDown={(e) => { e.preventDefault(); choose(options.length) }}
              className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm text-accent-text', active === options.length && 'bg-surface')}
            >
              <UserPlus aria-hidden className="size-4" /> Cadastrar “{q}” como novo paciente
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

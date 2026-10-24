import * as Popover from '@radix-ui/react-popover'
import { ArrowDown, ArrowUp, ChevronDown, Filter } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { cn } from './cn'

export interface Column<T> {
  key: string
  header: string
  /** valor usado para filtrar e ordenar */
  value: (row: T) => string | number
  render?: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** false para colunas de ação (botões): sem filtro nem ordenação */
  filterable?: boolean
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null

/**
 * Tabela padrão: TODA coluna nasce com filtro ▾ e ordenação no título (ColumnHeader).
 * Aqui filtra/ordena no cliente; nas telas reais os mesmos controles viram query params da API.
 */
export function DataTable<T>({
  columns, rows, rowKey, empty, caption,
}: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty: ReactNode; caption: string }) {
  const [sort, setSort] = useState<Sort>(null)
  const [filters, setFilters] = useState<Record<string, string>>({})

  const shown = useMemo(() => {
    let out = rows.filter((r) =>
      columns.every((c) => {
        const f = filters[c.key]?.trim().toLowerCase()
        return !f || String(c.value(r)).toLowerCase().includes(f)
      }),
    )
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)!
      out = [...out].sort((a, b) => {
        const va = col.value(a), vb = col.value(b)
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }, [rows, columns, filters, sort])

  return (
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface">
          <tr>
            {columns.map((c) => (
              <ColumnHeader
                key={c.key}
                column={c}
                sort={sort?.key === c.key ? sort.dir : null}
                onSort={(dir) => setSort(dir ? { key: c.key, dir } : null)}
                filter={filters[c.key] ?? ''}
                onFilter={(v) => setFilters((f) => ({ ...f, [c.key]: v }))}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr><td colSpan={columns.length}>{empty}</td></tr>
          ) : (
            shown.map((r) => (
              <tr key={rowKey(r)} className="border-t border-border hover:bg-surface">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2.5', c.align === 'right' && 'text-right tabular-nums')}>
                    {c.render ? c.render(r) : c.value(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ColumnHeader<T>({
  column, sort, onSort, filter, onFilter,
}: {
  column: Column<T>
  sort: 'asc' | 'desc' | null
  onSort: (dir: 'asc' | 'desc' | null) => void
  filter: string
  onFilter: (v: string) => void
}) {
  const active = Boolean(filter) || sort !== null
  if (column.filterable === false) {
    return (
      <th scope="col" className={cn('px-3 py-2 text-xs font-semibold text-text-muted', column.align === 'right' ? 'text-right' : 'text-left')}>
        {column.header}
      </th>
    )
  }
  return (
    <th
      scope="col"
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'}
      className={cn('px-3 py-2 text-xs font-semibold text-text-muted', column.align === 'right' ? 'text-right' : 'text-left')}
    >
      <Popover.Root>
        <Popover.Trigger
          className={cn(
            'inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-surface-sunken hover:text-text',
            active && 'text-accent-text',
          )}
        >
          {column.header}
          {sort === 'asc' && <ArrowUp aria-hidden className="size-3" />}
          {sort === 'desc' && <ArrowDown aria-hidden className="size-3" />}
          {filter && <Filter aria-hidden className="size-3" />}
          <ChevronDown aria-hidden className="size-3" />
          <span className="sr-only">: ordenar e filtrar</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className="z-50 w-56 rounded-md border border-border bg-bg p-2 font-normal shadow-pop">
            <div className="flex flex-col gap-0.5">
              {(['asc', 'desc'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => onSort(sort === d ? null : d)}
                  className={cn('flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface', sort === d && 'bg-accent-soft text-accent-text')}
                >
                  {d === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
                  {d === 'asc' ? 'Crescente' : 'Decrescente'}
                </button>
              ))}
            </div>
            <div className="mt-2 border-t border-border pt-2">
              <input
                aria-label={`Filtrar ${column.header}`}
                placeholder="Contém…"
                value={filter}
                onChange={(e) => onFilter(e.target.value)}
                className="h-8 w-full rounded-sm border border-border-input px-2 text-sm"
              />
              {filter && (
                <button onClick={() => onFilter('')} className="mt-1 text-xs text-accent-text hover:underline">
                  Limpar filtro
                </button>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </th>
  )
}

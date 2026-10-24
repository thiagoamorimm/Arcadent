import {
  cloneElement, forwardRef, isValidElement, useId,
  type InputHTMLAttributes, type ReactElement, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './cn'

const control =
  'w-full rounded-md border border-border-input bg-bg text-sm text-text placeholder:text-text-muted ' +
  'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-0 ' +
  'disabled:bg-surface disabled:text-text-muted disabled:cursor-not-allowed ' +
  'aria-[invalid=true]:border-danger'

/** Rótulo + controle + ajuda/erro, já ligados por id (aria-describedby / aria-invalid). */
export function Field({
  label, hint, error, required, children, className,
}: {
  label: string
  hint?: ReactNode
  error?: string
  required?: boolean
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }>
  className?: string
}) {
  const id = useId()
  const descId = `${id}-desc`
  const child = isValidElement(children)
    ? cloneElement(children, {
        id,
        required,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': hint || error ? descId : undefined,
      })
    : children
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-text">
        {label}
        {required && <span aria-hidden className="text-danger"> *</span>}
      </label>
      {child}
      {(error || hint) && (
        <p id={descId} className={cn('text-xs', error ? 'text-danger' : 'text-text-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(control, 'h-10 px-3', className)} {...rest} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(control, 'px-3 py-2 resize-y', className)} {...rest} />
  },
)

/** Select nativo estilizado: teclado e leitor de tela de graça. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(control, 'h-10 appearance-none pl-3 pr-9', className)} {...rest}>
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      </div>
    )
  },
)

const MONEY_MAX = 99_999_999_99 // R$ 99.999.999,99

/**
 * Dinheiro em centavos; mostra "1.234,56" e devolve inteiro. Nunca float. Funciona como calculadora:
 * o dígito sempre entra pela direita e Backspace tira o último, não importa onde está o cursor
 * (senão, clicar antes do "0,00" e digitar 1000 vira R$ 1.000.000,00). Ao focar, seleciona tudo:
 * digitar substitui o valor.
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onValueChange: (cents: number) => void }
>(function MoneyInput({ value, onValueChange, className, onKeyDown, onFocus, ...rest }, ref) {
  const shown = (value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const toEnd = (el: HTMLInputElement) => requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">R$</span>
      <input
        ref={ref}
        inputMode="numeric"
        className={cn(control, 'h-10 pl-9 pr-3 text-right tabular-nums', className)}
        value={shown}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
          const el = e.currentTarget
          const all = el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0
          if (/^\d$/.test(e.key)) {
            e.preventDefault()
            onValueChange(Math.min(MONEY_MAX, (all ? 0 : value) * 10 + Number(e.key)))
            toEnd(el)
          } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault()
            onValueChange(all ? 0 : Math.floor(value / 10))
            toEnd(el)
          }
        }}
        // ao focar, seleciona tudo: clicou e digitou = valor novo (antes o cursor ia para o fim e um
        // Ctrl+A rápido perdia a seleção, somando os dígitos ao valor antigo)
        onFocus={(e) => { onFocus?.(e); const el = e.currentTarget; requestAnimationFrame(() => { if (document.activeElement === el) el.select() }) }}
        // colar ou ditar: usa só os dígitos do que chegou
        onChange={(e) => onValueChange(Math.min(MONEY_MAX, Number(e.target.value.replace(/\D/g, '') || 0)))}
        {...rest}
      />
    </div>
  )
})

/**
 * Botão de envio invisível: com vários campos e o botão "Salvar" fora do <form> (rodapé do modal),
 * o navegador não envia com Enter. Este botão dentro do form devolve o Enter. Fica fora do Tab.
 */
export function EnterSubmits() {
  return <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
}

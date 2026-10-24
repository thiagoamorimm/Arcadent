import clsx, { type ClassValue } from 'clsx'

export const cn = (...v: ClassValue[]) => clsx(v)

/** Centavos → "R$ 1.234,56" */
export const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** plural(2, 'tratamento finalizado', 'tratamentos finalizados') → "2 tratamentos finalizados" */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

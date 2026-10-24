import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { useRef, useState } from 'react'
import { ApiError, get, post } from '../api/client'
import type { Account, Guardian, Payment, ReceiptT } from '../api/types'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Choice'
import { useToast } from '../ui/Feedback'
import { Field, Input, MoneyInput, Select, EnterSubmits } from '../ui/Field'
import { Modal } from '../ui/Overlay'
import { formatMoney } from '../ui/cn'

export const METHODS: [string, string][] = [
  ['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['cartao_credito', 'Cartão de crédito'], ['cartao_debito', 'Cartão de débito'],
  ['transferencia', 'Transferência'], ['cheque', 'Cheque'], ['boleto', 'Boleto'], ['outro', 'Outro'],
]
export const methodLabel = (m: string | null | undefined) => (m ? m.split(', ').map((x) => METHODS.find(([v]) => v === x)?.[1] ?? x).join(', ') : '')

/** Tudo que mostra dinheiro recebido precisa recarregar depois de um recebimento. */
export const MONEY_KEYS = ['debits', 'payments', 'patient', 'patients', 'cashflow', 'receipts']

/**
 * Registrar recebimento (total ou parcial) de um débito ou receita sem vínculo, com opção de emitir o
 * recibo na hora. Idempotency-Key por abertura + trava de clique: duplo clique não duplica nada.
 */
export function ReceiveModal({ debit, needsPayer, guardian, onClose, onReceipt }: {
  debit: { id: string; description: string; amountCents: number; paidCents: number }
  /** receita sem paciente: o recibo precisa de "em nome de" */
  needsPayer?: boolean
  /** responsável cadastrado: vira a opção pronta de "em nome de" */
  guardian?: Guardian | null
  onClose: () => void
  onReceipt?: (r: ReceiptT) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const remaining = debit.amountCents - debit.paidCents
  const [amount, setAmount] = useState(remaining)
  const [method, setMethod] = useState('pix')
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => get<Account[]>('/financial-accounts') })
  const [account, setAccount] = useState('')
  const [withReceipt, setWithReceipt] = useState(true)
  const [otherPayer, setOtherPayer] = useState(!!needsPayer)
  const [payer, setPayer] = useState({ name: '', cpf: '' })
  const asGuardian = !!guardian && otherPayer && payer.name === guardian.name && payer.cpf === (guardian.cpf ?? '')
  const [idemKey] = useState(() => crypto.randomUUID())
  const sent = useRef(false)
  const accountId = account || accounts.data?.[0]?.id || ''
  const payerMissing = withReceipt && otherPayer && !payer.name.trim()
  const invalid = amount <= 0 || amount > remaining || payerMissing

  const pay = useMutation({
    mutationFn: async () => {
      const r = await post<{ payment: Payment }>(`/debits/${debit.id}/payments`, { amountCents: amount, method, financialAccountId: accountId }, { 'Idempotency-Key': idemKey })
      if (!withReceipt) return { receipt: null }
      // Se o recibo falhar, o pagamento já está salvo: dá para emitir depois em Recibos/Débitos.
      try {
        const receipt = await post<ReceiptT>('/receipts', { paymentIds: [r.payment.id], payer: otherPayer ? payer : undefined })
        return { receipt }
      } catch (e) {
        return { receipt: null, receiptError: e instanceof ApiError ? e.message : 'Não foi possível emitir o recibo.' }
      }
    },
    onError: () => { sent.current = false },
    onSuccess: (res) => {
      MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      toast('success', `Recebido ${formatMoney(amount)}${res.receipt ? ` · recibo nº ${res.receipt.number}` : ''}.`)
      if ('receiptError' in res && res.receiptError) toast('danger', `Pagamento salvo, mas o recibo não saiu: ${res.receiptError}`)
      onClose()
      if (res.receipt) onReceipt?.(res.receipt)
    },
  })
  const submit = () => {
    if (invalid || !accountId || sent.current) return
    sent.current = true
    pay.mutate()
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Registrar recebimento" description={`${debit.description} · saldo ${formatMoney(remaining)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={invalid || !accountId} loading={pay.isPending} onClick={submit}>Confirmar recebimento</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <EnterSubmits />
        {pay.isError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{pay.error instanceof ApiError ? pay.error.message : 'Não foi possível registrar.'}</p>}
        <Field label="Valor" required error={amount > remaining ? `Máximo: ${formatMoney(remaining)}` : amount <= 0 ? 'Informe um valor.' : undefined} hint={amount < remaining ? 'Valor menor que o saldo: fica como pagamento parcial.' : undefined}>
          <MoneyInput value={amount} onValueChange={setAmount} />
        </Field>
        <Field label="Forma de pagamento" required>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Conta onde entrou" required className="sm:col-span-2">
          <Select value={accountId} onChange={(e) => setAccount(e.target.value)}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:col-span-2">
          <Checkbox label="Emitir recibo agora" checked={withReceipt} onCheckedChange={setWithReceipt} />
          {withReceipt && !needsPayer && guardian && (
            <Checkbox label={`Recibo em nome do responsável: ${guardian.name}${guardian.relation ? ` (${guardian.relation})` : ''}`} checked={asGuardian}
              onCheckedChange={(v) => { setOtherPayer(v); setPayer(v ? { name: guardian.name, cpf: guardian.cpf ?? '' } : { name: '', cpf: '' }) }} />
          )}
          {withReceipt && !needsPayer && <Checkbox label={guardian ? 'Em nome de outra pessoa' : 'Recibo em nome de outra pessoa (ex.: responsável)'} checked={otherPayer && !asGuardian}
            onCheckedChange={(v) => { setOtherPayer(v); setPayer({ name: '', cpf: '' }) }} />}
          {withReceipt && otherPayer && !asGuardian && (
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <Field label="Em nome de" required error={payerMissing ? 'Informe o nome.' : undefined}><Input value={payer.name} onChange={(e) => setPayer({ ...payer, name: e.target.value })} /></Field>
              <Field label="CPF ou CNPJ"><Input value={payer.cpf} onChange={(e) => setPayer({ ...payer, cpf: e.target.value })} /></Field>
            </div>
          )}
        </div>
        <p className="flex items-start gap-2 text-xs text-text-muted sm:col-span-2"><CalendarClock aria-hidden className="mt-0.5 size-3.5" />O recebimento é registrado com a data e hora de agora.</p>
      </form>
    </Modal>
  )
}

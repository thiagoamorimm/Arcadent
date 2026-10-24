import { CheckCircle2, Eye, Lock } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Feedback'
import { SettingsLayout } from './SettingsLayout'

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  trialing: { label: 'Período de teste', tone: 'warning' },
  active: { label: 'Ativa', tone: 'success' },
  past_due: { label: 'Pagamento em atraso', tone: 'danger' },
  read_only: { label: 'Modo leitura', tone: 'danger' },
  canceled: { label: 'Cancelada', tone: 'danger' },
}
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—')

/**
 * Ajustes > Assinatura: situação da assinatura da clínica e o que o modo leitura significa.
 * A contratação online entra quando o meio de pagamento for escolhido.
 */
export function SubscriptionSettings() {
  const { me } = useAuth()
  if (!me) return null
  const st = me.read_only && me.subscription_status === 'trialing' ? { label: 'Teste encerrado', tone: 'danger' as const } : STATUS[me.subscription_status] ?? { label: me.subscription_status, tone: 'neutral' as const }
  return (
    <SettingsLayout title="Assinatura" description="Situação da assinatura desta clínica.">
      <div className="flex max-w-2xl flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{me.clinic_name}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {me.subscription_status === 'trialing' && <div><dt className="text-xs text-text-muted">{me.read_only ? 'Teste terminou em' : 'Teste termina em'}</dt><dd className="font-medium">{fmt(me.trial_ends_at)}</dd></div>}
            {me.current_period_end && <div><dt className="text-xs text-text-muted">Período pago até</dt><dd className="font-medium">{fmt(me.current_period_end)}</dd></div>}
          </dl>
        </Card>
        <Card className="flex flex-col gap-3 p-4 text-sm">
          <h3 className="font-semibold">Quando a assinatura não está em dia</h3>
          <p className="flex items-start gap-2"><Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" /><span>A clínica entra em <strong>modo leitura</strong>: agenda, fichas, prontuário, financeiro e PDFs continuam abertos para consulta.</span></p>
          <p className="flex items-start gap-2"><Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" /><span>Não dá para lançar nada novo (consultas, evoluções, recebimentos…) até regularizar.</span></p>
          <p className="flex items-start gap-2"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /><span>Nenhum dado é apagado. Ao regularizar, tudo volta a funcionar na hora.</span></p>
        </Card>
      </div>
    </SettingsLayout>
  )
}

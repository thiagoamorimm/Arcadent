import { Construction } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AppShell, ReadOnlyBanner } from '../domain/AppShell'
import { EmptyState, useToast } from '../ui/Feedback'

/** Moldura logada com os dados reais da sessão (clínica, usuário, dias de teste). */
export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { me, logout, can, switchClinic } = useAuth()
  // aba do navegador: tela atual + produto (quem trabalha com várias abas abertas acha a certa)
  useEffect(() => { document.title = `${title} · Arcadent` }, [title])
  const nav = useNavigate()
  const toast = useToast()
  const onSwitch = async (id: string) => {
    try {
      await switchClinic(id)
      nav('/agenda', { replace: true })
      toast('success', `Agora em ${me?.clinics.find((c) => c.id === id)?.name ?? 'outra clínica'}.`)
    } catch (e) {
      toast('danger', e instanceof ApiError ? e.message : 'Não foi possível trocar de clínica.')
    }
  }
  const showSettings = ['config.clinic', 'config.team', 'config.plans', 'config.records', 'config.anamnesis', 'config.finance'].some(can)
  const trialDays = me?.subscription_status === 'trialing' && !me.read_only && me.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(me.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : undefined
  return (
    <AppShell clinic={me?.clinic_name ?? '…'} user={me?.user_name ?? '…'} title={title} actions={actions} trialDaysLeft={trialDays} onLogout={logout} showSettings={showSettings}
      clinics={me?.clinics} currentClinicId={me?.clinic_id} onSwitchClinic={onSwitch} notice={me?.read_only ? <ReadOnlyBanner /> : undefined} can={me ? can : undefined}>
      {children}
    </AppShell>
  )
}

/** Telas do inventário que ainda não foram construídas (rota existe, conteúdo vem depois). */
export function StubPage({ title, screen }: { title: string; screen: string }) {
  return (
    <Page title={title}>
      <EmptyState
        icon={<Construction className="size-5" />}
        title="Em construção"
        body={`Esta área (${screen}) entra nas próximas etapas. A agenda, os pacientes e o orçamento já funcionam.`}
      />
    </Page>
  )
}

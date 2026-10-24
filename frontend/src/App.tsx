import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ApiError } from './api/client'
import { AuthProvider, RequireAuth, RequirePerm } from './auth/AuthContext'
import { ToastProvider } from './ui/Feedback'
import { AgendaPage } from './pages/AgendaPage'
import { ForgotPage, LoginPage, ResetPage, SignupPage } from './pages/AuthPages'
import { BudgetEditorPage } from './pages/BudgetEditorPage'
import { DesignPage } from './pages/DesignPage'
import { FinancePage } from './pages/FinancePage'
import { InvitePage } from './pages/InvitePage'
import { PriceSettings } from './pages/settings/PriceSettings'
import { FinanceSettings, LabelsSettings } from './pages/settings/RecordsSettings'
import { SettingsIndex } from './pages/settings/SettingsLayout'
import { ClinicSettings } from './pages/settings/ClinicSettings'
import { AnamnesisSettings } from './pages/settings/AnamnesisSettings'
import { TeamSettings } from './pages/settings/TeamSettings'
import { AuditSettings } from './pages/settings/AuditSettings'
import { SubscriptionSettings } from './pages/settings/SubscriptionSettings'
import { StubPage } from './pages/Layout'
import { InsightsPage } from './pages/InsightsPage'
import { ProsthesisPage } from './pages/ProsthesisPage'
import { StockPage } from './pages/StockPage'
import { PatientPage } from './pages/PatientPage'
import { PatientsPage } from './pages/PatientsPage'
import { ShellPreview } from './pages/ShellPreview'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // 4xx não melhora tentando de novo; erro de rede/5xx tenta 2x.
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
    // Gravação sem internet falha na hora ("Sem conexão…") em vez de ficar pausada girando e ser
    // reenviada sozinha quando a rede volta (a pessoa já pode ter refeito: cadastro em dobro).
    mutations: { networkMode: 'always' },
  },
})

const inside = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/entrar" element={<LoginPage />} />
              <Route path="/criar-conta" element={<SignupPage />} />
              <Route path="/esqueci-senha" element={<ForgotPage />} />
              <Route path="/redefinir-senha" element={<ResetPage />} />
              <Route path="/convite/:token" element={<InvitePage />} />

              <Route path="/agenda" element={inside(<AgendaPage />)} />
              <Route path="/pacientes" element={inside(<PatientsPage />)} />
              <Route path="/pacientes/:id/orcamentos/novo" element={inside(<BudgetEditorPage />)} />
              <Route path="/pacientes/:id/:tab?" element={inside(<PatientPage />)} />

              {/* Telas do inventário ainda não construídas: rota existe, conteúdo vem depois. */}
              <Route path="/financeiro/:tab?" element={inside(<RequirePerm perm={['fin.debits_view', 'fin.expenses_view']}><FinancePage /></RequirePerm>)} />
              <Route path="/indicadores/:tab?" element={inside(<RequirePerm perm={['insight.performance', 'insight.tasks']}><InsightsPage /></RequirePerm>)} />
              <Route path="/protese" element={inside(<RequirePerm perm="prosthesis.manage"><ProsthesisPage /></RequirePerm>)} />
              <Route path="/estoque" element={inside(<RequirePerm perm="stock.manage"><StockPage /></RequirePerm>)} />
              <Route path="/ajustes" element={inside(<SettingsIndex />)} />
              <Route path="/ajustes/clinica" element={inside(<RequirePerm perm="config.clinic"><ClinicSettings /></RequirePerm>)} />
              <Route path="/ajustes/equipe" element={inside(<RequirePerm perm="config.team"><TeamSettings /></RequirePerm>)} />
              <Route path="/ajustes/auditoria" element={inside(<RequirePerm perm="config.team"><AuditSettings /></RequirePerm>)} />
              <Route path="/ajustes/assinatura" element={inside(<SubscriptionSettings />)} />
              <Route path="/ajustes/precos" element={inside(<RequirePerm perm="config.plans"><PriceSettings /></RequirePerm>)} />
              <Route path="/ajustes/rotulos" element={inside(<RequirePerm perm="config.records"><LabelsSettings /></RequirePerm>)} />
              <Route path="/ajustes/anamnese" element={inside(<RequirePerm perm="config.anamnesis"><AnamnesisSettings /></RequirePerm>)} />
              <Route path="/ajustes/financeiro" element={inside(<RequirePerm perm="config.finance"><FinanceSettings /></RequirePerm>)} />
              <Route path="/ajustes/*" element={inside(<StubPage title="Ajustes" screen="S32" />)} />

              <Route path="/design" element={<DesignPage />} />
              <Route path="/design/shell" element={<ShellPreview />} />
              <Route path="*" element={<Navigate to="/agenda" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

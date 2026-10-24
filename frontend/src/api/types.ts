import type { AppointmentStatus } from '../ui/Badge'
import type { Face } from '../domain/Odontogram'
import type { WeekHours } from '../lib/tz'

export interface ClinicRef { id: string; name: string; role: string }
export interface Session { token: string; refreshToken: string; userId: string; userName: string; clinicId: string; clinicName: string; clinics: ClinicRef[] }
export interface Me {
  user_id: string; user_name: string; email: string; clinic_id: string; clinic_name: string; timezone: string
  membership_id: string; role: string; does_attend: boolean; subscription_status: string; trial_ends_at: string | null
  plan: string; current_period_end: string | null; read_only: boolean
  permissions: string[]
  clinics: ClinicRef[]
}

export interface Professional { id: string; name: string; color: string | null; role: string; workHours: WeekHours }
export interface Clinic { id: string; name: string; phone: string | null; email: string | null; document: string | null; timezone: string; businessHours: WeekHours; slotMinutes: number }
export interface Procedure { id: string; name: string; tussCode: string | null; specialty: string | null; priceCents: number; scope: string }
export interface Account { id: string; name: string; kind: 'cash' | 'bank'; isDefault: boolean }
export interface Label { id: string; name: string; color: string }

export interface Appointment {
  id: string; kind: 'consulta' | 'compromisso' | 'bloqueio'
  patientId: string | null; patientName: string | null; patientPhone: string | null
  professionalId: string; professionalName: string; chairId: string | null
  labelId: string | null; labelColor: string | null; labelName: string | null
  startAt: string; endAt: string; title: string | null; notes: string | null
  status: AppointmentStatus; overlapAllowed: boolean; outsideHours: boolean
}
export interface ConflictInfo { id: string; kind: string; who: string; startAt: string; endAt: string }

export interface PatientRow { id: string; name: string; phone: string | null; cpf: string | null; birthDate: string | null; nextVisit: string | null; lastVisit: string | null; balanceCents: number }
export interface Page<T> { items: T[]; total: number; page: number; size: number }
export interface Patient {
  id: string; name: string; birthDate: string | null; cpf: string | null; phone: string | null; email: string | null
  isForeign: boolean; notes: string | null; createdAt: string; nextVisit: string | null; balanceCents: number; openTreatments: number
  clinicalAlerts: string[]
  guardian: Guardian | null
}
export interface Guardian { name: string; cpf: string | null; phone: string | null; relation: string | null }

export interface BudgetItem { id: string; procedureId: string; procedureName: string; tooth: number | null; faces: Face[]; region: string | null; priceCents: number; approved: boolean | null }
export interface Budget {
  id: string; number: number; patientId: string; professionalId: string; professionalName: string
  status: 'open' | 'approved' | 'partial' | 'rejected'
  subtotalCents: number; discountCents: number; totalCents: number; installments: number; firstDueDate: string | null
  notes: string | null; createdAt: string; approvedAt: string | null; items: BudgetItem[]
}

export interface Treatment {
  id: string; procedureId: string; procedureName: string; specialty: string | null; professionalId: string; professionalName: string
  tooth: number | null; faces: Face[]; region: string | null; priceCents: number; status: 'open' | 'done' | 'canceled'
  doneAt: string | null; createdAt: string; budgetNumber: number | null
}

export interface Debit {
  id: string; description: string; amountCents: number; paidCents: number; dueDate: string
  installmentNo: number | null; installments: number | null; status: 'open' | 'partial' | 'paid' | 'canceled'; budgetId: string | null; overdue: boolean
}
export interface Payment { id: string; debitId: string; amountCents: number; method: string; paidAt: string; accountName: string; receiptId: string | null; receiptNumber: number | null; description: string }

export interface PermDef { code: string; label: string; hint: string | null }
export interface PermGroup { key: string; label: string; perms: PermDef[] }
export interface PermCatalog { groups: PermGroup[]; presets: Record<'dentist' | 'secretary' | 'custom', string[]> }
export type Role = 'owner' | 'dentist' | 'secretary' | 'custom'
export interface Member {
  id: string; userId: string; name: string; email: string; role: Role; permissions: string[]; doesAttend: boolean
  isActive: boolean; color: string | null; cro: string | null; specialty: string | null; lastLoginAt: string | null; isMe: boolean
}
export interface Invitation { id: string; email: string; name: string | null; role: Role; permissions: string[]; doesAttend: boolean; expiresAt: string; createdAt: string }
export interface Team { members: Member[]; invitations: Invitation[] }
export interface InvitePreview { clinicName: string; email: string; name: string | null; role: Role; hasAccount: boolean }

export interface PriceTable { id: string; name: string; kind: 'particular' | 'convenio'; isDefault: boolean; isActive: boolean; procedureCount: number }
export type Scope = 'tooth' | 'face' | 'region' | 'arch' | 'mouth'
export interface ProcedureFull { id: string; priceTableId: string; name: string; tussCode: string | null; specialty: string | null; priceCents: number; costCents: number; scope: Scope; isActive: boolean }
export interface LabelFull { id: string; name: string; color: string; usage: number }
export interface AccountFull { id: string; name: string; kind: 'bank' | 'cash'; isDefault: boolean; isActive: boolean; usage: number }
export interface Category { id: string; name: string; kind: 'expense' | 'income'; usage: number }

export type QuestionType = 'yesno' | 'choice' | 'text'
export interface Question { id: string; text: string; type: QuestionType; options?: string[]; withDetail?: boolean; alertOn?: string; alert?: string }
export interface AnamnesisTemplate { id: string; name: string; questions: Question[]; isActive: boolean; usage: number }
export interface Answer { value?: string | null; detail?: string | null }
export interface Anamnesis {
  id: string; patientId: string; templateId: string | null; templateName: string; questions: Question[]
  answers: Record<string, Answer>; status: 'draft' | 'completed'; alerts: string[]; professionalName: string | null
  createdAt: string; completedAt: string | null
}
export interface Evolution {
  id: string; treatmentId: string | null; treatmentLabel: string | null; professionalId: string; professionalName: string
  body: string; occurredAt: string; createdAt: string; updatedAt: string; edited: boolean; canEdit: boolean
  files: { id: string; fileName: string; mimeType: string; kind: FileKind }[]
}
export interface DocItem { id: string; kind: 'prescription' | 'certificate'; title: string; professionalName: string; createdAt: string }
export type FileKind = 'photo' | 'xray' | 'ct' | 'stl' | 'pdf' | 'other'
export interface PatientFile { id: string; kind: FileKind; fileName: string; mimeType: string; sizeBytes: number; takenAt: string | null; uploadedBy: string | null; createdAt: string; evolutionId: string | null }

export interface ReceiptT {
  id: string; number: number; patientId: string | null; patientName: string | null; payerName: string; payerCpf: string | null
  totalCents: number; issuedAt: string; canceledAt: string | null; issuedBy: string | null
}
export type CashType = 'receita' | 'receita_sem_vinculo' | 'despesa'
export type CashStatus = 'pago' | 'parcial' | 'a_vencer' | 'atrasado'
export interface CashRow {
  type: CashType; id: string; description: string; patientId: string | null; patientName: string | null
  amountCents: number; paidCents: number; dueDate: string; paidAt: string | null; status: CashStatus
  categoryId: string | null; categoryName: string | null; accountName: string | null; method: string | null
}
export interface CashTotals { receivedCents: number; toReceiveCents: number; overdueReceivableCents: number; paidCents: number; toPayCents: number; overduePayableCents: number; balanceCents: number }
export interface Cashflow { from: string; to: string; totals: CashTotals; rows: CashRow[] }
export interface ToothNote { id: string; tooth: number; note: string; authorName: string | null; createdAt: string; canDelete: boolean }

export interface StockProduct { id: string; name: string; unit: string; category: string | null; minQty: number; qty: number; costCents: number | null; isActive: boolean; low: boolean; lastMovementAt: string | null }
export interface StockMovement { id: string; kind: 'entrada' | 'saida' | 'ajuste'; qty: number; balance: number; costCents: number | null; reason: string | null; userName: string | null; createdAt: string }

export type ProsthesisStage = 'pre_lab' | 'envio' | 'laboratorio' | 'prova' | 'realizado'
export interface ProsthesisOrder {
  id: string; patientId: string; patientName: string; treatmentId: string | null; professionalId: string | null; professionalName: string | null
  description: string; laboratory: string | null; stage: ProsthesisStage; dueDate: string | null; costCents: number | null; notes: string | null
  late: boolean; daysInStage: number; createdAt: string; stageAt: string | null
}
export interface ProsthesisEvent { stage: ProsthesisStage; note: string | null; userName: string | null; at: string }

export interface InsightNumbers {
  appointments: number; attended: number; noShows: number; canceled: number; newPatients: number
  budgetsCreated: number; budgetsCreatedCents: number; budgetsApproved: number; budgetsApprovedCents: number
  receivedCents: number; paidCents: number
}
export interface Performance {
  from: string; to: string; current: InsightNumbers; previous: InsightNumbers
  months: { month: string; receivedCents: number; paidCents: number }[]
  byProfessional: { professional: string; attended: number; no_shows: number; produced_cents: number }[]
}
export interface InsightTasks {
  birthdays: { id: string; name: string; phone: string | null; birthDate: string; day: number; turns: number; today: boolean }[]
  debtors: { id: string; name: string; phone: string | null; overdueCents: number; oldestDue: string; daysLate: number }[]
  withoutAppointment: { id: string; name: string; phone: string | null; openTreatments: number; lastVisit: string | null }[]
}
export interface TreatmentHistory { action: string; at: string; userName: string | null; before: string | null; after: string | null; note: string | null }

-- =============================================================================
-- Schema inicial do Arcadent (núcleo clínico) — migration Flyway V1__init.sql
-- Postgres 16. Multi-tenant por clinic_id + Row Level Security.
--
-- Convenções:
--   * id uuid, created_at/updated_at timestamptz (UTC)
--   * toda tabela de clínica tem clinic_id e UNIQUE (clinic_id, id); as FKs entre
--     tabelas de clínica são compostas (clinic_id, x_id) → impossível apontar para
--     registro de outra clínica, mesmo com bug no código
--   * dinheiro em centavos (bigint) + currency char(3) default 'BRL'
--   * dentes em notação FDI (11–48 permanentes, 51–85 decíduos)
--   * faces: M mesial, D distal, O oclusal/incisal, V vestibular, L lingual/palatina
--   * prontuário não é apagado de verdade (deleted_at): guarda legal obrigatória
-- =============================================================================

create extension if not exists btree_gist;   -- exclusão de sobreposição na agenda
create extension if not exists pg_trgm;      -- busca de paciente por nome

-- -----------------------------------------------------------------------------
-- Helpers de tenant: a aplicação faz SET LOCAL app.clinic_id / app.user_id
-- no início de cada transação. Sem isso, RLS não devolve nenhuma linha.
-- -----------------------------------------------------------------------------
create or replace function app_clinic_id() returns uuid
  language sql stable as
$$ select nullif(current_setting('app.clinic_id', true), '')::uuid $$;

create or replace function app_user_id() returns uuid
  language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function touch_updated_at() returns trigger
  language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;

-- =============================================================================
-- Identidade (global, fora do tenant)
-- =============================================================================
create table users (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null,
  phone           text,
  password_hash   text not null,
  avatar_url      text,
  totp_secret     text,                       -- 2FA opcional
  email_verified_at timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index on refresh_tokens (user_id);

create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on password_resets (user_id);

-- =============================================================================
-- Clínica (tenant) e assinatura do SaaS
-- =============================================================================
create table clinics (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,        -- link público de agendamento
  document        text,                        -- CPF ou CNPJ
  phone           text,
  email           text,
  address         jsonb not null default '{}',
  logo_url        text,
  timezone        text not null default 'America/Sao_Paulo',
  business_hours  jsonb not null default '{}', -- {"mon":[["08:00","12:00"],["13:00","18:00"]],...}
  slot_minutes    smallint not null default 30 check (slot_minutes in (5,10,15,20,30,60)),
  settings        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Billing: só o estado. O provedor (Stripe/Asaas/...) é decidido depois e entra
-- por um adapter que escreve aqui. O app só lê "status" para liberar/limitar.
create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null unique references clinics(id) on delete cascade,
  plan               text not null default 'trial'
                       check (plan in ('trial','basic','plus','pro')),
  status             text not null default 'trialing'
                       check (status in ('trialing','active','past_due','read_only','canceled')),
  trial_ends_at      timestamptz,
  current_period_end timestamptz,
  provider           text,                     -- null até decidir o provedor
  provider_ref       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table memberships (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id) on delete cascade,
  user_id        uuid not null references users(id) on delete restrict,
  role           text not null check (role in ('owner','dentist','secretary','custom')),
  permissions    text[] not null default '{}', -- códigos: 'agenda.delete','financeiro.pay',...
  is_active      boolean not null default true,
  does_attend    boolean not null default false, -- "fazer atendimentos": tem agenda
  color          text,
  cro            text,                          -- registro no conselho (dentista)
  specialty      text,
  work_hours     jsonb not null default '{}',   -- mesmo formato de clinics.business_hours
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (clinic_id, user_id),
  unique (clinic_id, id)
);
create index on memberships (user_id);

create table invitations (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('dentist','secretary','custom')),
  permissions text[] not null default '{}',
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  invited_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on invitations (clinic_id);

-- Contador sequencial por clínica (nº de recibo, nº de orçamento)
create table clinic_counters (
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null check (name in ('receipt','budget')),
  value      bigint not null default 0,
  primary key (clinic_id, name)
);

-- =============================================================================
-- Cadastros auxiliares
-- =============================================================================
create table chairs (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create table labels (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  color      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);

-- Tabela de preço: "Particular" ou um convênio
create table price_tables (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('particular','convenio')),
  is_default boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);
create unique index price_tables_one_default on price_tables (clinic_id) where is_default;

create table procedures (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null,
  price_table_id uuid not null,
  name           text not null,
  tuss_code      text,
  specialty      text,                 -- 'protese','ortodontia','hof',...
  price_cents    bigint not null default 0 check (price_cents >= 0),
  cost_cents     bigint not null default 0 check (cost_cents >= 0),
  currency       char(3) not null default 'BRL',
  scope          text not null default 'tooth'
                   check (scope in ('tooth','face','region','arch','mouth')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, price_table_id) references price_tables (clinic_id, id) on delete cascade
);
create index on procedures (clinic_id, price_table_id);
create index on procedures (clinic_id, tuss_code);
create index procedures_name_trgm on procedures using gin (name gin_trgm_ops);

create table financial_accounts (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('bank','cash')),   -- cash = "espécie"
  is_default boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);
create unique index financial_accounts_one_default on financial_accounts (clinic_id) where is_default;

create table categories (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('expense','income')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  unique (clinic_id, kind, name)
);

-- =============================================================================
-- Pacientes
-- =============================================================================
create table patients (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),  -- único obrigatório
  birth_date      date,
  cpf             text,
  phone           text,
  email           text,
  gender          text,
  address         jsonb not null default '{}',
  is_foreign      boolean not null default false,
  foreign_doc     text,
  guardian        jsonb,              -- {"name","cpf","phone","relation"}
  photo_url       text,
  tags            text[] not null default '{}',
  notes           text,
  price_table_id  uuid,               -- convênio padrão
  dentist_id      uuid,               -- membership responsável
  clinical_alerts text[] not null default '{}',  -- vindos da anamnese
  deleted_at      timestamptz,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, price_table_id) references price_tables (clinic_id, id) on delete set null (price_table_id),
  foreign key (clinic_id, dentist_id) references memberships (clinic_id, id) on delete set null (dentist_id)
);
create unique index patients_cpf_uq on patients (clinic_id, cpf) where cpf is not null and deleted_at is null;
create index patients_name_trgm on patients using gin (name gin_trgm_ops);
create index on patients (clinic_id, phone);
create index on patients (clinic_id, birth_date);
create index on patients (clinic_id, dentist_id);
create index on patients (clinic_id, price_table_id);

-- =============================================================================
-- Agenda
-- =============================================================================
create table appointment_series (           -- recorrência; ocorrências materializadas
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id) on delete cascade,
  rrule          text not null,             -- RFC 5545, ex.: FREQ=WEEKLY;BYDAY=TU;COUNT=10
  materialized_until date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (clinic_id, id)
);

create table appointments (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  kind             text not null default 'consulta'
                     check (kind in ('consulta','compromisso','bloqueio')),
  patient_id       uuid,
  professional_id  uuid not null,
  chair_id         uuid,
  label_id         uuid,
  series_id        uuid,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  title            text,                      -- compromisso/bloqueio
  notes            text,
  status           text not null default 'agendado'
                     check (status in ('agendado','confirmado','aguardando','em_atendimento',
                                       'atendido','faltou','cancelado')),
  overlap_allowed  boolean not null default false, -- encaixe consciente ("marcar mesmo assim")
  confirmed_via    text check (confirmed_via in ('manual','whatsapp','link')),
  source           text not null default 'interno' check (source in ('interno','link_publico')),
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, id),
  constraint appt_positive check (end_at > start_at),
  constraint appt_patient_required check (kind <> 'consulta' or patient_id is not null),
  foreign key (clinic_id, patient_id)      references patients (clinic_id, id)       on delete restrict,
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id)    on delete restrict,
  foreign key (clinic_id, chair_id)        references chairs (clinic_id, id)         on delete set null (chair_id),
  foreign key (clinic_id, label_id)        references labels (clinic_id, id)         on delete set null (label_id),
  foreign key (clinic_id, series_id)       references appointment_series (clinic_id, id) on delete set null (series_id),
  -- Dois horários ativos do mesmo profissional não se sobrepõem, salvo encaixe consciente.
  constraint appt_no_overlap_professional exclude using gist (
    professional_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status not in ('cancelado','faltou') and not overlap_allowed),
  -- Uma cadeira não recebe dois atendimentos ao mesmo tempo (sem exceção).
  constraint appt_no_overlap_chair exclude using gist (
    chair_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (chair_id is not null and status not in ('cancelado','faltou'))
);
create index on appointments (clinic_id, start_at);
create index on appointments (clinic_id, professional_id, start_at);
create index on appointments (clinic_id, chair_id, start_at);
create index on appointments (clinic_id, patient_id, start_at);
create index on appointments (clinic_id, status, start_at);
create index on appointments (clinic_id, series_id);
create index on appointments (clinic_id, label_id);

create table waitlist_entries (             -- gestão de encaixe
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  patient_id       uuid not null,
  professional_id  uuid,
  desired_date     date,                     -- null = qualquer data
  shift            text not null default 'qualquer'
                     check (shift in ('manha','tarde','noite','qualquer')),
  price_table_id   uuid,
  urgent           boolean not null default false,
  label_id         uuid,
  notes            text,
  appointment_id   uuid,                     -- preenchido quando encaixado
  resolved_at      timestamptz,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id)      references patients (clinic_id, id)     on delete cascade,
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id)  on delete set null (professional_id),
  foreign key (clinic_id, price_table_id)  references price_tables (clinic_id, id) on delete set null (price_table_id),
  foreign key (clinic_id, label_id)        references labels (clinic_id, id)       on delete set null (label_id),
  foreign key (clinic_id, appointment_id)  references appointments (clinic_id, id) on delete set null (appointment_id)
);
-- fila: urgentes primeiro, depois os mais antigos
create index waitlist_open_idx on waitlist_entries (clinic_id, urgent desc, created_at) where resolved_at is null;
create index on waitlist_entries (clinic_id, patient_id);

create table return_alerts (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  patient_id  uuid not null,
  due_date    date not null,
  notes       text,
  done_at     timestamptz,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade
);
create index return_alerts_open_idx on return_alerts (clinic_id, due_date) where done_at is null;
create index on return_alerts (clinic_id, patient_id);

-- =============================================================================
-- Anamnese
-- =============================================================================
create table anamnesis_templates (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  questions  jsonb not null default '[]',  -- [{id,text,type:'yesno'|'text'|'choice',options,alert_on}]
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create table anamneses (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  patient_id    uuid not null,
  template_id   uuid,
  template_snapshot jsonb not null,           -- perguntas como estavam no dia
  answers       jsonb not null default '{}',
  filled_by     text not null check (filled_by in ('professional','patient')),
  status        text not null default 'draft' check (status in ('draft','pending_patient','completed')),
  alerts        text[] not null default '{}',
  completed_at  timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id)  references patients (clinic_id, id)            on delete restrict,
  foreign key (clinic_id, template_id) references anamnesis_templates (clinic_id, id) on delete set null (template_id)
);
create index on anamneses (clinic_id, patient_id, created_at desc);
create index on anamneses (clinic_id, template_id);

-- =============================================================================
-- Orçamento → tratamento → evolução
-- =============================================================================
create table budgets (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  number           bigint not null,                 -- de clinic_counters
  patient_id       uuid not null,
  professional_id  uuid not null,
  price_table_id   uuid,
  status           text not null default 'open'
                     check (status in ('open','approved','partial','rejected')),
  discount_cents   bigint not null default 0 check (discount_cents >= 0),
  total_cents      bigint not null default 0 check (total_cents >= 0),  -- já com desconto
  currency         char(3) not null default 'BRL',
  installments     smallint not null default 1 check (installments between 1 and 60),
  first_due_date   date,
  hide_cost        boolean not null default false,
  notes            text,
  approved_at      timestamptz,
  rejected_reason  text,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, id),
  unique (clinic_id, number),
  foreign key (clinic_id, patient_id)      references patients (clinic_id, id)     on delete restrict,
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id)  on delete restrict,
  foreign key (clinic_id, price_table_id)  references price_tables (clinic_id, id) on delete set null (price_table_id)
);
create index on budgets (clinic_id, patient_id, created_at desc);
create index on budgets (clinic_id, status, created_at desc);
create index on budgets (clinic_id, professional_id);
create index on budgets (clinic_id, price_table_id);

create table budget_items (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  budget_id     uuid not null,
  procedure_id  uuid not null,
  tooth         smallint check (tooth is null or tooth between 11 and 48 or tooth between 51 and 85),
  faces         text[] not null default '{}' check (faces <@ array['M','D','O','V','L']::text[]),
  region        text,                         -- 'arcada_superior','sextante_1',...
  price_cents   bigint not null check (price_cents >= 0),
  currency      char(3) not null default 'BRL',
  approved      boolean,                      -- null = em aberto; aprovação parcial por item
  position      smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, budget_id)    references budgets (clinic_id, id)    on delete cascade,
  foreign key (clinic_id, procedure_id) references procedures (clinic_id, id) on delete restrict
);
create index on budget_items (clinic_id, budget_id);
create index on budget_items (clinic_id, procedure_id);

create table treatments (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  patient_id       uuid not null,
  budget_item_id   uuid unique,                 -- 1 item aprovado = 1 tratamento
  procedure_id     uuid not null,
  professional_id  uuid not null,
  tooth            smallint check (tooth is null or tooth between 11 and 48 or tooth between 51 and 85),
  faces            text[] not null default '{}' check (faces <@ array['M','D','O','V','L']::text[]),
  region           text,
  price_cents      bigint not null default 0 check (price_cents >= 0),
  currency         char(3) not null default 'BRL',
  status           text not null default 'open' check (status in ('open','done','canceled')),
  done_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, id),
  constraint treatment_done_has_date check (status <> 'done' or done_at is not null),
  foreign key (clinic_id, patient_id)      references patients (clinic_id, id)     on delete restrict,
  foreign key (clinic_id, budget_item_id)  references budget_items (clinic_id, id) on delete set null (budget_item_id),
  foreign key (clinic_id, procedure_id)    references procedures (clinic_id, id)   on delete restrict,
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id)  on delete restrict
);
create index on treatments (clinic_id, patient_id, status);
create index on treatments (clinic_id, professional_id, done_at);
create index on treatments (clinic_id, procedure_id);
create index on treatments (clinic_id, status, created_at);

create table tooth_notes (                       -- anotações no odontograma
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  patient_id  uuid not null,
  tooth       smallint not null check (tooth between 11 and 48 or tooth between 51 and 85),
  note        text not null,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade
);
create index on tooth_notes (clinic_id, patient_id, tooth);

create table evolutions (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  patient_id       uuid not null,
  treatment_id     uuid,
  professional_id  uuid not null,
  body             text not null,
  occurred_at      timestamptz not null default now(),
  deleted_at       timestamptz,                  -- nunca apagar de verdade (prontuário)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id)      references patients (clinic_id, id)    on delete restrict,
  foreign key (clinic_id, treatment_id)    references treatments (clinic_id, id)  on delete set null (treatment_id),
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id) on delete restrict
);
create index on evolutions (clinic_id, patient_id, occurred_at desc);
create index on evolutions (clinic_id, treatment_id);
create index on evolutions (clinic_id, professional_id);

-- =============================================================================
-- Financeiro
-- =============================================================================
create table debits (                             -- contas a receber do paciente
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id) on delete cascade,
  patient_id     uuid,                            -- null = "receita sem vínculo"
  budget_id      uuid,
  treatment_id   uuid,
  description    text not null,
  amount_cents   bigint not null check (amount_cents > 0),
  paid_cents     bigint not null default 0 check (paid_cents >= 0),
  currency       char(3) not null default 'BRL',
  due_date       date not null,
  installment_no smallint,
  installments   smallint,
  status         text not null default 'open'
                   check (status in ('open','partial','paid','canceled')),
  category_id    uuid,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (clinic_id, id),
  constraint debit_paid_le_amount check (paid_cents <= amount_cents),
  foreign key (clinic_id, patient_id)   references patients (clinic_id, id)   on delete restrict,
  foreign key (clinic_id, budget_id)    references budgets (clinic_id, id)    on delete set null (budget_id),
  foreign key (clinic_id, treatment_id) references treatments (clinic_id, id) on delete set null (treatment_id),
  foreign key (clinic_id, category_id)  references categories (clinic_id, id) on delete set null (category_id)
);
create index on debits (clinic_id, patient_id, due_date);
create index on debits (clinic_id, status, due_date);
create index on debits (clinic_id, budget_id);
create index on debits (clinic_id, treatment_id);
create index on debits (clinic_id, category_id);

create table receipts (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  number       bigint not null,                  -- de clinic_counters
  patient_id   uuid,
  payer        jsonb not null,                   -- {"name","cpf"} paciente ou responsável
  total_cents  bigint not null check (total_cents > 0),
  currency     char(3) not null default 'BRL',
  issued_at    timestamptz not null default now(),
  canceled_at  timestamptz,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (clinic_id, id),
  unique (clinic_id, number),
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete restrict
);
create index on receipts (clinic_id, patient_id);
create index on receipts (clinic_id, issued_at desc);

create table expenses (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinics(id) on delete cascade,
  description          text not null,
  amount_cents         bigint not null check (amount_cents > 0),
  currency             char(3) not null default 'BRL',
  due_date             date not null,
  category_id          uuid,
  method               text,
  financial_account_id uuid,
  paid_at              timestamptz,
  commission_id        uuid,                     -- quando é pagamento de comissão
  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, category_id)          references categories (clinic_id, id)         on delete set null (category_id),
  foreign key (clinic_id, financial_account_id) references financial_accounts (clinic_id, id) on delete restrict
);
create index on expenses (clinic_id, due_date);
create index on expenses (clinic_id, paid_at);
create index on expenses (clinic_id, category_id);
create index on expenses (clinic_id, financial_account_id);

create table cash_sessions (                      -- fechamento de caixa (conta "espécie")
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinics(id) on delete cascade,
  financial_account_id uuid not null,
  opened_by            uuid not null references users(id) on delete restrict,
  opened_at            timestamptz not null default now(),
  opening_cents        bigint not null default 0,
  closed_by            uuid references users(id) on delete restrict,
  closed_at            timestamptz,
  expected_cents       bigint,
  counted_cents        bigint,
  difference_cents     bigint,
  currency             char(3) not null default 'BRL',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, financial_account_id) references financial_accounts (clinic_id, id) on delete restrict
);
-- regra do produto: 1 caixa aberto por conta financeira
create unique index cash_one_open_per_account on cash_sessions (financial_account_id) where closed_at is null;
create index on cash_sessions (clinic_id, opened_at desc);

create table payments (                            -- dinheiro que entrou (registro; não processa)
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinics(id) on delete cascade,
  debit_id             uuid not null,
  amount_cents         bigint not null check (amount_cents > 0),
  currency             char(3) not null default 'BRL',
  method               text not null check (method in ('dinheiro','cheque','cartao_credito',
                                     'cartao_debito','pix','transferencia','boleto','outro')),
  financial_account_id uuid not null,
  cash_session_id      uuid,
  paid_at              timestamptz not null,
  receipt_id           uuid,
  canceled_at          timestamptz,
  idempotency_key      text,
  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (clinic_id, id),
  unique (clinic_id, idempotency_key),
  foreign key (clinic_id, debit_id)             references debits (clinic_id, id)             on delete restrict,
  foreign key (clinic_id, financial_account_id) references financial_accounts (clinic_id, id) on delete restrict,
  foreign key (clinic_id, cash_session_id)      references cash_sessions (clinic_id, id)      on delete restrict,
  foreign key (clinic_id, receipt_id)           references receipts (clinic_id, id)           on delete set null (receipt_id)
);
create index on payments (clinic_id, debit_id);
create index on payments (clinic_id, paid_at);
create index on payments (clinic_id, financial_account_id, paid_at);
create index on payments (clinic_id, cash_session_id);
create index on payments (clinic_id, receipt_id);

create table cash_movements (                      -- aporte / retirada manual no caixa
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  cash_session_id uuid not null,
  kind            text not null check (kind in ('aporte','retirada')),
  amount_cents    bigint not null check (amount_cents > 0),
  currency        char(3) not null default 'BRL',
  reason          text,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, cash_session_id) references cash_sessions (clinic_id, id) on delete restrict
);
create index on cash_movements (clinic_id, cash_session_id);

-- =============================================================================
-- Comissões
-- =============================================================================
create table commission_rules (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  professional_id uuid not null,
  trigger         text not null check (trigger in ('budget_approved','treatment_done','debit_received')),
  mode            text not null check (mode in ('percent','fixed_per_procedure')),
  percent_bp      integer check (percent_bp between 0 and 10000),   -- basis points: 3500 = 35%
  fixed_cents     bigint check (fixed_cents >= 0),
  deduct          jsonb not null default '{}',   -- {"material":true,"lab":true,"card_fee":true}
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (clinic_id, id),
  constraint rule_value check (
    (mode = 'percent' and percent_bp is not null) or
    (mode = 'fixed_per_procedure' and fixed_cents is not null)),
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id) on delete cascade
);
create index on commission_rules (clinic_id, professional_id);

create table commissions (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  professional_id uuid not null,
  rule_id         uuid,
  -- 'sale' = aprovação de orçamento; 'execution' = finalizado OU recebido (um substitui o outro
  -- enquanto não pago). Nunca duas comissões do mesmo grupo para o mesmo tratamento.
  grp             text not null check (grp in ('sale','execution')),
  treatment_id    uuid not null,
  source_event    text not null check (source_event in ('budget_approved','treatment_done','debit_received')),
  source_at       timestamptz not null,
  amount_cents    bigint not null check (amount_cents >= 0),
  currency        char(3) not null default 'BRL',
  status          text not null default 'open' check (status in ('open','paid','canceled')),
  paid_at         timestamptz,
  expense_id      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id)     on delete restrict,
  foreign key (clinic_id, rule_id)         references commission_rules (clinic_id, id) on delete set null (rule_id),
  foreign key (clinic_id, treatment_id)    references treatments (clinic_id, id)       on delete restrict,
  foreign key (clinic_id, expense_id)      references expenses (clinic_id, id)         on delete set null (expense_id)
);
create unique index commissions_one_per_group
  on commissions (clinic_id, professional_id, treatment_id, grp) where status <> 'canceled';
create index on commissions (clinic_id, professional_id, status, source_at);
create index on commissions (clinic_id, rule_id);
create index on commissions (clinic_id, treatment_id);
create index on commissions (clinic_id, expense_id);

alter table expenses
  add foreign key (clinic_id, commission_id) references commissions (clinic_id, id) on delete set null (commission_id);
create index on expenses (clinic_id, commission_id);

-- =============================================================================
-- Documentos, arquivos, assinatura
-- =============================================================================
create table document_templates (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  kind       text not null check (kind in ('prescription','certificate','contract','consent','free')),
  name       text not null,
  body       text not null,               -- markdown/HTML com {{paciente.nome}}, {{clinica.nome}}...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create table documents (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  patient_id       uuid not null,
  professional_id  uuid not null,
  template_id      uuid,
  budget_id        uuid,
  kind             text not null check (kind in ('prescription','certificate','contract','consent','free')),
  body_rendered    text not null,
  pdf_key          text,                   -- chave no storage
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id)      references patients (clinic_id, id)           on delete restrict,
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id)        on delete restrict,
  foreign key (clinic_id, template_id)     references document_templates (clinic_id, id) on delete set null (template_id),
  foreign key (clinic_id, budget_id)       references budgets (clinic_id, id)            on delete set null (budget_id)
);
create index on documents (clinic_id, patient_id, created_at desc);
create index on documents (clinic_id, professional_id);
create index on documents (clinic_id, template_id);
create index on documents (clinic_id, budget_id);

create table patient_files (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  patient_id   uuid not null,
  evolution_id uuid,
  kind         text not null check (kind in ('photo','xray','ct','stl','pdf','other')),
  storage_key  text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  taken_at     date,
  position     integer not null default 0,
  deleted_at   timestamptz,
  uploaded_by  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id)   references patients (clinic_id, id)   on delete restrict,
  foreign key (clinic_id, evolution_id) references evolutions (clinic_id, id) on delete set null (evolution_id)
);
create index on patient_files (clinic_id, patient_id, position);
create index on patient_files (clinic_id, evolution_id);

create table signature_requests (           -- anamnese pelo paciente / assinatura de documento
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  patient_id   uuid not null,
  target_kind  text not null check (target_kind in ('anamnesis','document')),
  anamnesis_id uuid,
  document_id  uuid,
  token_hash   text not null unique,          -- o link leva o token; guardamos só o hash
  channel      text not null check (channel in ('email','whatsapp','link')),
  status       text not null default 'pending' check (status in ('pending','completed','expired','canceled')),
  expires_at   timestamptz not null,
  completed_at timestamptz,
  evidence     jsonb,                         -- ip, user agent, hash do conteúdo, provedor
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (clinic_id, id),
  constraint sig_target check (
    (target_kind = 'anamnesis' and anamnesis_id is not null and document_id is null) or
    (target_kind = 'document'  and document_id  is not null and anamnesis_id is null)),
  foreign key (clinic_id, patient_id)   references patients (clinic_id, id)  on delete restrict,
  foreign key (clinic_id, anamnesis_id) references anamneses (clinic_id, id) on delete cascade,
  foreign key (clinic_id, document_id)  references documents (clinic_id, id) on delete cascade
);
create index on signature_requests (clinic_id, patient_id);
create index on signature_requests (clinic_id, anamnesis_id);
create index on signature_requests (clinic_id, document_id);

-- Auditoria (append-only: a role da aplicação não tem UPDATE/DELETE aqui)
create table audit_log (
  id          bigint generated always as identity primary key,
  clinic_id   uuid not null references clinics(id) on delete cascade,
  user_id     uuid references users(id) on delete set null,
  action      text not null,          -- 'patient.view','budget.approve','payment.cancel',...
  entity      text not null,
  entity_id   uuid,
  diff        jsonb,
  ip          inet,
  at          timestamptz not null default now()
);
create index on audit_log (clinic_id, at desc);
create index on audit_log (clinic_id, entity, entity_id);
create index on audit_log (user_id);

-- =============================================================================
-- updated_at automático
-- =============================================================================
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format('create trigger %I_touch before update on %I
                    for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- =============================================================================
-- Row Level Security: toda tabela com clinic_id só enxerga a clínica da transação.
-- A aplicação conecta com a role "app" (sem BYPASSRLS). Migrations rodam com outra role.
-- =============================================================================
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'clinic_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I
                    using (clinic_id = app_clinic_id())
                    with check (clinic_id = app_clinic_id())', t);
  end loop;
end $$;

-- clinics: o próprio tenant
alter table clinics enable row level security;
alter table clinics force row level security;
create policy tenant_self on clinics
  using (id = app_clinic_id()) with check (id = app_clinic_id());

-- memberships: além da clínica atual, o usuário vê os próprios vínculos (seletor de clínica)
create policy own_memberships on memberships for select
  using (user_id = app_user_id());
create policy own_clinics on clinics for select
  using (id in (select m.clinic_id from memberships m where m.user_id = app_user_id() and m.is_active));

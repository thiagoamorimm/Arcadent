-- Estoque (S26) e controle de prótese (S27). Mesmas convenções do V1: clinic_id + RLS, FKs compostas.

-- -----------------------------------------------------------------------------
-- Estoque: produto com saldo; todo movimento fica no histórico (saldo = soma dos movimentos,
-- guardado no produto e atualizado na mesma transação).
-- -----------------------------------------------------------------------------
create table stock_products (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  unit        text not null default 'un',          -- un, cx, pct, ml, g…
  category    text,
  min_qty     numeric(12,2) not null default 0 check (min_qty >= 0),
  qty         numeric(12,2) not null default 0,
  cost_cents  bigint check (cost_cents >= 0),       -- último custo unitário
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (clinic_id, id)
);
create unique index stock_products_name_uq on stock_products (clinic_id, lower(name)) where is_active;

create table stock_movements (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  product_id  uuid not null,
  kind        text not null check (kind in ('entrada','saida','ajuste')),
  qty         numeric(12,2) not null check (qty <> 0),   -- com sinal: entrada +, saída −, ajuste ±
  cost_cents  bigint check (cost_cents >= 0),
  reason      text,
  balance     numeric(12,2) not null,                    -- saldo depois do movimento
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, product_id) references stock_products (clinic_id, id) on delete cascade
);
create index on stock_movements (clinic_id, product_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Prótese: pedido de laboratório que anda por 5 etapas; cada mudança vira evento (histórico).
-- -----------------------------------------------------------------------------
create table prosthesis_orders (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  patient_id      uuid not null,
  treatment_id    uuid,
  professional_id uuid,
  description     text not null check (length(trim(description)) > 0),  -- "Coroa em porcelana — 11"
  laboratory      text,
  stage           text not null default 'pre_lab'
                    check (stage in ('pre_lab','envio','laboratorio','prova','realizado')),
  due_date        date,              -- quando a etapa atual deveria terminar (alerta de atraso)
  cost_cents      bigint check (cost_cents >= 0),
  notes           text,
  canceled_at     timestamptz,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id)      references patients (clinic_id, id)    on delete restrict,
  foreign key (clinic_id, treatment_id)    references treatments (clinic_id, id)  on delete set null (treatment_id),
  foreign key (clinic_id, professional_id) references memberships (clinic_id, id) on delete set null (professional_id)
);
create index on prosthesis_orders (clinic_id, stage) where canceled_at is null;
create index on prosthesis_orders (clinic_id, patient_id);

create table prosthesis_events (
  id          bigint generated always as identity primary key,
  clinic_id   uuid not null references clinics(id) on delete cascade,
  order_id    uuid not null,
  stage       text not null,
  note        text,
  user_id     uuid references users(id) on delete set null,
  at          timestamptz not null default now(),
  foreign key (clinic_id, order_id) references prosthesis_orders (clinic_id, id) on delete cascade
);
create index on prosthesis_events (clinic_id, order_id, at);

-- updated_at automático
create trigger stock_products_touch before update on stock_products for each row execute function touch_updated_at();
create trigger prosthesis_orders_touch before update on prosthesis_orders for each row execute function touch_updated_at();

-- RLS: só a clínica da transação
do $$
declare t text;
begin
  foreach t in array array['stock_products','stock_movements','prosthesis_orders','prosthesis_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (clinic_id = app_clinic_id()) with check (clinic_id = app_clinic_id())', t);
  end loop;
end $$;

grant select, insert, update, delete on stock_products, stock_movements, prosthesis_orders, prosthesis_events to clinic_app;
grant usage, select on sequence prosthesis_events_id_seq to clinic_app;
-- histórico de estoque é só de inclusão (como a auditoria)
revoke update, delete on stock_movements from clinic_app;

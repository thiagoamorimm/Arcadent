-- Convite: o dono escolhe se a pessoa atende (tem agenda) e sugere o nome.
alter table invitations add column does_attend boolean not null default false;
alter table invitations add column name text;
create unique index invitations_one_open_per_email
  on invitations (clinic_id, lower(email)) where accepted_at is null;

-- Quem abre o link do convite ainda não tem clínica no contexto (RLS esconderia o convite).
-- Função mínima, security definer, que só resolve o convite pelo HASH do token.
create or replace function invitation_lookup(p_hash text)
returns table (id uuid, clinic_id uuid, clinic_name text, email text, name text, role text,
               permissions text[], does_attend boolean, expires_at timestamptz, accepted_at timestamptz)
language sql stable security definer set search_path = public as
$$
  select i.id, i.clinic_id, c.name, i.email, i.name, i.role, i.permissions, i.does_attend, i.expires_at, i.accepted_at
    from invitations i join clinics c on c.id = i.clinic_id
   where i.token_hash = p_hash
$$;
revoke all on function invitation_lookup(text) from public;
grant execute on function invitation_lookup(text) to clinic_app;

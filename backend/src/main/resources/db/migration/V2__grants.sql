-- A aplicação conecta como clinic_app (sem BYPASSRLS). Migrations rodam como dono do schema.
grant usage on schema public to clinic_app;
grant select, insert, update, delete on all tables in schema public to clinic_app;
grant usage, select on all sequences in schema public to clinic_app;
revoke update, delete on audit_log from clinic_app;   -- auditoria append-only
alter default privileges in schema public grant select, insert, update, delete on tables to clinic_app;
alter default privileges in schema public grant usage, select on sequences to clinic_app;

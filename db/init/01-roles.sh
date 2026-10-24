#!/bin/sh
# Role da aplicação: sem superuser e sem BYPASSRLS → o RLS vale de verdade.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
create role clinic_app login password '${APP_DB_PASSWORD}' nosuperuser nobypassrls;
grant connect on database ${POSTGRES_DB} to clinic_app;
SQL

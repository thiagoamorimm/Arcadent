-- Motivo da revogação do token de renovação: só a troca normal ('rotated') tem a tolerância de
-- corrida entre abas; 'logout', 'password_reset' e 'reuse' (roubo detectado) valem na hora.
alter table refresh_tokens add column revoke_reason text
  check (revoke_reason in ('rotated','logout','password_reset','reuse'));

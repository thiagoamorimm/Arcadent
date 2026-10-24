-- Prontuário: documento guarda os campos estruturados (para reemitir o PDF igual) e um título.
alter table documents add column title text;
alter table documents add column data jsonb not null default '{}';

-- Modelo de anamnese padrão para as clínicas que já existem (as novas recebem no cadastro).
-- Perguntas escritas por nós. alertOn = resposta que vira alerta clínico na ficha.
insert into anamnesis_templates (clinic_id, name, questions)
select c.id, 'Anamnese odontológica', $json$[
  {"id":"q1","text":"Está em tratamento médico atualmente?","type":"yesno","withDetail":true,"alertOn":"sim","alert":"Em tratamento médico"},
  {"id":"q2","text":"Usa algum medicamento? Quais?","type":"yesno","withDetail":true,"alertOn":"sim","alert":"Usa medicamentos"},
  {"id":"q3","text":"Tem alergia a remédio ou material (penicilina, látex, anestésico…)?","type":"yesno","withDetail":true,"alertOn":"sim","alert":"Alergia"},
  {"id":"q4","text":"Tem pressão alta ou problema no coração?","type":"yesno","withDetail":true,"alertOn":"sim","alert":"Hipertensão/cardiopatia"},
  {"id":"q5","text":"Tem diabetes?","type":"yesno","alertOn":"sim","alert":"Diabetes"},
  {"id":"q6","text":"Já passou mal com anestesia no dentista?","type":"yesno","withDetail":true,"alertOn":"sim","alert":"Reação a anestesia"},
  {"id":"q7","text":"Sangra muito em cortes ou tem problema de coagulação?","type":"yesno","alertOn":"sim","alert":"Coagulação"},
  {"id":"q8","text":"Está grávida ou amamentando?","type":"choice","options":["Não","Grávida","Amamentando"],"alertOn":"Grávida","alert":"Gestante"},
  {"id":"q9","text":"Fuma?","type":"yesno"},
  {"id":"q10","text":"Range ou aperta os dentes?","type":"yesno"},
  {"id":"q11","text":"Sente dor ou sensibilidade nos dentes hoje?","type":"yesno","withDetail":true},
  {"id":"q12","text":"Observações","type":"text"}
]$json$::jsonb
from clinics c
where not exists (select 1 from anamnesis_templates t where t.clinic_id = c.id);

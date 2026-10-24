package app.clinica.patient;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/patients")
public class PatientController {
  private final Db db;

  public PatientController(Db db) { this.db = db; }

  public record PatientRow(UUID id, String name, String phone, String cpf, LocalDate birthDate,
                           OffsetDateTime nextVisit, OffsetDateTime lastVisit, long balanceCents) {}
  public record Page<T>(List<T> items, long total, int page, int size) {}
  /** Responsável legal/financeiro (menor de idade, idoso, quem paga). Sai no recibo quando escolhido. */
  public record Guardian(@Size(max = 160) String name, @Size(max = 20) String cpf, @Size(max = 30) String phone,
                         @Size(max = 40) String relation) {}
  public record Patient(UUID id, String name, LocalDate birthDate, String cpf, String phone, String email,
                        boolean isForeign, String notes, OffsetDateTime createdAt,
                        OffsetDateTime nextVisit, long balanceCents, long openTreatments, List<String> clinicalAlerts,
                        Guardian guardian) {}
  public record PatientReq(@NotBlank @Size(max = 160) String name, @Size(max = 30) String phone,
                           @Size(max = 20) String cpf, LocalDate birthDate, @Size(max = 200) String email,
                           Boolean isForeign, @Size(max = 4000) String notes, @Valid Guardian guardian) {}

  /** Lista com busca por nome (trigram), celular ou CPF (só dígitos), saldo devedor e próximas/últimas consultas. */
  @GetMapping
  public Page<PatientRow> list(@RequestParam(defaultValue = "") String q,
                               @RequestParam(defaultValue = "0") int page,
                               @RequestParam(defaultValue = "50") int size) {
    int s = Math.min(Math.max(size, 1), 200);
    String term = q.trim();
    String digits = term.replaceAll("\\D", "");
    return db.inClinic(() -> {
      String where = """
          p.deleted_at is null and (? = '' or p.name ilike '%' || ? || '%'
            or (? <> '' and regexp_replace(coalesce(p.phone,''), '\\D', '', 'g') like '%' || ? || '%')
            or (? <> '' and regexp_replace(coalesce(p.cpf,''), '\\D', '', 'g') = ?))""";
      Object[] params = {term, term, digits, digits, digits, digits};
      long total = db.sql("select count(*) from patients p where " + where).params(params).query(Long.class).single();
      List<PatientRow> items = db.sql("""
          select p.id, p.name, p.phone, p.cpf, p.birth_date,
                 (select min(a.start_at) from appointments a where a.patient_id = p.id and a.start_at >= now()
                    and a.status not in ('cancelado','faltou')) next_visit,
                 (select max(a.start_at) from appointments a where a.patient_id = p.id and a.start_at < now()
                    and a.status = 'atendido') last_visit,
                 coalesce((select sum(d.amount_cents - d.paid_cents) from debits d
                    where d.patient_id = p.id and d.status in ('open','partial')), 0) balance_cents
            from patients p
           where""" + " " + where + " order by p.name limit ? offset ?")
          .params(concat(params, s, page * s)).query(PatientRow.class).list();
      return new Page<>(items, total, page, s);
    });
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Patient create(@Valid @RequestBody PatientReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.edit");
    return db.inClinic(() -> {
      UUID id = insert(db, c.clinicId(), c.userId(), r.name(), r.phone());
      db.sql("update patients set cpf = ?, birth_date = ?, email = ?, is_foreign = ?, notes = ?, guardian = ?::jsonb where id = ?")
          .params(Text.blank(r.cpf()), r.birthDate(), Text.blank(r.email()), Boolean.TRUE.equals(r.isForeign()), Text.blank(r.notes()),
              guardianJson(r.guardian()), id)
          .update();
      return get(id);
    });
  }

  @GetMapping("/{id}")
  public Patient one(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    return db.inClinic(() -> {
      Patient p = get(id);
      // LGPD/dado de saúde: registra quem abriu a ficha. Uma linha por pessoa e ficha a cada 30 min,
      // para a trilha não virar ruído com cada recarga de tela.
      db.sql("""
          insert into audit_log (clinic_id, user_id, action, entity, entity_id)
          select ?, ?, 'patient.view', 'patient', ?
           where not exists (select 1 from audit_log where user_id = ? and entity_id = ? and action = 'patient.view'
                               and at > now() - interval '30 minutes')""")
          .params(c.clinicId(), c.userId(), id, c.userId(), id).update();
      return p;
    });
  }

  @PatchMapping("/{id}")
  public Patient update(@PathVariable UUID id, @Valid @RequestBody PatientReq r) {
    Ctx.current().require("paciente.edit");
    return db.inClinic(() -> {
      int n = db.sql("""
          update patients set name = ?, phone = ?, cpf = ?, birth_date = ?, email = ?, is_foreign = ?, notes = ?, guardian = ?::jsonb
           where id = ? and deleted_at is null""")
          .params(r.name().trim(), Text.blank(r.phone()), Text.blank(r.cpf()), r.birthDate(), Text.blank(r.email()),
              Boolean.TRUE.equals(r.isForeign()), Text.blank(r.notes()), guardianJson(r.guardian()), id).update();
      if (n == 0) throw ApiException.notFound("Paciente");
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'patient.update', 'patient', ?)")
          .params(Ctx.current().clinicId(), Ctx.current().userId(), id).update();
      return get(id);
    });
  }

  /** Usado também pelo cadastro rápido dentro da consulta. Precisa estar dentro de db.inClinic. */
  public static UUID insert(Db db, UUID clinicId, UUID userId, String name, String phone) {
    return db.sql("insert into patients (clinic_id, name, phone, created_by) values (?, ?, ?, ?) returning id")
        .params(clinicId, name.trim(), Text.blank(phone), userId).query(UUID.class).single();
  }

  private Patient get(UUID id) {
    return db.sql("""
        select p.id, p.name, p.birth_date, p.cpf, p.phone, p.email, p.is_foreign, p.notes, p.created_at,
               (select min(a.start_at) from appointments a where a.patient_id = p.id and a.start_at >= now()
                  and a.status not in ('cancelado','faltou')) next_visit,
               coalesce((select sum(d.amount_cents - d.paid_cents) from debits d
                  where d.patient_id = p.id and d.status in ('open','partial')), 0) balance_cents,
               (select count(*) from treatments t where t.patient_id = p.id and t.status = 'open') open_treatments,
               p.clinical_alerts, p.guardian->>'name' g_name, p.guardian->>'cpf' g_cpf, p.guardian->>'phone' g_phone,
               p.guardian->>'relation' g_relation
          from patients p where p.id = ? and p.deleted_at is null""")
        .param(id).query((rs, n) -> new Patient((UUID) rs.getObject("id"), rs.getString("name"),
            rs.getObject("birth_date", LocalDate.class), rs.getString("cpf"), rs.getString("phone"), rs.getString("email"),
            rs.getBoolean("is_foreign"), rs.getString("notes"), rs.getObject("created_at", OffsetDateTime.class),
            rs.getObject("next_visit", OffsetDateTime.class), rs.getLong("balance_cents"), rs.getLong("open_treatments"),
            rs.getArray("clinical_alerts") == null ? List.of() : List.of((String[]) rs.getArray("clinical_alerts").getArray()),
            rs.getString("g_name") == null ? null
                : new Guardian(rs.getString("g_name"), rs.getString("g_cpf"), rs.getString("g_phone"), rs.getString("g_relation"))))
        .optional().orElseThrow(() -> ApiException.notFound("Paciente"));
  }

  /** Sem nome = sem responsável (null no banco). */
  private static String guardianJson(Guardian g) {
    if (g == null || Text.blank(g.name()) == null) return null;
    var m = new java.util.LinkedHashMap<String, String>();
    m.put("name", Text.blank(g.name()));
    m.put("cpf", Text.blank(g.cpf()));
    m.put("phone", Text.blank(g.phone()));
    m.put("relation", Text.blank(g.relation()));
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(m);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  private static Object[] concat(Object[] a, Object... b) {
    Object[] out = new Object[a.length + b.length];
    System.arraycopy(a, 0, out, 0, a.length);
    System.arraycopy(b, 0, out, a.length, b.length);
    return out;
  }
}

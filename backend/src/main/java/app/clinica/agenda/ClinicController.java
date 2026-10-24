package app.clinica.agenda;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Ajustes › Clínica (dados, fuso, expediente) e horário de atendimento dos profissionais. */
@RestController
@RequestMapping("/api")
public class ClinicController {
  private final Db db;

  public ClinicController(Db db) { this.db = db; }

  public record Clinic(UUID id, String name, String phone, String email, String document, String timezone,
                       Map<String, List<List<String>>> businessHours, int slotMinutes) {}
  public record ClinicReq(@NotBlank @Size(max = 120) String name, @Size(max = 30) String phone,
                          @Size(max = 200) String email, @Size(max = 20) String document,
                          @NotBlank String timezone, Map<String, List<List<String>>> businessHours, Integer slotMinutes) {}
  public record HoursReq(Map<String, List<List<String>>> workHours) {}
  public record Professional(UUID id, String name, String color, String role, Map<String, List<List<String>>> workHours) {}

  /** Qualquer membro lê (a agenda precisa do fuso e do expediente). */
  @GetMapping("/clinic")
  public Clinic get() {
    return db.inClinic(this::load);
  }

  @PatchMapping("/clinic")
  public Clinic update(@Valid @RequestBody ClinicReq r) {
    Ctx c = Ctx.current();
    c.require("config.clinic");
    Hours.validZone(r.timezone());
    var hours = r.businessHours() == null ? null : Hours.validate(r.businessHours());
    int slot = r.slotMinutes() == null ? 30 : r.slotMinutes();
    if (!List.of(5, 10, 15, 20, 30, 60).contains(slot)) throw ApiException.badRequest("SLOT", "Intervalo da agenda inválido.");
    return db.inClinic(() -> {
      db.sql("""
          update clinics set name = ?, phone = ?, email = ?, document = ?, timezone = ?,
                 business_hours = coalesce(?::jsonb, business_hours), slot_minutes = ?
           where id = ?""")
          .params(r.name().trim(), Text.blank(r.phone()), Text.blank(r.email()), Text.blank(r.document()),
              r.timezone(), hours == null ? null : Hours.toJson(hours), slot, c.clinicId())
          .update();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'clinic.update', 'clinic', ?)")
          .params(c.clinicId(), c.userId(), c.clinicId()).update();
      return load();
    });
  }

  /** Lista de profissionais da agenda, agora com o horário de atendimento de cada um. */
  @GetMapping("/professionals")
  public List<Professional> professionals() {
    return db.inClinic(() -> db.sql("""
        select m.id, u.name, m.color, m.role, m.work_hours::text work_hours
          from memberships m join users u on u.id = m.user_id
         where m.does_attend and m.is_active
         order by u.name""")
        .query((rs, n) -> new Professional((UUID) rs.getObject("id"), rs.getString("name"), rs.getString("color"),
            rs.getString("role"), Hours.fromJson(rs.getString("work_hours"))))
        .list());
  }

  /** Quem gerencia a equipe muda o horário de qualquer profissional; cada profissional muda o próprio. */
  @PutMapping("/team/{membershipId}/work-hours")
  public Professional workHours(@PathVariable UUID membershipId, @RequestBody HoursReq r) {
    Ctx c = Ctx.current();
    if (!membershipId.equals(c.membershipId())) c.require("config.team");
    var hours = Hours.validate(r.workHours());
    return db.inClinic(() -> {
      int n = db.sql("update memberships set work_hours = ?::jsonb where id = ?").params(Hours.toJson(hours), membershipId).update();
      if (n == 0) throw ApiException.notFound("Profissional");
      return professionals().stream().filter(p -> p.id().equals(membershipId)).findFirst()
          .orElseThrow(() -> new ApiException(409, "NOT_ATTENDING", "Essa pessoa não está marcada como quem atende pacientes."));
    });
  }

  private Clinic load() {
    return db.sql("""
        select id, name, phone, email, document, timezone, business_hours::text business_hours, slot_minutes
          from clinics where id = app_clinic_id()""")
        .query((rs, n) -> new Clinic((UUID) rs.getObject("id"), rs.getString("name"), rs.getString("phone"),
            rs.getString("email"), rs.getString("document"), rs.getString("timezone"),
            Hours.fromJson(rs.getString("business_hours")), rs.getInt("slot_minutes")))
        .single();
  }
}

package app.clinica.agenda;

import app.clinica.patient.PatientController;
import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Agenda: consultas, compromissos e bloqueios. Conflito de horário é checado aqui (mensagem com quem
 * conflita) e garantido no banco (exclusion constraint) contra corrida entre dois usuários.
 */
@RestController
@RequestMapping("/api/appointments")
public class AppointmentController {
  private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
  private final Db db;

  public AppointmentController(Db db) { this.db = db; }

  public record Appointment(UUID id, String kind, UUID patientId, String patientName, String patientPhone,
                            UUID professionalId, String professionalName, UUID chairId, UUID labelId, String labelColor,
                            String labelName, OffsetDateTime startAt, OffsetDateTime endAt, String title, String notes,
                            String status, boolean overlapAllowed, boolean outsideHours) {}

  public record NewPatient(@Size(min = 1, max = 160) String name, @Size(max = 30) String phone) {}

  public record CreateReq(
      @Pattern(regexp = "consulta|compromisso|bloqueio") String kind,
      UUID patientId,
      @Valid NewPatient newPatient,
      @NotNull UUID professionalId,
      UUID chairId,
      UUID labelId,
      @NotNull OffsetDateTime startAt,
      @NotNull OffsetDateTime endAt,
      @Size(max = 200) String title,
      @Size(max = 2000) String notes,
      Boolean overlapAllowed) {}

  /** Campos nulos não mudam. clearLabel=true tira o rótulo. Mover sem overlapAllowed volta a checar conflito. */
  public record PatchReq(
      OffsetDateTime startAt,
      OffsetDateTime endAt,
      UUID professionalId,
      UUID patientId,
      UUID labelId,
      Boolean clearLabel,
      @Size(max = 200) String title,
      @Size(max = 2000) String notes,
      @Pattern(regexp = "agendado|confirmado|aguardando|em_atendimento|atendido|faltou|cancelado") String status,
      Boolean overlapAllowed) {}

  public record Conflict(UUID id, String kind, String who, OffsetDateTime startAt, OffsetDateTime endAt) {}

  private static final String SELECT = """
      select a.id, a.kind, a.patient_id, p.name patient_name, p.phone patient_phone,
             a.professional_id, u.name professional_name, a.chair_id, a.label_id, l.color label_color, l.name label_name,
             a.start_at, a.end_at, a.title, a.notes, a.status, a.overlap_allowed, false outside_hours
        from appointments a
        join memberships m on m.id = a.professional_id
        join users u on u.id = m.user_id
        left join patients p on p.id = a.patient_id
        left join labels l on l.id = a.label_id
      """;

  /** Intervalo da grade (dia/semana). Sem professionalId = todos os profissionais. */
  @GetMapping
  public List<Appointment> list(@RequestParam OffsetDateTime from, @RequestParam OffsetDateTime to,
                                @RequestParam(required = false) UUID professionalId) {
    if (!to.isAfter(from) || Duration.between(from, to).toDays() > 62) {
      throw ApiException.badRequest("RANGE", "Intervalo inválido (máximo de 62 dias).");
    }
    Ctx c = Ctx.current();
    // Sem "ver agenda de todos", a pessoa só enxerga a própria agenda (filtro forçado no servidor).
    UUID prof = c.can("agenda.view_all") ? professionalId : c.membershipId();
    return db.inClinic(() -> db.sql(SELECT + """
         where a.start_at < ? and a.end_at > ? and (?::uuid is null or a.professional_id = ?)
         order by a.start_at""").params(to, from, prof, prof).query(Appointment.class).list());
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Appointment create(@Valid @RequestBody CreateReq r) {
    Ctx c = Ctx.current();
    c.require("agenda.create");
    if (!r.professionalId().equals(c.membershipId())) c.require("agenda.create_for_others");
    String kind = r.kind() == null ? "consulta" : r.kind();
    checkRange(r.startAt(), r.endAt());
    if ("consulta".equals(kind) && r.patientId() == null && (r.newPatient() == null || r.newPatient().name() == null)) {
      throw ApiException.badRequest("PATIENT_REQUIRED", "Escolha um paciente ou cadastre um novo.");
    }
    if (!"consulta".equals(kind) && (r.title() == null || r.title().isBlank())) {
      throw ApiException.badRequest("TITLE_REQUIRED", "Dê um nome ao compromisso ou bloqueio.");
    }
    boolean overlap = Boolean.TRUE.equals(r.overlapAllowed());
    return db.inClinic(() -> {
      ensureAttends(r.professionalId());
      if (!overlap) failOnConflict(r.professionalId(), r.startAt(), r.endAt(), null);
      UUID patientId = r.patientId();
      if ("consulta".equals(kind) && patientId == null) {
        patientId = PatientController.insert(db, c.clinicId(), c.userId(), r.newPatient().name(), r.newPatient().phone());
      }
      UUID id = db.sql("""
          insert into appointments (clinic_id, kind, patient_id, professional_id, chair_id, label_id, start_at, end_at,
                                    title, notes, overlap_allowed, created_by)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
          .params(c.clinicId(), kind, "consulta".equals(kind) ? patientId : null, r.professionalId(), r.chairId(),
              r.labelId(), r.startAt(), r.endAt(), Text.blank(r.title()), Text.blank(r.notes()), overlap, c.userId())
          .query(UUID.class).single();
      return withHours(get(id));
    });
  }

  @PatchMapping("/{id}")
  public Appointment patch(@PathVariable UUID id, @Valid @RequestBody PatchReq r) {
    Ctx c = Ctx.current();
    c.require("agenda.create");
    return db.inClinic(() -> {
      Appointment cur = db.sql(SELECT + " where a.id = ? for update of a").param(id).query(Appointment.class).optional()
          .orElseThrow(() -> ApiException.notFound("Consulta"));
      if (!cur.professionalId().equals(c.membershipId()) || (r.professionalId() != null && !r.professionalId().equals(c.membershipId()))) {
        c.require("agenda.create_for_others");
      }
      OffsetDateTime start = r.startAt() != null ? r.startAt() : cur.startAt();
      OffsetDateTime end = r.endAt() != null ? r.endAt() : cur.endAt();
      UUID prof = r.professionalId() != null ? r.professionalId() : cur.professionalId();
      boolean moved = !start.isEqual(cur.startAt()) || !end.isEqual(cur.endAt()) || !prof.equals(cur.professionalId());
      boolean reactivated = r.status() != null && List.of("cancelado", "faltou").contains(cur.status())
          && !List.of("cancelado", "faltou").contains(r.status());
      checkRange(start, end);
      if (r.professionalId() != null) ensureAttends(prof);
      if (!"consulta".equals(cur.kind()) && r.title() != null && r.title().isBlank()) {
        throw ApiException.badRequest("TITLE_REQUIRED", "Dê um nome ao compromisso ou bloqueio.");
      }
      // Mover (ou reativar um cancelado) é como marcar de novo: só passa por cima de outro horário se pedirem encaixe.
      boolean overlap = moved || reactivated ? Boolean.TRUE.equals(r.overlapAllowed())
          : r.overlapAllowed() != null ? r.overlapAllowed() : cur.overlapAllowed();
      boolean activeAfter = !List.of("cancelado", "faltou").contains(r.status() != null ? r.status() : cur.status());
      if ((moved || reactivated) && !overlap && activeAfter) failOnConflict(prof, start, end, id);
      db.sql("""
          update appointments set start_at = ?, end_at = ?, professional_id = ?,
            patient_id = case when kind = 'consulta' then coalesce(?, patient_id) else patient_id end,
            label_id = case when ? then null else coalesce(?, label_id) end,
            title = coalesce(?, title), notes = coalesce(?, notes), status = coalesce(?, status),
            overlap_allowed = ?
           where id = ?""")
          .params(start, end, prof, r.patientId(), Boolean.TRUE.equals(r.clearLabel()), r.labelId(),
              Text.blank(r.title()), r.notes(), r.status(), overlap, id)
          .update();
      return withHours(get(id));
    });
  }

  /** Excluir apaga de vez (exige permissão própria). Para o histórico, prefira cancelar. */
  @DeleteMapping("/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("agenda.delete");
    db.inClinic(() -> {
      var row = db.sql("select professional_id, kind, patient_id, start_at from appointments where id = ? for update")
          .param(id).query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Consulta"));
      if (!row.get("professional_id").equals(c.membershipId())) c.require("agenda.create_for_others");
      db.sql("delete from appointments where id = ?").param(id).update();
      // O registro sai da agenda, mas fica no histórico de auditoria quem apagou e o quê.
      db.sql("""
          insert into audit_log (clinic_id, user_id, action, entity, entity_id, diff)
          values (?, ?, 'appointment.delete', 'appointment', ?, ?::jsonb)""")
          .params(c.clinicId(), c.userId(), id,
              "{\"kind\":\"" + row.get("kind") + "\",\"patient_id\":" + (row.get("patient_id") == null ? "null" : "\"" + row.get("patient_id") + "\"")
                  + ",\"start_at\":\"" + row.get("start_at") + "\"}")
          .update();
    });
  }

  private void checkRange(OffsetDateTime start, OffsetDateTime end) {
    if (!end.isAfter(start)) throw ApiException.badRequest("RANGE", "O fim precisa ser depois do início.");
    if (Duration.between(start, end).toHours() > 24) throw ApiException.badRequest("RANGE", "Um horário pode durar no máximo 24 horas.");
  }

  private void ensureAttends(UUID membershipId) {
    boolean ok = db.sql("select exists(select 1 from memberships where id = ? and does_attend and is_active)")
        .param(membershipId).query(Boolean.class).single();
    if (!ok) throw ApiException.badRequest("PROFESSIONAL", "Esse profissional não atende ou está desativado.");
  }

  /**
   * Conflito com qualquer horário ativo do profissional (inclusive encaixes já feitos, que o banco não
   * bloqueia). A resposta diz com quem conflita para a tela oferecer "encaixar mesmo assim".
   */
  private void failOnConflict(UUID prof, OffsetDateTime start, OffsetDateTime end, UUID ignoreId) {
    List<Conflict> conflicts = db.sql("""
        select a.id, a.kind, coalesce(p.name, a.title) who, a.start_at, a.end_at
          from appointments a left join patients p on p.id = a.patient_id
         where a.professional_id = ? and a.status not in ('cancelado','faltou')
           and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(?, ?, '[)')
           and (?::uuid is null or a.id <> ?)
         order by a.start_at limit 5""")
        .params(prof, start, end, ignoreId, ignoreId).query(Conflict.class).list();
    if (conflicts.isEmpty()) return;
    ZoneId tz = ZoneId.of(db.sql("select timezone from clinics where id = app_clinic_id()").query(String.class).single());
    Conflict f = conflicts.get(0);
    String when = f.startAt().atZoneSameInstant(tz).format(HM) + "–" + f.endAt().atZoneSameInstant(tz).format(HM);
    String msg = switch (f.kind()) {
      case "bloqueio" -> "Horário bloqueado: " + f.who() + " (" + when + ").";
      case "compromisso" -> "Conflita com o compromisso “" + f.who() + "” (" + when + ").";
      default -> "Conflita com a consulta de " + f.who() + " (" + when + ").";
    };
    if (conflicts.size() > 1) msg += " E mais " + (conflicts.size() - 1) + " no mesmo intervalo.";
    throw new ApiException(409, "APPOINTMENT_CONFLICT", msg, Map.of("conflicts", conflicts));
  }

  /** Marca se ficou fora do horário de atendimento do profissional (aviso, não bloqueio). */
  private Appointment withHours(Appointment a) {
    var row = db.sql("""
        select m.work_hours::text wh, c.business_hours::text bh, c.timezone
          from memberships m join clinics c on c.id = m.clinic_id where m.id = ?""")
        .param(a.professionalId()).query().singleRow();
    var hours = Hours.fromJson((String) row.get("wh"));
    if (hours.values().stream().allMatch(List::isEmpty)) hours = Hours.fromJson((String) row.get("bh"));
    ZoneId tz = ZoneId.of((String) row.get("timezone"));
    boolean outside = "consulta".equals(a.kind())
        && !Hours.fits(hours, a.startAt().atZoneSameInstant(tz), a.endAt().atZoneSameInstant(tz));
    return new Appointment(a.id(), a.kind(), a.patientId(), a.patientName(), a.patientPhone(), a.professionalId(),
        a.professionalName(), a.chairId(), a.labelId(), a.labelColor(), a.labelName(), a.startAt(), a.endAt(),
        a.title(), a.notes(), a.status(), a.overlapAllowed(), outside);
  }

  private Appointment get(UUID id) {
    return db.sql(SELECT + " where a.id = ?").param(id).query(Appointment.class).optional()
        .orElseThrow(() -> ApiException.notFound("Consulta"));
  }
}

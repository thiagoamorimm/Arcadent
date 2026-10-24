package app.clinica.treatment;

import app.clinica.budget.BudgetController;
import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Anotações por dente no odontograma de acompanhamento ("fratura na distal", "sensibilidade ao frio").
 * É prontuário: só quem atende vê. Quem escreveu pode apagar nas primeiras 24 h (o texto fica no audit_log).
 */
@RestController
@RequestMapping("/api")
public class ToothNoteController {
  private final Db db;

  public ToothNoteController(Db db) { this.db = db; }

  public record NoteReq(@NotNull Integer tooth, @NotBlank @Size(max = 1000) String note) {}
  public record Note(UUID id, int tooth, String note, String authorName, OffsetDateTime createdAt, boolean canDelete) {}

  @GetMapping("/patients/{patientId}/tooth-notes")
  public List<Note> list(@PathVariable UUID patientId) {
    Ctx c = Ctx.current();
    c.requireClinical();
    return db.inClinic(() -> db.sql("""
        select n.id, n.tooth, n.note, u.name author_name, n.created_at, n.created_by
          from tooth_notes n left join users u on u.id = n.created_by
         where n.patient_id = ? order by n.tooth, n.created_at desc""").param(patientId)
        .query((rs, i) -> {
          OffsetDateTime at = rs.getObject("created_at", OffsetDateTime.class);
          return new Note((UUID) rs.getObject("id"), rs.getInt("tooth"), rs.getString("note"), rs.getString("author_name"), at,
              c.userId().equals(rs.getObject("created_by")) && Duration.between(at, OffsetDateTime.now()).toHours() < 24);
        }).list());
  }

  @PostMapping("/patients/{patientId}/tooth-notes")
  @ResponseStatus(HttpStatus.CREATED)
  public Note create(@PathVariable UUID patientId, @Valid @RequestBody NoteReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    BudgetController.validateTooth(r.tooth(), null);
    return db.inClinic(() -> {
      if (db.sql("select count(*) from patients where id = ? and deleted_at is null").param(patientId).query(Long.class).single() == 0) {
        throw ApiException.notFound("Paciente");
      }
      UUID id = db.sql("insert into tooth_notes (clinic_id, patient_id, tooth, note, created_by) values (?, ?, ?, ?, ?) returning id")
          .params(c.clinicId(), patientId, r.tooth(), r.note().trim(), c.userId()).query(UUID.class).single();
      return list(patientId).stream().filter(n -> n.id().equals(id)).findFirst().orElseThrow();
    });
  }

  @DeleteMapping("/tooth-notes/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    db.inClinic(() -> {
      var n = db.sql("select tooth, note, created_by, created_at from tooth_notes where id = ? for update").param(id)
          .query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Anotação"));
      OffsetDateTime at = ((java.sql.Timestamp) n.get("created_at")).toInstant().atOffset(java.time.ZoneOffset.UTC);
      if (!c.userId().equals(n.get("created_by")) || Duration.between(at, OffsetDateTime.now()).toHours() >= 24) {
        throw new ApiException(403, "FORBIDDEN", "Só quem escreveu pode apagar, e só nas primeiras 24 horas.");
      }
      db.sql("""
          insert into audit_log (clinic_id, user_id, action, entity, entity_id, diff)
          values (?, ?, 'tooth_note.delete', 'tooth_note', ?, jsonb_build_object('tooth', ?, 'note', ?::text))""")
          .params(c.clinicId(), c.userId(), id, n.get("tooth"), n.get("note")).update();
      db.sql("delete from tooth_notes where id = ?").param(id).update();
      return null;
    });
  }
}

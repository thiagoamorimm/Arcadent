package app.clinica.record;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Evoluções (diário clínico). Quem escreveu pode corrigir nas primeiras 24 h; depois, só quem tem
 * "editar e excluir evoluções". Excluir é lógico (deleted_at): prontuário não some, e a versão
 * anterior de cada edição fica no audit_log.
 */
@RestController
@RequestMapping("/api")
public class EvolutionController {
  private final Db db;

  public EvolutionController(Db db) { this.db = db; }

  public record Attachment(UUID id, String fileName, String mimeType, String kind) {}
  public record Evolution(UUID id, UUID treatmentId, String treatmentLabel, UUID professionalId, String professionalName,
                          String body, OffsetDateTime occurredAt, OffsetDateTime createdAt, OffsetDateTime updatedAt,
                          boolean edited, boolean canEdit, List<Attachment> files) {}
  private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();
  public record EvolutionReq(@NotBlank @Size(max = 10000) String body, UUID treatmentId, OffsetDateTime occurredAt) {}

  private static final String SELECT = """
      select e.id, e.treatment_id,
             case when t.id is null then null else p.name || coalesce(' · dente ' || t.tooth, '') end treatment_label,
             e.professional_id, u.name professional_name, e.body, e.occurred_at, e.created_at, e.updated_at,
             exists(select 1 from audit_log l where l.entity = 'evolution' and l.entity_id = e.id and l.action = 'evolution.edit') edited,
             (select coalesce(json_agg(json_build_object('id', f.id, 'fileName', f.file_name, 'mimeType', f.mime_type, 'kind', f.kind)
                                       order by f.created_at), '[]')::text
                from patient_files f where f.evolution_id = e.id and f.deleted_at is null) files
        from evolutions e
        join memberships m on m.id = e.professional_id join users u on u.id = m.user_id
        left join treatments t on t.id = e.treatment_id left join procedures p on p.id = t.procedure_id
      """;

  @GetMapping("/patients/{patientId}/evolutions")
  public List<Evolution> list(@PathVariable UUID patientId) {
    Ctx c = Ctx.current();
    c.requireClinical();
    return db.inClinic(() -> db.sql(SELECT + " where e.patient_id = ? and e.deleted_at is null order by e.occurred_at desc, e.created_at desc")
        .param(patientId).query((rs, n) -> map(rs, c)).list());
  }

  @PostMapping("/patients/{patientId}/evolutions")
  @ResponseStatus(HttpStatus.CREATED)
  public Evolution create(@PathVariable UUID patientId, @Valid @RequestBody EvolutionReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    if (r.occurredAt() != null && r.occurredAt().isAfter(OffsetDateTime.now().plusMinutes(5))) {
      throw ApiException.badRequest("FUTURE_DATE", "A evolução registra o que já aconteceu: a data não pode ser no futuro.");
    }
    return db.inClinic(() -> {
      if (r.treatmentId() != null) {
        boolean ok = db.sql("select exists(select 1 from treatments where id = ? and patient_id = ?)").params(r.treatmentId(), patientId)
            .query(Boolean.class).single();
        if (!ok) throw ApiException.badRequest("TREATMENT", "Esse tratamento não é deste paciente.");
      }
      UUID id = db.sql("""
          insert into evolutions (clinic_id, patient_id, treatment_id, professional_id, body, occurred_at)
          values (?, ?, ?, ?, ?, coalesce(?, now())) returning id""")
          .params(c.clinicId(), patientId, r.treatmentId(), c.membershipId(), r.body().trim(), r.occurredAt())
          .query(UUID.class).single();
      return get(id, c);
    });
  }

  @PatchMapping("/evolutions/{id}")
  public Evolution update(@PathVariable UUID id, @Valid @RequestBody EvolutionReq r) {
    Ctx c = Ctx.current();
    return db.inClinic(() -> {
      Evolution cur = get(id, c);
      if (!cur.canEdit()) throw new ApiException(403, "FORBIDDEN", "Só quem escreveu pode corrigir, e só nas primeiras 24 horas.");
      db.sql("""
          insert into audit_log (clinic_id, user_id, action, entity, entity_id, diff)
          values (?, ?, 'evolution.edit', 'evolution', ?, jsonb_build_object('before', ?::text))""")
          .params(c.clinicId(), c.userId(), id, cur.body()).update();
      db.sql("update evolutions set body = ?, treatment_id = ? where id = ?").params(r.body().trim(), r.treatmentId(), id).update();
      return get(id, c);
    });
  }

  @DeleteMapping("/evolutions/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("paciente.evolution_edit");
    db.inClinic(() -> {
      if (db.sql("update evolutions set deleted_at = now() where id = ? and deleted_at is null").param(id).update() == 0) {
        throw ApiException.notFound("Evolução");
      }
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'evolution.delete', 'evolution', ?)")
          .params(c.clinicId(), c.userId(), id).update();
    });
  }

  private Evolution get(UUID id, Ctx c) {
    return db.sql(SELECT + " where e.id = ? and e.deleted_at is null").param(id).query((rs, n) -> map(rs, c)).optional()
        .orElseThrow(() -> ApiException.notFound("Evolução"));
  }

  private static Evolution map(java.sql.ResultSet rs, Ctx c) throws java.sql.SQLException {
    UUID prof = (UUID) rs.getObject("professional_id");
    OffsetDateTime created = rs.getObject("created_at", OffsetDateTime.class);
    OffsetDateTime updated = rs.getObject("updated_at", OffsetDateTime.class);
    boolean mineRecent = prof.equals(c.membershipId()) && Duration.between(created, OffsetDateTime.now()).toHours() < 24;
    return new Evolution((UUID) rs.getObject("id"), (UUID) rs.getObject("treatment_id"), rs.getString("treatment_label"), prof,
        rs.getString("professional_name"), rs.getString("body"), rs.getObject("occurred_at", OffsetDateTime.class), created, updated,
        rs.getBoolean("edited"), mineRecent || c.can("paciente.evolution_edit"), files(rs.getString("files")));
  }

  private static List<Attachment> files(String json) {
    try {
      return List.of(JSON.readValue(json, Attachment[].class));
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}

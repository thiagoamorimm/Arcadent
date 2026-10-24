package app.clinica.record;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
 * Modelos de anamnese (Ajustes) e anamneses do paciente. A anamnese guarda uma cópia das perguntas
 * do dia (template_snapshot): mudar o modelo depois não altera o que o paciente respondeu.
 * Concluída = imutável (é prontuário). As respostas que batem com "alertOn" viram alertas na ficha.
 */
@RestController
@RequestMapping("/api")
public class AnamnesisController {
  private static final ObjectMapper JSON = new ObjectMapper()
      .setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
      .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
      .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
  private final Db db;
  private final PdfService pdf;

  public AnamnesisController(Db db, PdfService pdf) {
    this.db = db;
    this.pdf = pdf;
  }

  public record Question(@NotBlank String id, @NotBlank @Size(max = 300) String text, @NotBlank String type,
                         List<String> options, Boolean withDetail, String alertOn, @Size(max = 60) String alert) {}
  public record Template(UUID id, String name, List<Question> questions, boolean isActive, long usage) {}
  public record TemplateReq(@NotBlank @Size(max = 80) String name, @NotNull List<@Valid Question> questions) {}
  public record Answer(String value, String detail) {}
  public record Anamnesis(UUID id, UUID patientId, UUID templateId, String templateName, List<Question> questions,
                          Map<String, Answer> answers, String status, List<String> alerts, String professionalName,
                          OffsetDateTime createdAt, OffsetDateTime completedAt) {}
  public record CreateReq(@NotNull UUID templateId) {}
  public record SaveReq(Map<String, Answer> answers, Boolean complete) {}

  // ---------------- modelos ----------------

  @GetMapping("/anamnesis-templates")
  public List<Template> templates() {
    Ctx c = Ctx.current();
    if (!c.can("config.anamnesis")) c.requireClinical();
    return db.inClinic(() -> db.sql("""
        select t.id, t.name, t.questions::text questions, t.is_active,
               (select count(*) from anamneses a where a.template_id = t.id) usage
          from anamnesis_templates t order by t.is_active desc, t.name""")
        .query((rs, n) -> new Template((UUID) rs.getObject("id"), rs.getString("name"), questions(rs.getString("questions")),
            rs.getBoolean("is_active"), rs.getLong("usage")))
        .list());
  }

  @PostMapping("/anamnesis-templates")
  @ResponseStatus(HttpStatus.CREATED)
  public Template createTemplate(@Valid @RequestBody TemplateReq r) {
    Ctx c = Ctx.current();
    c.require("config.anamnesis");
    String qs = validate(r.questions());
    return db.inClinic(() -> {
      UUID id = db.sql("insert into anamnesis_templates (clinic_id, name, questions) values (?, ?, ?::jsonb) returning id")
          .params(c.clinicId(), r.name().trim(), qs).query(UUID.class).single();
      return template(id);
    });
  }

  @PatchMapping("/anamnesis-templates/{id}")
  public Template updateTemplate(@PathVariable UUID id, @Valid @RequestBody TemplateReq r) {
    Ctx.current().require("config.anamnesis");
    String qs = validate(r.questions());
    return db.inClinic(() -> {
      // Anamneses já feitas guardam a cópia das perguntas: editar o modelo não mexe nelas.
      if (db.sql("update anamnesis_templates set name = ?, questions = ?::jsonb where id = ?").params(r.name().trim(), qs, id).update() == 0) {
        throw ApiException.notFound("Modelo");
      }
      return template(id);
    });
  }

  @DeleteMapping("/anamnesis-templates/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void archiveTemplate(@PathVariable UUID id) {
    Ctx.current().require("config.anamnesis");
    db.inClinic(() -> {
      long active = db.sql("select count(*) from anamnesis_templates where is_active and id <> ?").param(id).query(Long.class).single();
      if (active == 0) throw new ApiException(409, "LAST_TEMPLATE", "Mantenha pelo menos um modelo ativo.");
      if (db.sql("update anamnesis_templates set is_active = false where id = ?").param(id).update() == 0) throw ApiException.notFound("Modelo");
    });
  }

  // ---------------- anamneses do paciente ----------------

  @GetMapping("/patients/{patientId}/anamneses")
  public List<Anamnesis> list(@PathVariable UUID patientId) {
    Ctx.current().require("paciente.anamnesis");
    return db.inClinic(() -> db.sql(SELECT + " where a.patient_id = ? order by a.created_at desc").param(patientId)
        .query((rs, n) -> map(rs)).list());
  }

  @GetMapping("/anamneses/{id}")
  public Anamnesis one(@PathVariable UUID id) {
    Ctx.current().require("paciente.anamnesis");
    return db.inClinic(() -> get(id));
  }

  @PostMapping("/patients/{patientId}/anamneses")
  @ResponseStatus(HttpStatus.CREATED)
  public Anamnesis create(@PathVariable UUID patientId, @Valid @RequestBody CreateReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.anamnesis");
    return db.inClinic(() -> {
      String qs = db.sql("select questions::text from anamnesis_templates where id = ? and is_active").param(r.templateId())
          .query(String.class).optional().orElseThrow(() -> ApiException.notFound("Modelo"));
      UUID id = db.sql("""
          insert into anamneses (clinic_id, patient_id, template_id, template_snapshot, filled_by, status, created_by)
          values (?, ?, ?, ?::jsonb, 'professional', 'draft', ?) returning id""")
          .params(c.clinicId(), patientId, r.templateId(), qs, c.userId()).query(UUID.class).single();
      return get(id);
    });
  }

  /** Salva rascunho; com complete=true conclui (calcula alertas e atualiza os alertas da ficha). */
  @PatchMapping("/anamneses/{id}")
  public Anamnesis save(@PathVariable UUID id, @RequestBody SaveReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.anamnesis");
    return db.inClinic(() -> {
      Anamnesis cur = db.sql(SELECT + " where a.id = ? for update of a").param(id).query((rs, n) -> map(rs)).optional()
          .orElseThrow(() -> ApiException.notFound("Anamnese"));
      if ("completed".equals(cur.status())) {
        throw new ApiException(409, "ANAMNESIS_LOCKED", "Anamnese concluída não pode ser alterada. Faça uma nova se algo mudou.");
      }
      Map<String, Answer> answers = clean(cur.questions(), r.answers() == null ? cur.answers() : r.answers());
      boolean complete = Boolean.TRUE.equals(r.complete());
      List<String> alerts = complete ? alerts(cur.questions(), answers) : List.of();
      db.sql("""
          update anamneses set answers = ?::jsonb, status = ?, alerts = ?::text[],
                 completed_at = case when ? then now() else completed_at end
           where id = ?""")
          .params(toJson(answers), complete ? "completed" : "draft", pgArray(alerts), complete, id).update();
      if (complete) {
        // Alertas da ficha = os da anamnese concluída mais recente.
        db.sql("update patients set clinical_alerts = ?::text[] where id = ?").params(pgArray(alerts), cur.patientId()).update();
        db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'anamnesis.complete', 'anamnesis', ?)")
            .params(c.clinicId(), c.userId(), id).update();
      }
      return get(id);
    });
  }

  /** Só rascunho pode ser descartado. */
  @DeleteMapping("/anamneses/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void discard(@PathVariable UUID id) {
    Ctx.current().require("paciente.anamnesis");
    db.inClinic(() -> {
      if (db.sql("delete from anamneses where id = ? and status = 'draft'").param(id).update() == 0) {
        throw new ApiException(409, "ANAMNESIS_LOCKED", "Só rascunhos podem ser descartados.");
      }
    });
  }

  @GetMapping("/anamneses/{id}/pdf")
  public ResponseEntity<byte[]> pdf(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("paciente.anamnesis");
    return db.inClinic(() -> {
      Anamnesis a = get(id);
      var patient = db.sql("select name, cpf, birth_date from patients where id = ?").param(a.patientId()).query().singleRow();
      StringBuilder body = new StringBuilder();
      body.append("<h1>Anamnese</h1>");
      body.append("<p class='meta'>").append(PdfService.esc(a.templateName())).append(a.status().equals("completed") ? "" : " — rascunho").append("</p>");
      body.append(PdfService.patientBlock((String) patient.get("name"), (String) patient.get("cpf"), patient.get("birth_date")));
      body.append("<table class='qa'>");
      for (Question q : a.questions()) {
        Answer ans = a.answers().get(q.id());
        String v = ans == null || ans.value() == null || ans.value().isBlank() ? "—" : label(q, ans.value());
        body.append("<tr><td class='q'>").append(PdfService.esc(q.text())).append("</td><td class='a'>").append(PdfService.esc(v));
        if (ans != null && ans.detail() != null && !ans.detail().isBlank()) body.append("<br/><span class='detail'>").append(PdfService.esc(ans.detail())).append("</span>");
        body.append("</td></tr>");
      }
      body.append("</table>");
      if (!a.alerts().isEmpty()) body.append("<p class='alerts'><b>Alertas:</b> ").append(PdfService.esc(String.join(", ", a.alerts()))).append("</p>");
      body.append("<p class='consent'>Declaro que as informações acima são verdadeiras.</p>");
      byte[] bytes = pdf.render(c, null, "Anamnese", body.toString(), a.completedAt() != null ? a.completedAt() : a.createdAt(), true);
      return pdfResponse(bytes, "anamnese.pdf");
    });
  }

  static ResponseEntity<byte[]> pdfResponse(byte[] bytes, String name) {
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_PDF)
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + name + "\"")
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .body(bytes);
  }

  // ---------------- regras ----------------

  private static final String SELECT = """
      select a.id, a.patient_id, a.template_id, coalesce(t.name, 'Anamnese') template_name, a.template_snapshot::text questions,
             a.answers::text answers, a.status, a.alerts, u.name professional_name, a.created_at, a.completed_at
        from anamneses a
        left join anamnesis_templates t on t.id = a.template_id
        left join users u on u.id = a.created_by
      """;

  private Anamnesis map(java.sql.ResultSet rs) throws java.sql.SQLException {
    java.sql.Array arr = rs.getArray("alerts");
    return new Anamnesis((UUID) rs.getObject("id"), (UUID) rs.getObject("patient_id"), (UUID) rs.getObject("template_id"),
        rs.getString("template_name"), questions(rs.getString("questions")), answers(rs.getString("answers")),
        rs.getString("status"), arr == null ? List.of() : List.of((String[]) arr.getArray()), rs.getString("professional_name"),
        rs.getObject("created_at", OffsetDateTime.class), rs.getObject("completed_at", OffsetDateTime.class));
  }

  private Anamnesis get(UUID id) {
    return db.sql(SELECT + " where a.id = ?").param(id).query((rs, n) -> map(rs)).optional()
        .orElseThrow(() -> ApiException.notFound("Anamnese"));
  }

  private Template template(UUID id) {
    return templates().stream().filter(t -> t.id().equals(id)).findFirst().orElseThrow();
  }

  /** Valida o modelo: ids únicos, tipos conhecidos, alerta coerente com o tipo. */
  static String validate(List<Question> qs) {
    if (qs.isEmpty()) throw ApiException.badRequest("QUESTIONS", "O modelo precisa de pelo menos uma pergunta.");
    if (qs.size() > 80) throw ApiException.badRequest("QUESTIONS", "No máximo 80 perguntas.");
    var ids = new HashSet<String>();
    var out = new ArrayList<Question>();
    for (Question q : qs) {
      if (!ids.add(q.id())) throw ApiException.badRequest("QUESTIONS", "Pergunta repetida: " + q.id());
      switch (q.type()) {
        case "yesno" -> {
          if (q.alertOn() != null && !List.of("sim", "nao").contains(q.alertOn())) throw ApiException.badRequest("QUESTIONS", "Alerta de sim/não deve ser 'sim' ou 'nao'.");
        }
        case "choice" -> {
          if (q.options() == null || q.options().size() < 2) throw ApiException.badRequest("QUESTIONS", "Pergunta de escolha precisa de pelo menos 2 opções: " + q.text());
          if (q.alertOn() != null && !q.options().contains(q.alertOn())) throw ApiException.badRequest("QUESTIONS", "O alerta precisa ser uma das opções: " + q.text());
        }
        case "text" -> {
          if (q.alertOn() != null) throw ApiException.badRequest("QUESTIONS", "Pergunta de texto livre não gera alerta.");
        }
        default -> throw ApiException.badRequest("QUESTIONS", "Tipo de pergunta inválido: " + q.type());
      }
      if (q.alertOn() != null && (q.alert() == null || q.alert().isBlank())) throw ApiException.badRequest("QUESTIONS", "Dê um nome ao alerta de: " + q.text());
      out.add(new Question(q.id(), q.text().trim(), q.type(), "choice".equals(q.type()) ? q.options() : null,
          Boolean.TRUE.equals(q.withDetail()) ? true : null, q.alertOn(), q.alertOn() == null ? null : q.alert().trim()));
    }
    return toJson(out);
  }

  /** Descarta respostas a perguntas que não existem e valores fora das opções. */
  static Map<String, Answer> clean(List<Question> qs, Map<String, Answer> in) {
    var out = new java.util.LinkedHashMap<String, Answer>();
    for (Question q : qs) {
      Answer a = in.get(q.id());
      if (a == null) continue;
      String v = a.value() == null ? null : a.value().trim();
      if (v != null && v.length() > 4000) v = v.substring(0, 4000);
      if ("yesno".equals(q.type()) && v != null && !List.of("sim", "nao").contains(v)) v = null;
      if ("choice".equals(q.type()) && v != null && !q.options().contains(v)) v = null;
      String d = a.detail() == null || a.detail().isBlank() ? null : a.detail().trim();
      if (v != null || d != null) out.put(q.id(), new Answer(v, d));
    }
    return out;
  }

  static List<String> alerts(List<Question> qs, Map<String, Answer> answers) {
    var out = new LinkedHashSet<String>();
    for (Question q : qs) {
      Answer a = answers.get(q.id());
      if (q.alertOn() != null && a != null && q.alertOn().equals(a.value())) {
        out.add(a.detail() != null ? q.alert() + ": " + (a.detail().length() > 60 ? a.detail().substring(0, 60) + "…" : a.detail()) : q.alert());
      }
    }
    return List.copyOf(out);
  }

  private static String label(Question q, String v) {
    return "yesno".equals(q.type()) ? ("sim".equals(v) ? "Sim" : "Não") : v;
  }

  static List<Question> questions(String json) {
    try { return JSON.readValue(json, new TypeReference<>() {}); } catch (Exception e) { return List.of(); }
  }

  static Map<String, Answer> answers(String json) {
    try { return json == null ? Map.of() : JSON.readValue(json, new TypeReference<>() {}); } catch (Exception e) { return Map.of(); }
  }

  static String toJson(Object o) {
    try { return JSON.writeValueAsString(o); } catch (Exception e) { throw new IllegalStateException(e); }
  }

  /** Texto livre em array do Postgres: aspas e barras escapadas. */
  static String pgArray(List<String> v) {
    StringBuilder sb = new StringBuilder("{");
    for (int i = 0; i < v.size(); i++) {
      if (i > 0) sb.append(',');
      sb.append('"').append(v.get(i).replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
    }
    return sb.append('}').toString();
  }
}

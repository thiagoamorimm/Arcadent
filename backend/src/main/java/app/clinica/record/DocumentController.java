package app.clinica.record;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Receita e atestado. O documento guarda os campos (data) e o HTML do corpo; o PDF é gerado na hora,
 * sempre igual. Documento emitido não é editado nem apagado: errou, emite outro.
 * Receita de controle especial (exige certificado ICP-Brasil) ainda não é suportada.
 */
@RestController
@RequestMapping("/api")
public class DocumentController {
  private final Db db;
  private final PdfService pdf;

  public DocumentController(Db db, PdfService pdf) {
    this.db = db;
    this.pdf = pdf;
  }

  public record RxItem(@NotBlank @Size(max = 200) String medication, @Size(max = 60) String quantity,
                       @Size(max = 500) String instructions, @Pattern(regexp = "interno|externo|topico") String usage) {}
  public record Prescription(@NotNull @Size(min = 1, max = 20) List<@Valid RxItem> items, @Size(max = 1000) String notes) {}
  public record Certificate(@NotBlank @Pattern(regexp = "comparecimento|afastamento") String type,
                            @NotNull LocalDate date, @Pattern(regexp = "\\d{2}:\\d{2}") String from, @Pattern(regexp = "\\d{2}:\\d{2}") String to,
                            @Min(1) @Max(60) Integer days, @Size(max = 10) String cid, Boolean cidAuthorized, @Size(max = 1000) String notes) {}
  public record CreateReq(@NotBlank @Pattern(regexp = "prescription|certificate") String kind, UUID professionalId,
                          @Valid Prescription prescription, @Valid Certificate certificate) {}
  public record Doc(UUID id, String kind, String title, String professionalName, OffsetDateTime createdAt) {}

  @GetMapping("/patients/{patientId}/documents")
  public List<Doc> list(@PathVariable UUID patientId) {
    Ctx.current().requireClinical();
    return db.inClinic(() -> db.sql("""
        select d.id, d.kind, d.title, u.name professional_name, d.created_at
          from documents d join memberships m on m.id = d.professional_id join users u on u.id = m.user_id
         where d.patient_id = ? order by d.created_at desc""").param(patientId).query(Doc.class).list());
  }

  /** Medicamentos já receitados na clínica, para sugerir ao digitar (sem base externa). */
  @GetMapping("/documents/medications")
  public List<String> medications() {
    Ctx.current().require("paciente.documents");
    return db.inClinic(() -> db.sql("""
        select distinct jsonb_array_elements(data->'items')->>'medication' m from documents
         where kind = 'prescription' order by 1 limit 300""").query(String.class).list());
  }

  @PostMapping("/patients/{patientId}/documents")
  @ResponseStatus(HttpStatus.CREATED)
  public Doc create(@PathVariable UUID patientId, @Valid @RequestBody CreateReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.documents");
    UUID prof = r.professionalId() != null ? r.professionalId() : c.membershipId();
    if (!prof.equals(c.membershipId()) && !c.isOwner()) {
      throw new ApiException(403, "FORBIDDEN", "Você só emite documentos em seu próprio nome.");
    }
    return db.inClinic(() -> {
      var p = db.sql("select name, cpf, birth_date from patients where id = ? and deleted_at is null").param(patientId)
          .query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Paciente"));
      String patient = PdfService.patientBlock((String) p.get("name"), (String) p.get("cpf"), p.get("birth_date"));
      String title, body, data;
      if ("prescription".equals(r.kind())) {
        if (r.prescription() == null) throw ApiException.badRequest("PRESCRIPTION", "Inclua pelo menos um medicamento.");
        title = "Receita (" + r.prescription().items().size() + (r.prescription().items().size() == 1 ? " item)" : " itens)");
        body = prescriptionHtml(patient, r.prescription());
        data = AnamnesisController.toJson(r.prescription());
      } else {
        Certificate ct = r.certificate();
        if (ct == null) throw ApiException.badRequest("CERTIFICATE", "Preencha o atestado.");
        if ("afastamento".equals(ct.type()) && ct.days() == null) throw ApiException.badRequest("DAYS", "Informe quantos dias de afastamento.");
        if ("comparecimento".equals(ct.type()) && (ct.from() == null || ct.to() == null)) throw ApiException.badRequest("HOURS", "Informe o horário do atendimento.");
        if (ct.cid() != null && !ct.cid().isBlank() && !Boolean.TRUE.equals(ct.cidAuthorized())) {
          throw ApiException.badRequest("CID_CONSENT", "O CID só pode constar no atestado com autorização do paciente.");
        }
        title = "afastamento".equals(ct.type()) ? "Atestado de afastamento (" + ct.days() + (ct.days() == 1 ? " dia)" : " dias)") : "Atestado de comparecimento";
        body = certificateHtml(patient, (String) p.get("name"), (String) p.get("cpf"), ct);
        data = AnamnesisController.toJson(ct);
      }
      UUID id = db.sql("""
          insert into documents (clinic_id, patient_id, professional_id, kind, title, body_rendered, data)
          values (?, ?, ?, ?, ?, ?, ?::jsonb) returning id""")
          .params(c.clinicId(), patientId, prof, r.kind(), title, body, data).query(UUID.class).single();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'document.issue', 'document', ?)")
          .params(c.clinicId(), c.userId(), id).update();
      return db.sql("""
          select d.id, d.kind, d.title, u.name professional_name, d.created_at
            from documents d join memberships m on m.id = d.professional_id join users u on u.id = m.user_id where d.id = ?""")
          .param(id).query(Doc.class).single();
    });
  }

  @GetMapping("/documents/{id}/pdf")
  public ResponseEntity<byte[]> pdf(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.requireClinical();
    return db.inClinic(() -> {
      Map<String, Object> d = db.sql("select kind, body_rendered, professional_id, created_at from documents where id = ?").param(id)
          .query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Documento"));
      String title = "prescription".equals(d.get("kind")) ? "Receita" : "Atestado";
      OffsetDateTime at = ((java.sql.Timestamp) d.get("created_at")).toInstant().atOffset(java.time.ZoneOffset.UTC);
      byte[] bytes = pdf.render(c, (UUID) d.get("professional_id"), title, (String) d.get("body_rendered"), at, false);
      return AnamnesisController.pdfResponse(bytes, title.toLowerCase() + ".pdf");
    });
  }

  private static String prescriptionHtml(String patient, Prescription rx) {
    StringBuilder sb = new StringBuilder("<h1>Receituário</h1>").append(patient);
    int n = 1;
    for (String use : List.of("interno", "externo", "topico")) {
      var items = rx.items().stream().filter(i -> use.equals(i.usage() == null ? "interno" : i.usage())).toList();
      if (items.isEmpty()) continue;
      sb.append("<p class='rx-use'>Uso ").append(switch (use) { case "externo" -> "externo"; case "topico" -> "tópico"; default -> "interno"; }).append("</p>");
      for (RxItem i : items) {
        sb.append("<div class='rx'><table class='line'><tr><td class='med'>").append(n++).append(". ").append(PdfService.esc(i.medication()))
            .append("</td><td class='qty'>").append(PdfService.esc(Text.blank(i.quantity()) == null ? "" : i.quantity())).append("</td></tr></table>");
        if (i.instructions() != null && !i.instructions().isBlank()) sb.append("<div class='how'>").append(PdfService.esc(i.instructions())).append("</div>");
        sb.append("</div>");
      }
    }
    if (rx.notes() != null && !rx.notes().isBlank()) sb.append("<p class='notes'>").append(PdfService.esc(rx.notes())).append("</p>");
    return sb.toString();
  }

  private static String certificateHtml(String patientBlock, String name, String cpf, Certificate ct) {
    String who = "<b>" + PdfService.esc(name) + "</b>" + (cpf == null ? "" : ", CPF " + PdfService.esc(cpf));
    String date = PdfService.longDate(ct.date());
    String text = "afastamento".equals(ct.type())
        ? "Atesto, para os devidos fins, que " + who + " foi atendido(a) em " + date + " e precisa de " + ct.days()
            + (ct.days() == 1 ? " dia" : " dias") + " de afastamento de suas atividades a partir dessa data"
        : "Atesto, para os devidos fins, que " + who + " esteve em atendimento odontológico em " + date
            + ", das " + ct.from() + " às " + ct.to();
    if (ct.cid() != null && !ct.cid().isBlank()) text += " (CID " + PdfService.esc(ct.cid().trim().toUpperCase()) + ", informado com autorização do paciente)";
    text += ".";
    StringBuilder sb = new StringBuilder("<h1>Atestado</h1>").append(patientBlock).append("<p class='text'>").append(text).append("</p>");
    if (ct.notes() != null && !ct.notes().isBlank()) sb.append("<p class='notes'>").append(PdfService.esc(ct.notes())).append("</p>");
    return sb.toString();
  }
}

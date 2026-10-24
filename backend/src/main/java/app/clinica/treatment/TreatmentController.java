package app.clinica.treatment;

import app.clinica.budget.BudgetController;
import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
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

@RestController
@RequestMapping("/api")
public class TreatmentController {
  private final Db db;

  public TreatmentController(Db db) { this.db = db; }

  public record Treatment(UUID id, UUID procedureId, String procedureName, String specialty, UUID professionalId,
                          String professionalName, Integer tooth, List<String> faces, String region, long priceCents,
                          String status, OffsetDateTime doneAt, OffsetDateTime createdAt, Long budgetNumber) {}
  public record FinishReq(@NotEmpty List<UUID> ids, OffsetDateTime doneAt) {}
  public record ToothReq(@NotNull Integer tooth, List<String> faces) {}
  /** teeth vazio = procedimento de boca toda/região. charge = lança débito (exige permissão de financeiro). */
  public record CreateReq(@NotNull UUID procedureId, @NotNull UUID professionalId, @Size(max = 32) List<@Valid ToothReq> teeth,
                          @Size(max = 40) String region, @PositiveOrZero Long priceCents, boolean charge, LocalDate dueDate) {}

  /** Tratamentos do paciente; o front monta o odontograma a partir de dente/faces/status. */
  @GetMapping("/patients/{patientId}/treatments")
  public List<Treatment> list(@PathVariable UUID patientId) {
    return db.inClinic(() -> query("t.patient_id = ?", patientId));
  }

  /**
   * Tratamento avulso (sem orçamento): um por dente marcado, com as faces dele. Com "charge", cada
   * tratamento ganha o seu débito, ligado a ele (cancelar o tratamento cancela o débito ainda não pago).
   */
  @PostMapping("/patients/{patientId}/treatments")
  @ResponseStatus(HttpStatus.CREATED)
  public List<Treatment> create(@PathVariable UUID patientId, @Valid @RequestBody CreateReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    if (r.charge()) c.require("fin.debits_create");
    List<ToothReq> teeth = r.teeth() == null ? List.of() : r.teeth();
    for (ToothReq t : teeth) BudgetController.validateTooth(t.tooth(), t.faces());
    if (teeth.stream().map(ToothReq::tooth).distinct().count() != teeth.size()) {
      throw ApiException.badRequest("TOOTH", "Dente repetido na seleção.");
    }
    return db.inClinic(() -> {
      if (db.sql("select count(*) from patients where id = ? and deleted_at is null").param(patientId).query(Long.class).single() == 0) {
        throw ApiException.notFound("Paciente");
      }
      var proc = db.sql("select name, price_cents, scope from procedures where id = ? and is_active").param(r.procedureId())
          .query().listOfRows().stream().findFirst()
          .orElseThrow(() -> ApiException.badRequest("PROCEDURE", "Procedimento não encontrado."));
      String scope = (String) proc.get("scope");
      if ((scope.equals("tooth") || scope.equals("face")) && teeth.isEmpty()) {
        throw ApiException.badRequest("TOOTH", "Este procedimento é por dente: marque ao menos um dente.");
      }
      if (db.sql("select count(*) from memberships where id = ? and is_active and does_attend").param(r.professionalId())
          .query(Long.class).single() == 0) {
        throw ApiException.badRequest("PROFESSIONAL", "Escolha um profissional que atende.");
      }
      long price = r.priceCents() != null ? r.priceCents() : ((Number) proc.get("price_cents")).longValue();
      List<ToothReq> targets = teeth.isEmpty() ? java.util.Collections.singletonList(null) : teeth;
      List<UUID> ids = new ArrayList<>();
      LocalDate due = r.dueDate() != null ? r.dueDate() : LocalDate.now();
      for (ToothReq t : targets) {
        List<String> faces = t == null || !scope.equals("face") ? List.of() : (t.faces() == null ? List.of() : t.faces());
        UUID id = db.sql("""
            insert into treatments (clinic_id, patient_id, procedure_id, professional_id, tooth, faces, region, price_cents)
            values (?, ?, ?, ?, ?, ?::text[], ?, ?) returning id""")
            .params(c.clinicId(), patientId, r.procedureId(), r.professionalId(), t == null ? null : t.tooth(),
                BudgetController.pgArray(faces), t == null ? Text.blank(r.region()) : null, price)
            .query(UUID.class).single();
        ids.add(id);
        if (r.charge() && price > 0) {
          String desc = proc.get("name") + (t == null ? "" : " — dente " + t.tooth());
          db.sql("""
              insert into debits (clinic_id, patient_id, treatment_id, description, amount_cents, due_date, created_by)
              values (?, ?, ?, ?, ?, ?, ?)""")
              .params(c.clinicId(), patientId, id, desc, price, due, c.userId()).update();
        }
      }
      for (UUID id : ids) log(c, "treatment.create", id, null, snapshot(id));
      return query("t.id = any(?::uuid[])", uuidArray(ids));
    });
  }

  /** Finaliza um ou vários tratamentos. Já finalizados ficam como estão (idempotente). */
  @PostMapping("/treatments/finish")
  public List<Treatment> finish(@Valid @RequestBody FinishReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    return db.inClinic(() -> {
      List<UUID> done = db.sql("""
          update treatments set status = 'done', done_at = coalesce(?, now())
           where id = any(?::uuid[]) and status = 'open' returning id""")
          .params(r.doneAt(), uuidArray(r.ids())).query(UUID.class).list();
      for (UUID id : done) log(c, "treatment.finish", id, null, snapshot(id));
      int n = done.size();
      if (n == 0) {
        long exists = db.sql("select count(*) from treatments where id = any(?::uuid[])")
            .param(uuidArray(r.ids())).query(Long.class).single();
        if (exists == 0) throw ApiException.notFound("Tratamento");
      }
      return query("t.id = any(?::uuid[])", uuidArray(r.ids()));
    });
  }

  /**
   * Cancela tratamento em aberto (lançado errado ou desistência). O débito ligado a ele, se ainda não
   * recebeu nada, é cancelado junto; com recebimento, fica e o aviso diz o que fazer.
   */
  @PostMapping("/treatments/{id}/cancel")
  public Treatment cancel(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    return db.inClinic(() -> {
      String status = db.sql("select status from treatments where id = ? for update").param(id).query(String.class)
          .optional().orElseThrow(() -> ApiException.notFound("Tratamento"));
      if (status.equals("done")) throw new ApiException(409, "TREATMENT_DONE", "Tratamento finalizado não pode ser cancelado.");
      if (status.equals("open")) {
        db.sql("update treatments set status = 'canceled' where id = ?").param(id).update();
        db.sql("update debits set status = 'canceled' where treatment_id = ? and paid_cents = 0 and status = 'open'").param(id).update();
        log(c, "treatment.cancel", id, null, snapshot(id));
      }
      return query("t.id = ?", id).get(0);
    });
  }

  public record UpdateReq(@NotNull UUID procedureId, @NotNull UUID professionalId, Integer tooth, List<String> faces,
                          @Size(max = 40) String region, @NotNull @PositiveOrZero Long priceCents) {}
  public record HistoryEntry(String action, OffsetDateTime at, String userName, String before, String after, String note) {}

  /**
   * Edita um tratamento (dente, faces, procedimento, valor, profissional). Fica no histórico o antes e
   * o depois, com quem e quando. Débito avulso ligado e ainda não pago acompanha o novo valor; parcelas
   * de orçamento não mudam (o orçamento aprovado é o combinado com o paciente).
   */
  @PatchMapping("/treatments/{id}")
  public Treatment update(@PathVariable UUID id, @Valid @RequestBody UpdateReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    List<String> faces = r.faces() == null ? List.of() : r.faces();
    BudgetController.validateTooth(r.tooth(), faces);
    return db.inClinic(() -> {
      String status = db.sql("select status from treatments where id = ? for update").param(id).query(String.class)
          .optional().orElseThrow(() -> ApiException.notFound("Tratamento"));
      if (status.equals("canceled")) throw new ApiException(409, "TREATMENT_DELETED", "Este tratamento foi excluído.");
      if (status.equals("done")) c.require("paciente.evolution_edit");
      var proc = db.sql("select name, scope from procedures where id = ?").param(r.procedureId()).query().listOfRows().stream().findFirst()
          .orElseThrow(() -> ApiException.badRequest("PROCEDURE", "Procedimento não encontrado."));
      String scope = (String) proc.get("scope");
      boolean byTooth = scope.equals("tooth") || scope.equals("face");
      if (byTooth && r.tooth() == null) throw ApiException.badRequest("TOOTH", "Este procedimento é por dente: escolha o dente.");
      if (db.sql("select count(*) from memberships where id = ? and is_active and does_attend").param(r.professionalId())
          .query(Long.class).single() == 0) {
        throw ApiException.badRequest("PROFESSIONAL", "Escolha um profissional que atende.");
      }
      String before = snapshot(id);
      Integer tooth = byTooth ? r.tooth() : null;
      db.sql("""
          update treatments set procedure_id = ?, professional_id = ?, tooth = ?, faces = ?::text[], region = ?, price_cents = ?
           where id = ?""")
          .params(r.procedureId(), r.professionalId(), tooth, BudgetController.pgArray(scope.equals("face") ? faces : List.of()),
              tooth == null ? Text.blank(r.region()) : null, r.priceCents(), id).update();
      if (r.priceCents() > 0) {
        db.sql("""
            update debits set amount_cents = ?, description = ?
             where treatment_id = ? and budget_id is null and paid_cents = 0 and status = 'open'""")
            .params(r.priceCents(), proc.get("name") + (tooth == null ? "" : " — dente " + tooth), id).update();
      }
      String after = snapshot(id);
      if (!after.equals(before)) log(c, "treatment.update", id, before, after);
      return query("t.id = ?", id).get(0);
    });
  }

  /**
   * Exclui o tratamento da ficha e do odontograma. Não apaga de verdade (é prontuário): fica como
   * excluído, com quem, quando e como estava. Débito avulso ainda não pago é cancelado junto.
   * Finalizado só sai com permissão de editar prontuário.
   */
  @DeleteMapping("/treatments/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("paciente.treatments");
    db.inClinic(() -> {
      String status = db.sql("select status from treatments where id = ? for update").param(id).query(String.class)
          .optional().orElseThrow(() -> ApiException.notFound("Tratamento"));
      if (status.equals("canceled")) return null;
      if (status.equals("done")) c.require("paciente.evolution_edit");
      String before = snapshot(id);
      db.sql("update treatments set status = 'canceled', done_at = null where id = ?").param(id).update();
      db.sql("update debits set status = 'canceled' where treatment_id = ? and budget_id is null and paid_cents = 0 and status = 'open'")
          .param(id).update();
      log(c, "treatment.delete", id, before, null);
      return null;
    });
  }

  /** Histórico do tratamento: criação (ou origem no orçamento), edições, finalização, exclusão. */
  @GetMapping("/treatments/{id}/history")
  public List<HistoryEntry> history(@PathVariable UUID id) {
    Ctx.current().requireClinical();
    return db.inClinic(() -> {
      var t = db.sql("""
          select t.created_at, b.number from treatments t
            left join budget_items bi on bi.id = t.budget_item_id left join budgets b on b.id = bi.budget_id
           where t.id = ?""").param(id).query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Tratamento"));
      List<HistoryEntry> out = new ArrayList<>(db.sql("""
          select l.action, l.at, u.name user_name, l.diff->>'before' before, l.diff->>'after' after, null note
            from audit_log l left join users u on u.id = l.user_id
           where l.entity = 'treatment' and l.entity_id = ? order by l.at, l.id""").param(id).query(HistoryEntry.class).list());
      if (out.stream().noneMatch(h -> h.action().equals("treatment.create"))) {
        out.add(0, new HistoryEntry("treatment.create", ((java.sql.Timestamp) t.get("created_at")).toInstant().atOffset(java.time.ZoneOffset.UTC),
            null, null, null, t.get("number") == null ? null : "Lançado pela aprovação do orçamento nº " + t.get("number")));
      }
      return out;
    });
  }

  /** Como o tratamento está agora, em JSON, para o antes/depois do histórico. */
  private String snapshot(UUID id) {
    return db.sql("""
        select jsonb_build_object('tooth', t.tooth, 'faces', array_to_string(t.faces, ''), 'procedure', p.name,
                                  'priceCents', t.price_cents, 'professional', u.name, 'status', t.status, 'region', t.region)::text
          from treatments t join procedures p on p.id = t.procedure_id
          join memberships m on m.id = t.professional_id join users u on u.id = m.user_id
         where t.id = ?""").param(id).query(String.class).single();
  }

  private void log(Ctx c, String action, UUID id, String before, String after) {
    db.sql("""
        insert into audit_log (clinic_id, user_id, action, entity, entity_id, diff)
        values (?, ?, ?, 'treatment', ?, jsonb_strip_nulls(jsonb_build_object('before', ?::jsonb, 'after', ?::jsonb)))""")
        .params(c.clinicId(), c.userId(), action, id, before, after).update();
  }

  private static String uuidArray(List<UUID> ids) {
    return "{" + String.join(",", ids.stream().map(UUID::toString).toList()) + "}";
  }

  private List<Treatment> query(String where, Object param) {
    return db.sql("""
        select t.id, t.procedure_id, p.name procedure_name, p.specialty, t.professional_id, u.name professional_name,
               t.tooth, array_to_string(t.faces, ',') faces, t.region, t.price_cents, t.status, t.done_at, t.created_at,
               b.number budget_number
          from treatments t
          join procedures p on p.id = t.procedure_id
          join memberships m on m.id = t.professional_id
          join users u on u.id = m.user_id
          left join budget_items bi on bi.id = t.budget_item_id
          left join budgets b on b.id = bi.budget_id
         where""" + " " + where + " order by t.status, t.tooth nulls last, t.created_at")
        .param(param)
        .query((rs, n) -> new Treatment((UUID) rs.getObject("id"), (UUID) rs.getObject("procedure_id"),
            rs.getString("procedure_name"), rs.getString("specialty"), (UUID) rs.getObject("professional_id"),
            rs.getString("professional_name"), rs.getObject("tooth", Integer.class), Text.csv(rs.getString("faces")),
            rs.getString("region"), rs.getLong("price_cents"), rs.getString("status"),
            rs.getObject("done_at", OffsetDateTime.class), rs.getObject("created_at", OffsetDateTime.class),
            rs.getObject("budget_number", Long.class)))
        .list();
  }
}

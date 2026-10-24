package app.clinica.budget;

import app.clinica.record.PdfService;
import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Orçamento → (aprovação) → tratamentos + débitos. A aprovação é uma transação só e é idempotente:
 * aprovar de novo um orçamento já aprovado devolve o mesmo resultado, sem duplicar nada.
 */
@RestController
@RequestMapping("/api")
public class BudgetController {
  private static final Set<String> FACES = Set.of("M", "D", "O", "V", "L");
  private final Db db;
  private final PdfService pdf;

  public BudgetController(Db db, PdfService pdf) {
    this.db = db;
    this.pdf = pdf;
  }

  public record ItemReq(@NotNull UUID procedureId, Integer tooth, List<String> faces, @Size(max = 40) String region,
                        @PositiveOrZero Long priceCents) {}
  public record CreateReq(@NotNull UUID professionalId, @NotEmpty @Size(max = 100) List<@Valid ItemReq> items,
                          @PositiveOrZero Long discountCents, @Min(1) @Max(60) Integer installments,
                          LocalDate firstDueDate, @Size(max = 2000) String notes) {}
  /** itemIds vazio/nulo = aprova tudo. */
  public record ApproveReq(List<UUID> itemIds, LocalDate firstDueDate) {}

  public record Item(UUID id, UUID procedureId, String procedureName, Integer tooth, List<String> faces, String region,
                     long priceCents, Boolean approved) {}
  public record Budget(UUID id, long number, UUID patientId, UUID professionalId, String professionalName, String status,
                       long subtotalCents, long discountCents, long totalCents, int installments, LocalDate firstDueDate,
                       String notes, OffsetDateTime createdAt, OffsetDateTime approvedAt, List<Item> items) {}

  @GetMapping("/patients/{patientId}/budgets")
  public List<Budget> list(@PathVariable UUID patientId) {
    Ctx.current().require("paciente.budgets");
    return db.inClinic(() -> {
      List<UUID> ids = db.sql("select id from budgets where patient_id = ? order by created_at desc")
          .param(patientId).query(UUID.class).list();
      return ids.stream().map(this::get).toList();
    });
  }

  @GetMapping("/budgets/{id}")
  public Budget one(@PathVariable UUID id) {
    Ctx.current().require("paciente.budgets");
    return db.inClinic(() -> get(id));
  }

  @PostMapping("/patients/{patientId}/budgets")
  @ResponseStatus(HttpStatus.CREATED)
  public Budget create(@PathVariable UUID patientId, @Valid @RequestBody CreateReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.budgets");
    for (ItemReq i : r.items()) validateTooth(i.tooth(), i.faces());
    return db.inClinic(() -> {
      long number = nextNumber(c.clinicId(), "budget");
      UUID priceTable = db.sql("select id from price_tables where is_default").query(UUID.class).optional().orElse(null);
      UUID id = db.sql("""
          insert into budgets (clinic_id, number, patient_id, professional_id, price_table_id, discount_cents,
                               installments, first_due_date, notes, created_by)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
          .params(c.clinicId(), number, patientId, r.professionalId(), priceTable,
              r.discountCents() == null ? 0 : r.discountCents(), r.installments() == null ? 1 : r.installments(),
              r.firstDueDate(), Text.blank(r.notes()), c.userId())
          .query(UUID.class).single();
      short pos = 0;
      for (ItemReq i : r.items()) {
        // Preço vem da tabela, a menos que o profissional tenha ajustado no orçamento.
        long price = i.priceCents() != null ? i.priceCents()
            : db.sql("select price_cents from procedures where id = ?").param(i.procedureId()).query(Long.class)
                .optional().orElseThrow(() -> ApiException.badRequest("PROCEDURE", "Procedimento não encontrado."));
        db.sql("""
            insert into budget_items (clinic_id, budget_id, procedure_id, tooth, faces, region, price_cents, position)
            values (?, ?, ?, ?, ?::text[], ?, ?, ?)""")
            .params(c.clinicId(), id, i.procedureId(), i.tooth(), pgArray(i.faces()), Text.blank(i.region()), price, pos++)
            .update();
      }
      recalcTotal(id);
      return get(id);
    });
  }

  @PostMapping("/budgets/{id}/approve")
  public Budget approve(@PathVariable UUID id, @RequestBody(required = false) ApproveReq r) {
    Ctx c = Ctx.current();
    c.require("paciente.budgets");
    return db.inClinic(() -> {
      // Trava o orçamento: dois cliques simultâneos não geram tratamento/débito em dobro.
      var b = db.sql("select status, patient_id, professional_id, installments, first_due_date from budgets where id = ? for update")
          .param(id).query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Orçamento"));
      String status = (String) b.get("status");
      if (status.equals("approved") || status.equals("partial")) return get(id); // idempotente
      if (status.equals("rejected")) throw new ApiException(409, "BUDGET_REJECTED", "Este orçamento foi reprovado. Duplique-o para aprovar de novo.");

      List<UUID> all = db.sql("select id from budget_items where budget_id = ? order by position").param(id).query(UUID.class).list();
      List<UUID> chosen = r == null || r.itemIds() == null || r.itemIds().isEmpty() ? all : r.itemIds();
      if (!all.containsAll(chosen)) throw ApiException.badRequest("ITEMS", "Há itens que não pertencem a este orçamento.");

      db.sql("update budget_items set approved = (id = any(?::uuid[])) where budget_id = ?")
          .params(pgUuidArray(chosen), id).update();
      String newStatus = chosen.size() == all.size() ? "approved" : "partial";
      LocalDate first = r != null && r.firstDueDate() != null ? r.firstDueDate()
          : b.get("first_due_date") != null ? ((java.sql.Date) b.get("first_due_date")).toLocalDate() : LocalDate.now();
      db.sql("update budgets set status = ?, approved_at = now(), first_due_date = ? where id = ?")
          .params(newStatus, first, id).update();
      long total = recalcTotal(id);

      // 1 item aprovado = 1 tratamento (com dente e faces) em aberto.
      db.sql("""
          insert into treatments (clinic_id, patient_id, budget_item_id, procedure_id, professional_id, tooth, faces, region, price_cents)
          select i.clinic_id, ?, i.id, i.procedure_id, ?, i.tooth, i.faces, i.region, i.price_cents
            from budget_items i where i.budget_id = ? and i.approved""")
          .params(b.get("patient_id"), b.get("professional_id"), id).update();

      // Débitos: parcelas mensais; o resto da divisão vai na primeira (soma = total, sempre).
      int n = ((Number) b.get("installments")).intValue();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, ?, 'budget', ?)")
          .params(c.clinicId(), c.userId(), newStatus.equals("approved") ? "budget.approve" : "budget.approve_partial", id).update();
      if (total > 0) {
        long[] parts = split(total, n);
        long number = db.sql("select number from budgets where id = ?").param(id).query(Long.class).single();
        for (int k = 0; k < n; k++) {
          String desc = n == 1 ? "Orçamento nº " + number : "Orçamento nº " + number + " — parcela " + (k + 1) + "/" + n;
          db.sql("""
              insert into debits (clinic_id, patient_id, budget_id, description, amount_cents, due_date, installment_no, installments, created_by)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?)""")
              .params(c.clinicId(), b.get("patient_id"), id, desc, parts[k], first.plusMonths(k), k + 1, n, c.userId())
              .update();
        }
      }
      return get(id);
    });
  }

  @PostMapping("/budgets/{id}/reject")
  public Budget reject(@PathVariable UUID id, @RequestBody(required = false) Map<String, String> body) {
    Ctx c = Ctx.current();
    c.require("paciente.budgets");
    return db.inClinic(() -> {
      int n = db.sql("update budgets set status = 'rejected', rejected_reason = ? where id = ? and status = 'open'")
          .params(body == null ? null : Text.blank(body.get("reason")), id).update();
      if (n == 0) throw new ApiException(409, "BUDGET_NOT_OPEN", "Só orçamentos em aberto podem ser reprovados.");
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'budget.reject', 'budget', ?)")
          .params(c.clinicId(), c.userId(), id).update();
      return get(id);
    });
  }

  /** Orçamento em PDF para o paciente levar ou assinar: itens por dente, desconto, parcelas e validade. */
  @GetMapping("/budgets/{id}/pdf")
  public org.springframework.http.ResponseEntity<byte[]> pdf(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("paciente.budgets");
    return db.inClinic(() -> {
      Budget b = get(id);
      var p = db.sql("select name, cpf, birth_date from patients where id = ?").param(b.patientId()).query().singleRow();
      var nf = java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag("pt-BR"));
      java.util.function.LongFunction<String> money = v -> PdfService.esc(nf.format(v / 100.0));
      StringBuilder h = new StringBuilder("<h1>Orçamento</h1>");
      String status = switch (b.status()) { case "approved" -> "aprovado"; case "partial" -> "aprovado em parte"; case "rejected" -> "reprovado"; default -> "em aberto"; };
      h.append("<p class='meta'>Nº ").append(b.number()).append(" — ").append(status).append("</p>");
      h.append(PdfService.patientBlock((String) p.get("name"), (String) p.get("cpf"), p.get("birth_date")));
      h.append("<table class='qa'><tr><td style='width:18%'><b>Dente / região</b></td><td><b>Procedimento</b></td><td style='text-align:right;width:22%'><b>Valor</b></td></tr>");
      for (Item i : b.items()) {
        String where = i.tooth() != null ? i.tooth() + (i.faces().isEmpty() ? "" : " (" + String.join("", i.faces()) + ")") : i.region() != null ? i.region() : "Boca toda";
        boolean out = Boolean.FALSE.equals(i.approved());
        h.append("<tr").append(out ? " style='color:#868e98'" : "").append("><td>").append(PdfService.esc(where)).append("</td><td>")
            .append(PdfService.esc(i.procedureName())).append(out ? " <i>(não aprovado)</i>" : "")
            .append("</td><td style='text-align:right'>").append(money.apply(i.priceCents())).append("</td></tr>");
      }
      h.append("</table><table style='margin-top:8pt'>");
      if (b.discountCents() > 0) {
        h.append("<tr><td style='text-align:right'>Subtotal</td><td style='text-align:right;width:22%'>").append(money.apply(b.subtotalCents())).append("</td></tr>");
        h.append("<tr><td style='text-align:right'>Desconto</td><td style='text-align:right'>– ").append(money.apply(b.discountCents())).append("</td></tr>");
      }
      h.append("<tr><td style='text-align:right;font-size:13pt'><b>Total</b></td><td style='text-align:right;font-size:13pt;width:22%'><b>")
          .append(money.apply(b.totalCents())).append("</b></td></tr></table>");
      if (b.installments() > 1) {
        long[] parts = split(b.totalCents(), b.installments());
        h.append("<p class='notes'>Pagamento em ").append(b.installments()).append("x de ").append(money.apply(parts[1]))
            .append(parts[0] != parts[1] ? " (1ª parcela " + money.apply(parts[0]) + ")" : "")
            .append(b.firstDueDate() != null ? ", 1º vencimento em " + b.firstDueDate().format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy")) : "").append(".</p>");
      }
      if (b.notes() != null && !b.notes().isBlank()) h.append("<p class='notes'>").append(PdfService.esc(b.notes())).append("</p>");
      if ("open".equals(b.status())) h.append("<p class='notes'>Orçamento válido por 30 dias a partir da emissão.</p>");
      byte[] bytes = pdf.render(c, b.professionalId(), "Orçamento " + b.number(), h.toString(), b.createdAt(), true);
      return org.springframework.http.ResponseEntity.ok().contentType(org.springframework.http.MediaType.APPLICATION_PDF)
          .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"orcamento-" + b.number() + ".pdf\"")
          .header(org.springframework.http.HttpHeaders.CACHE_CONTROL, "no-store").body(bytes);
    });
  }

  /** Parcelas que somam exatamente o total; o resto vai na primeira. */
  public static long[] split(long total, int n) {
    long[] out = new long[n];
    long base = total / n;
    for (int i = 0; i < n; i++) out[i] = base;
    out[0] += total - base * n;
    return out;
  }

  /** Total = soma dos itens (aprovados, se já houve aprovação) − desconto, nunca negativo. */
  private long recalcTotal(UUID id) {
    return db.sql("""
        update budgets b set total_cents = greatest(0, coalesce((
            select sum(i.price_cents) from budget_items i
             where i.budget_id = b.id and (b.status in ('open','rejected') or i.approved)), 0) - b.discount_cents)
         where b.id = ? returning total_cents""").param(id).query(Long.class).single();
  }

  private long nextNumber(UUID clinicId, String counter) {
    return db.sql("""
        insert into clinic_counters (clinic_id, name, value) values (?, ?, 1)
        on conflict (clinic_id, name) do update set value = clinic_counters.value + 1
        returning value""").params(clinicId, counter).query(Long.class).single();
  }

  private Budget get(UUID id) {
    var row = db.sql("""
        select b.id, b.number, b.patient_id, b.professional_id, u.name professional_name, b.status,
               b.discount_cents, b.total_cents, b.installments, b.first_due_date, b.notes, b.created_at, b.approved_at,
               (select coalesce(sum(price_cents),0) from budget_items where budget_id = b.id) subtotal_cents
          from budgets b join memberships m on m.id = b.professional_id join users u on u.id = m.user_id
         where b.id = ?""").param(id).query().listOfRows().stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Orçamento"));
    List<Item> items = db.sql("""
        select i.id, i.procedure_id, p.name procedure_name, i.tooth, array_to_string(i.faces, ',') faces, i.region,
               i.price_cents, i.approved
          from budget_items i join procedures p on p.id = i.procedure_id
         where i.budget_id = ? order by i.position""").param(id)
        .query((rs, n) -> new Item((UUID) rs.getObject("id"), (UUID) rs.getObject("procedure_id"),
            rs.getString("procedure_name"), (Integer) rs.getObject("tooth", Integer.class), Text.csv(rs.getString("faces")),
            rs.getString("region"), rs.getLong("price_cents"), (Boolean) rs.getObject("approved")))
        .list();
    return new Budget((UUID) row.get("id"), ((Number) row.get("number")).longValue(), (UUID) row.get("patient_id"),
        (UUID) row.get("professional_id"), (String) row.get("professional_name"), (String) row.get("status"),
        ((Number) row.get("subtotal_cents")).longValue(), ((Number) row.get("discount_cents")).longValue(),
        ((Number) row.get("total_cents")).longValue(), ((Number) row.get("installments")).intValue(),
        row.get("first_due_date") == null ? null : ((java.sql.Date) row.get("first_due_date")).toLocalDate(),
        (String) row.get("notes"),
        toOdt(row.get("created_at")), toOdt(row.get("approved_at")), items);
  }

  public static void validateTooth(Integer tooth, List<String> faces) {
    // FDI: quadrantes 1–4 (permanentes) têm dentes 1–8; quadrantes 5–8 (decíduos) só 1–5.
    int q = tooth == null ? 0 : tooth / 10, u = tooth == null ? 0 : tooth % 10;
    if (tooth != null && !(q >= 1 && q <= 4 && u >= 1 && u <= 8 || q >= 5 && q <= 8 && u >= 1 && u <= 5)) {
      throw ApiException.badRequest("TOOTH", "Dente inválido: " + tooth + ". Use a numeração FDI: permanentes 11–48, decíduos 51–85 (só até 5 em cada quadrante).");
    }
    if (faces != null && !FACES.containsAll(faces)) {
      throw ApiException.badRequest("FACES", "Faces válidas: M, D, O, V, L.");
    }
  }

  public static String pgArray(List<String> faces) {
    return faces == null || faces.isEmpty() ? "{}" : "{" + String.join(",", new ArrayList<>(new java.util.LinkedHashSet<>(faces))) + "}";
  }

  private static String pgUuidArray(List<UUID> ids) {
    return "{" + String.join(",", ids.stream().map(UUID::toString).toList()) + "}";
  }

  private static OffsetDateTime toOdt(Object ts) {
    return ts == null ? null : ((java.sql.Timestamp) ts).toInstant().atOffset(java.time.ZoneOffset.UTC);
  }
}

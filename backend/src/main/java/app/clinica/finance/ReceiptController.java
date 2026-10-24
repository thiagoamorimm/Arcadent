package app.clinica.finance;

import app.clinica.record.PdfService;
import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Recibo numerado. O número vem de um contador por clínica, na mesma transação (sem buracos nem
 * repetição, mesmo com dois recibos ao mesmo tempo). Recibo cancelado guarda o número e sai do PDF
 * como CANCELADO; o pagamento volta a poder receber outro recibo.
 */
@RestController
@RequestMapping("/api")
public class ReceiptController {
  private static final Map<String, String> METHOD = Map.of("dinheiro", "dinheiro", "cheque", "cheque", "cartao_credito", "cartão de crédito",
      "cartao_debito", "cartão de débito", "pix", "Pix", "transferencia", "transferência", "boleto", "boleto", "outro", "outra forma");
  private final Db db;
  private final PdfService pdf;

  public ReceiptController(Db db, PdfService pdf) {
    this.db = db;
    this.pdf = pdf;
  }

  public record Payer(@Size(max = 160) String name, @Size(max = 20) String cpf) {}
  public record CreateReq(@NotEmpty @Size(max = 50) List<UUID> paymentIds, @Valid Payer payer) {}
  public record Receipt(UUID id, long number, UUID patientId, String patientName, String payerName, String payerCpf,
                        long totalCents, OffsetDateTime issuedAt, OffsetDateTime canceledAt, String issuedBy) {}

  private static final String SELECT = """
      select r.id, r.number, r.patient_id, p.name patient_name, r.payer->>'name' payer_name, r.payer->>'cpf' payer_cpf,
             r.total_cents, r.issued_at, r.canceled_at, u.name issued_by
        from receipts r left join patients p on p.id = r.patient_id left join users u on u.id = r.created_by
      """;

  @GetMapping("/receipts")
  public List<Receipt> list(@RequestParam(required = false) UUID patientId) {
    Ctx.current().require("fin.debits_view");
    return db.inClinic(() -> db.sql(SELECT + " where (?::uuid is null or r.patient_id = ?) order by r.number desc limit 500")
        .params(patientId, patientId).query(Receipt.class).list());
  }

  @PostMapping("/receipts")
  @ResponseStatus(HttpStatus.CREATED)
  public Receipt create(@Valid @RequestBody CreateReq r) {
    Ctx c = Ctx.current();
    c.require("fin.pay");
    return db.inClinic(() -> {
      // Trava os pagamentos: dois recibos simultâneos para o mesmo pagamento não passam.
      var rows = db.sql("""
          select pm.id, pm.amount_cents, pm.receipt_id, pm.canceled_at, d.patient_id
            from payments pm join debits d on d.id = pm.debit_id
           where pm.id = any(?::uuid[]) for update of pm""")
          .param("{" + String.join(",", r.paymentIds().stream().map(UUID::toString).toList()) + "}").query().listOfRows();
      if (rows.size() != new LinkedHashSet<>(r.paymentIds()).size()) throw ApiException.notFound("Pagamento");
      for (var p : rows) {
        if (p.get("canceled_at") != null) throw new ApiException(409, "PAYMENT_CANCELED", "Há pagamento cancelado na seleção.");
        if (p.get("receipt_id") != null) throw new ApiException(409, "ALREADY_RECEIPTED", "Algum pagamento selecionado já tem recibo.");
      }
      var patients = rows.stream().map(p -> p.get("patient_id")).collect(java.util.stream.Collectors.toSet());
      if (patients.size() > 1) throw ApiException.badRequest("MIXED", "Um recibo junta pagamentos de um paciente só.");
      UUID patientId = (UUID) patients.iterator().next();

      String payerName = r.payer() == null ? null : Text.blank(r.payer().name());
      String payerCpf = r.payer() == null ? null : Text.blank(r.payer().cpf());
      if (payerName == null && patientId != null) {
        var p = db.sql("select name, cpf from patients where id = ?").param(patientId).query().singleRow();
        payerName = (String) p.get("name");
        payerCpf = (String) p.get("cpf");
      }
      if (payerName == null) throw ApiException.badRequest("PAYER", "Informe em nome de quem é o recibo.");
      long total = rows.stream().mapToLong(p -> ((Number) p.get("amount_cents")).longValue()).sum();
      long number = db.sql("""
          insert into clinic_counters (clinic_id, name, value) values (?, 'receipt', 1)
          on conflict (clinic_id, name) do update set value = clinic_counters.value + 1 returning value""")
          .param(c.clinicId()).query(Long.class).single();
      String ids = "{" + String.join(",", r.paymentIds().stream().map(UUID::toString).toList()) + "}";
      UUID id = db.sql("""
          insert into receipts (clinic_id, number, patient_id, payer, total_cents, created_by, items)
          values (?, ?, ?, jsonb_build_object('name', ?::text, 'cpf', ?::text), ?, ?,
                  (select coalesce(jsonb_agg(jsonb_build_object('description', d.description, 'amount_cents', pm.amount_cents,
                                                                'method', pm.method, 'paid_at', pm.paid_at) order by pm.paid_at), '[]'::jsonb)
                     from payments pm join debits d on d.id = pm.debit_id where pm.id = any(?::uuid[])))
          returning id""")
          .params(c.clinicId(), number, patientId, payerName, payerCpf, total, c.userId(), ids).query(UUID.class).single();
      db.sql("update payments set receipt_id = ? where id = any(?::uuid[])")
          .params(id, "{" + String.join(",", r.paymentIds().stream().map(UUID::toString).toList()) + "}").update();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'receipt.issue', 'receipt', ?)")
          .params(c.clinicId(), c.userId(), id).update();
      return get(id);
    });
  }

  @PostMapping("/receipts/{id}/cancel")
  public Receipt cancel(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("fin.debits_delete");
    return db.inClinic(() -> {
      if (db.sql("update receipts set canceled_at = now() where id = ? and canceled_at is null").param(id).update() > 0) {
        db.sql("update payments set receipt_id = null where receipt_id = ?").param(id).update();
        db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'receipt.cancel', 'receipt', ?)")
            .params(c.clinicId(), c.userId(), id).update();
      }
      return get(id);
    });
  }

  @GetMapping("/receipts/{id}/pdf")
  public ResponseEntity<byte[]> pdf(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("fin.debits_view");
    return db.inClinic(() -> {
      Receipt r = get(id);
      // Itens = cópia feita na emissão (vale também para recibo cancelado).
      var items = db.sql("""
          select i->>'description' description, i->>'method' method
            from receipts r, jsonb_array_elements(r.items) i where r.id = ?""")
          .param(id).query().listOfRows();
      String num = String.format("%06d", r.number());
      StringBuilder b = new StringBuilder("<h1>Recibo</h1>");
      b.append("<p class='meta'>Nº ").append(num).append(r.canceledAt() != null ? " — CANCELADO" : "").append("</p>");
      b.append("<p style='text-align:right;font-size:14pt;margin:0 0 6pt'><b>Valor: ").append(PdfService.esc(money(r.totalCents()))).append("</b></p>");
      String methods = String.join(", ", items.stream().map(i -> METHOD.getOrDefault((String) i.get("method"), "outra forma")).distinct().toList());
      b.append("<p class='text'>Recebi(emos) de <b>").append(PdfService.esc(r.payerName())).append("</b>")
          .append(r.payerCpf() == null ? "" : ", " + docLabel(r.payerCpf()) + " " + PdfService.esc(r.payerCpf()))
          .append(", a importância de <b>").append(PdfService.esc(money(r.totalCents()))).append("</b> (")
          .append(PdfService.esc(Extenso.reais(r.totalCents()))).append(")")
          .append(items.isEmpty() ? "" : ", referente a " + PdfService.esc(String.join("; ", items.stream().map(i -> (String) i.get("description")).distinct().toList())))
          .append(methods.isEmpty() ? "" : ", pago em " + PdfService.esc(methods))
          .append(", dando plena quitação deste valor.</p>");
      if (r.patientName() != null && !r.patientName().equals(r.payerName())) {
        b.append("<p class='notes'>Paciente: ").append(PdfService.esc(r.patientName())).append("</p>");
      }
      if (r.canceledAt() != null) b.append("<p class='alerts'>Este recibo foi cancelado e não tem validade.</p>");
      byte[] bytes = pdf.render(c, null, "Recibo " + num, b.toString(), r.issuedAt(), false);
      return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
          .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"recibo-" + num + ".pdf\"")
          .header(HttpHeaders.CACHE_CONTROL, "no-store").body(bytes);
    });
  }

  private Receipt get(UUID id) {
    return db.sql(SELECT + " where r.id = ?").param(id).query(Receipt.class).optional().orElseThrow(() -> ApiException.notFound("Recibo"));
  }

  /** CPF (11 dígitos), CNPJ (14) ou "documento" quando não dá para saber. */
  static String docLabel(String doc) {
    int n = doc.replaceAll("[^0-9]", "").length();
    return n == 14 ? "CNPJ" : n == 11 ? "CPF" : "documento";
  }

  static String money(long cents) {
    return java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag("pt-BR")).format(cents / 100.0).replace(' ', ' ');
  }
}

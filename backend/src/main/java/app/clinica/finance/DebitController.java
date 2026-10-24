package app.clinica.finance;

import app.clinica.budget.BudgetController;
import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Débitos do paciente e recebimentos. O app só REGISTRA o dinheiro recebido; não processa pagamento. */
@RestController
@RequestMapping("/api")
public class DebitController {
  private final Db db;

  public DebitController(Db db) { this.db = db; }

  public record Debit(UUID id, String description, long amountCents, long paidCents, LocalDate dueDate,
                      Integer installmentNo, Integer installments, String status, UUID budgetId, boolean overdue) {}
  public record PaymentReq(@NotNull @Positive Long amountCents,
                           @NotNull @Pattern(regexp = "dinheiro|cheque|cartao_credito|cartao_debito|pix|transferencia|boleto|outro") String method,
                           @NotNull UUID financialAccountId,
                           OffsetDateTime paidAt) {}
  public record Payment(UUID id, UUID debitId, long amountCents, String method, OffsetDateTime paidAt, String accountName,
                        UUID receiptId, Long receiptNumber, String description) {}
  public record PaymentResult(Payment payment, Debit debit) {}

  @GetMapping("/patients/{patientId}/debits")
  public List<Debit> list(@PathVariable UUID patientId) {
    Ctx.current().require("fin.debits_view");
    return db.inClinic(() -> db.sql("""
        select id, description, amount_cents, paid_cents, due_date, installment_no, installments, status, budget_id,
               (status in ('open','partial') and due_date < current_date) overdue
          from debits where patient_id = ? and status <> 'canceled'
         order by due_date, installment_no nulls first""").param(patientId).query(Debit.class).list());
  }

  @GetMapping("/patients/{patientId}/payments")
  public List<Payment> payments(@PathVariable UUID patientId) {
    Ctx.current().require("fin.debits_view");
    return db.inClinic(() -> db.sql("""
        select p.id, p.debit_id, p.amount_cents, p.method, p.paid_at, a.name account_name,
               p.receipt_id, r.number receipt_number, d.description
          from payments p join debits d on d.id = p.debit_id join financial_accounts a on a.id = p.financial_account_id
          left join receipts r on r.id = p.receipt_id
         where d.patient_id = ? and p.canceled_at is null order by p.paid_at desc""").param(patientId).query(Payment.class).list());
  }

  /**
   * Recebimento total ou parcial. Idempotency-Key obrigatório: o mesmo envio repetido (duplo clique,
   * rede instável) devolve o pagamento já registrado em vez de criar outro.
   */
  @PostMapping("/debits/{id}/payments")
  @ResponseStatus(HttpStatus.CREATED)
  public PaymentResult pay(@PathVariable UUID id, @RequestHeader("Idempotency-Key") String key,
                           @Valid @RequestBody PaymentReq r) {
    Ctx c = Ctx.current();
    c.require("fin.pay");
    if (r.paidAt() != null && r.paidAt().isBefore(OffsetDateTime.now().minusHours(24))) c.require("fin.pay_backdated");
    if (key.isBlank() || key.length() > 100) throw ApiException.badRequest("IDEMPOTENCY_KEY", "Idempotency-Key inválida.");
    if (r.paidAt() != null && r.paidAt().isAfter(OffsetDateTime.now().plusMinutes(5))) {
      throw ApiException.badRequest("FUTURE_DATE", "A data do recebimento não pode ser no futuro.");
    }
    return db.inClinic(() -> {
      // Trava o débito ANTES de olhar a chave: um envio repetido simultâneo espera aqui e,
      // ao destravar, já enxerga o pagamento do primeiro (READ COMMITTED) e devolve o mesmo.
      var d = db.sql("select amount_cents, paid_cents, status from debits where id = ? for update").param(id)
          .query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Débito"));
      var existing = db.sql("select id, debit_id from payments where idempotency_key = ?").param(key).query().listOfRows();
      if (!existing.isEmpty()) {
        UUID pid = (UUID) existing.get(0).get("id");
        return new PaymentResult(payment(pid), debit((UUID) existing.get(0).get("debit_id")));
      }
      if ("paid".equals(d.get("status")) || "canceled".equals(d.get("status"))) {
        throw new ApiException(409, "DEBIT_CLOSED", "Este débito já está quitado ou cancelado.");
      }
      long remaining = ((Number) d.get("amount_cents")).longValue() - ((Number) d.get("paid_cents")).longValue();
      if (r.amountCents() > remaining) {
        throw new ApiException(422, "OVERPAYMENT", "O valor é maior que o saldo deste débito.");
      }
      // Recebimento em espécie entra no caixa aberto da conta, se houver.
      UUID cashSession = db.sql("""
          select s.id from cash_sessions s join financial_accounts a on a.id = s.financial_account_id
           where s.financial_account_id = ? and s.closed_at is null and a.kind = 'cash'""")
          .param(r.financialAccountId()).query(UUID.class).optional().orElse(null);
      UUID pid = db.sql("""
          insert into payments (clinic_id, debit_id, amount_cents, method, financial_account_id, cash_session_id, paid_at,
                                idempotency_key, created_by)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
          .params(c.clinicId(), id, r.amountCents(), r.method(), r.financialAccountId(), cashSession,
              r.paidAt() == null ? OffsetDateTime.now() : r.paidAt(), key, c.userId())
          .query(UUID.class).single();
      db.sql("""
          update debits set paid_cents = paid_cents + ?,
                 status = case when paid_cents + ? >= amount_cents then 'paid' else 'partial' end
           where id = ?""").params(r.amountCents(), r.amountCents(), id).update();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'payment.create', 'debit', ?)")
          .params(c.clinicId(), c.userId(), id).update();
      return new PaymentResult(payment(pid), debit(id));
    });
  }

  public record CreateReq(@NotNull @Size(min = 1, max = 200) String description, @NotNull @Positive Long amountCents,
                          @Min(1) @Max(60) Integer installments, @NotNull LocalDate firstDueDate, UUID categoryId) {}

  /**
   * Débito avulso (fora de orçamento): manutenção, consulta de urgência, material. Parcelado em meses,
   * com o resto da divisão na 1ª parcela — a soma é sempre o valor informado.
   */
  @PostMapping("/patients/{patientId}/debits")
  @ResponseStatus(HttpStatus.CREATED)
  public List<Debit> create(@PathVariable UUID patientId, @Valid @RequestBody CreateReq r) {
    Ctx c = Ctx.current();
    c.require("fin.debits_create");
    int n = r.installments() == null ? 1 : r.installments();
    if (r.amountCents() < n) throw ApiException.badRequest("AMOUNT", "Valor pequeno demais para " + n + " parcelas.");
    return db.inClinic(() -> {
      if (db.sql("select count(*) from patients where id = ? and deleted_at is null").param(patientId).query(Long.class).single() == 0) {
        throw ApiException.notFound("Paciente");
      }
      if (r.categoryId() != null && !"income".equals(db.sql("select kind from categories where id = ?").param(r.categoryId())
          .query(String.class).optional().orElse(null))) {
        throw ApiException.badRequest("CATEGORY", "Escolha uma categoria de receita.");
      }
      long[] parts = BudgetController.split(r.amountCents(), n);
      String desc = r.description().trim();
      List<UUID> ids = new java.util.ArrayList<>();
      for (int k = 0; k < n; k++) {
        ids.add(db.sql("""
            insert into debits (clinic_id, patient_id, description, amount_cents, due_date, installment_no, installments,
                                category_id, created_by)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
            .params(c.clinicId(), patientId, n == 1 ? desc : desc + " — parcela " + (k + 1) + "/" + n, parts[k],
                r.firstDueDate().plusMonths(k), n == 1 ? null : k + 1, n == 1 ? null : n, r.categoryId(), c.userId())
            .query(UUID.class).single());
      }
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'debit.create', 'patient', ?)")
          .params(c.clinicId(), c.userId(), patientId).update();
      return ids.stream().map(this::debit).toList();
    });
  }

  /** Cancela débito sem recebimento. Com dinheiro recebido, o caminho é cancelar o recebimento antes. */
  @PostMapping("/debits/{id}/cancel")
  public Debit cancel(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("fin.debits_delete");
    return db.inClinic(() -> {
      var d = db.sql("select paid_cents, status from debits where id = ? for update").param(id).query().listOfRows()
          .stream().findFirst().orElseThrow(() -> ApiException.notFound("Débito"));
      if ("canceled".equals(d.get("status"))) return debit(id);
      if (((Number) d.get("paid_cents")).longValue() > 0) {
        throw new ApiException(409, "DEBIT_HAS_PAYMENTS", "Este débito já tem recebimento. Cancele o recebimento antes.");
      }
      db.sql("update debits set status = 'canceled' where id = ?").param(id).update();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'debit.cancel', 'debit', ?)")
          .params(c.clinicId(), c.userId(), id).update();
      return debit(id);
    });
  }

  /**
   * Cancela um recebimento lançado errado: o valor volta a ficar em aberto no débito. O registro fica
   * (com canceled_at) para a auditoria. Recebimento com recibo válido exige cancelar o recibo antes.
   */
  @PostMapping("/payments/{id}/cancel")
  public Debit cancelPayment(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("fin.debits_delete");
    return db.inClinic(() -> {
      var p = db.sql("select debit_id, amount_cents, receipt_id, canceled_at from payments where id = ?").param(id)
          .query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Recebimento"));
      UUID debitId = (UUID) p.get("debit_id");
      // Mesma ordem de trava do recebimento (débito primeiro): sem deadlock com um pagamento simultâneo.
      db.sql("select id from debits where id = ? for update").param(debitId).query().listOfRows();
      var cur = db.sql("select receipt_id, canceled_at from payments where id = ? for update").param(id).query().singleRow();
      if (cur.get("canceled_at") != null) return debit(debitId);
      if (cur.get("receipt_id") != null) {
        throw new ApiException(409, "HAS_RECEIPT", "Este recebimento tem recibo emitido. Cancele o recibo antes.");
      }
      long amount = ((Number) p.get("amount_cents")).longValue();
      db.sql("update payments set canceled_at = now() where id = ?").param(id).update();
      db.sql("""
          update debits set paid_cents = paid_cents - ?,
                 status = case when paid_cents - ? = 0 then 'open' else 'partial' end
           where id = ?""").params(amount, amount, debitId).update();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id, diff) values (?, ?, 'payment.cancel', 'debit', ?, jsonb_build_object('payment_id', ?::text, 'amount_cents', ?))")
          .params(c.clinicId(), c.userId(), debitId, id.toString(), amount).update();
      return debit(debitId);
    });
  }

  private Debit debit(UUID id) {
    return db.sql("""
        select id, description, amount_cents, paid_cents, due_date, installment_no, installments, status, budget_id,
               (status in ('open','partial') and due_date < current_date) overdue
          from debits where id = ?""").param(id).query(Debit.class).single();
  }

  private Payment payment(UUID id) {
    return db.sql("""
        select p.id, p.debit_id, p.amount_cents, p.method, p.paid_at, a.name account_name,
               p.receipt_id, r.number receipt_number, d.description
          from payments p join financial_accounts a on a.id = p.financial_account_id join debits d on d.id = p.debit_id
          left join receipts r on r.id = p.receipt_id where p.id = ?""")
        .param(id).query(Payment.class).single();
  }
}

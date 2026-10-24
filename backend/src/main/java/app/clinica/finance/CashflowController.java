package app.clinica.finance;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Fluxo de caixa: receitas (débitos de paciente), receitas sem vínculo (sem paciente) e despesas.
 * Linhas pelo vencimento no período; totais "recebido/pago" pelo dia em que o dinheiro entrou/saiu
 * (no fuso da clínica). Saldo = recebido − pago.
 */
@RestController
@RequestMapping("/api")
public class CashflowController {
  private static final String METHODS = "dinheiro|cheque|cartao_credito|cartao_debito|pix|transferencia|boleto|outro";
  private final Db db;

  public CashflowController(Db db) { this.db = db; }

  public record Row(String type, UUID id, String description, UUID patientId, String patientName, long amountCents,
                    long paidCents, LocalDate dueDate, OffsetDateTime paidAt, String status, UUID categoryId,
                    String categoryName, String accountName, String method) {}
  public record Totals(long receivedCents, long toReceiveCents, long overdueReceivableCents, long paidCents,
                       long toPayCents, long overduePayableCents, long balanceCents) {}
  public record Cashflow(LocalDate from, LocalDate to, Totals totals, List<Row> rows) {}

  public record ExpenseReq(@NotBlank @Size(max = 200) String description, @NotNull @Positive Long amountCents,
                           @NotNull LocalDate dueDate, UUID categoryId, UUID financialAccountId,
                           @Pattern(regexp = METHODS) String method, Boolean paid, OffsetDateTime paidAt) {}
  public record PayReq(@NotNull UUID financialAccountId, @NotNull @Pattern(regexp = METHODS) String method, OffsetDateTime paidAt) {}
  public record IncomeReq(@NotBlank @Size(max = 200) String description, @NotNull @Positive Long amountCents,
                          @NotNull LocalDate dueDate, UUID categoryId) {}

  @GetMapping("/cashflow")
  public Cashflow cashflow(@RequestParam LocalDate from, @RequestParam LocalDate to) {
    Ctx c = Ctx.current();
    boolean incomes = c.can("fin.debits_view"), expenses = c.can("fin.expenses_view");
    if (!incomes && !expenses) c.require("fin.debits_view");
    if (to.isBefore(from) || ChronoUnit.DAYS.between(from, to) > 400) throw ApiException.badRequest("RANGE", "Período inválido (até 13 meses).");
    return db.inClinic(() -> {
      String tz = db.sql("select timezone from clinics where id = app_clinic_id()").query(String.class).single();
      // Quem vê só receitas não recebe linhas de despesa (e vice-versa).
      List<Row> rows = db.sql("""
          select * from (
            select case when d.patient_id is null then 'receita_sem_vinculo' else 'receita' end type, d.id, d.description,
                   d.patient_id, p.name patient_name, d.amount_cents, d.paid_cents, d.due_date,
                   (select max(pm.paid_at) from payments pm where pm.debit_id = d.id and pm.canceled_at is null) paid_at,
                   case when d.status = 'paid' then 'pago'
                        when d.due_date < (now() at time zone ?)::date then 'atrasado'
                        when d.status = 'partial' then 'parcial' else 'a_vencer' end status,
                   d.category_id, cat.name category_name,
                   (select string_agg(distinct a.name, ', ') from payments pm join financial_accounts a on a.id = pm.financial_account_id
                     where pm.debit_id = d.id and pm.canceled_at is null) account_name,
                   (select string_agg(distinct pm.method, ', ') from payments pm where pm.debit_id = d.id and pm.canceled_at is null) method
              from debits d left join patients p on p.id = d.patient_id left join categories cat on cat.id = d.category_id
             where ? and d.status <> 'canceled' and d.due_date between ? and ?
            union all
            select 'despesa', e.id, e.description, null, null, e.amount_cents,
                   case when e.paid_at is null then 0 else e.amount_cents end, e.due_date, e.paid_at,
                   case when e.paid_at is not null then 'pago' when e.due_date < (now() at time zone ?)::date then 'atrasado' else 'a_vencer' end,
                   e.category_id, cat.name, a.name, e.method
              from expenses e left join categories cat on cat.id = e.category_id left join financial_accounts a on a.id = e.financial_account_id
             where ? and e.due_date between ? and ?
          ) x order by due_date, type, description""")
          .params(tz, incomes, from, to, tz, expenses, from, to).query(Row.class).list();
      var t = db.sql("""
          select
            coalesce((select sum(pm.amount_cents) from payments pm
                       where ? and pm.canceled_at is null and (pm.paid_at at time zone ?)::date between ? and ?), 0) received,
            coalesce((select sum(d.amount_cents - d.paid_cents) from debits d
                       where ? and d.status in ('open','partial') and d.due_date between ? and ?), 0) to_receive,
            coalesce((select sum(d.amount_cents - d.paid_cents) from debits d
                       where ? and d.status in ('open','partial') and d.due_date < (now() at time zone ?)::date), 0) overdue_rec,
            coalesce((select sum(e.amount_cents) from expenses e
                       where ? and e.paid_at is not null and (e.paid_at at time zone ?)::date between ? and ?), 0) paid,
            coalesce((select sum(e.amount_cents) from expenses e
                       where ? and e.paid_at is null and e.due_date between ? and ?), 0) to_pay,
            coalesce((select sum(e.amount_cents) from expenses e
                       where ? and e.paid_at is null and e.due_date < (now() at time zone ?)::date), 0) overdue_pay""")
          .params(incomes, tz, from, to, incomes, from, to, incomes, tz, expenses, tz, from, to, expenses, from, to, expenses, tz)
          .query().singleRow();
      long rec = ((Number) t.get("received")).longValue(), paid = ((Number) t.get("paid")).longValue();
      return new Cashflow(from, to, new Totals(rec, ((Number) t.get("to_receive")).longValue(), ((Number) t.get("overdue_rec")).longValue(),
          paid, ((Number) t.get("to_pay")).longValue(), ((Number) t.get("overdue_pay")).longValue(), rec - paid), rows);
    });
  }

  // ---------------- despesas ----------------

  @PostMapping("/expenses")
  @ResponseStatus(HttpStatus.CREATED)
  public Row createExpense(@Valid @RequestBody ExpenseReq r) {
    Ctx c = Ctx.current();
    c.require("fin.expenses_edit");
    boolean paid = Boolean.TRUE.equals(r.paid());
    if (paid && (r.financialAccountId() == null || r.method() == null)) {
      throw ApiException.badRequest("ACCOUNT", "Para lançar já paga, informe a conta e a forma de pagamento.");
    }
    if (paid && r.paidAt() != null && r.paidAt().isBefore(OffsetDateTime.now().minusHours(24))) c.require("fin.pay_backdated");
    return db.inClinic(() -> {
      checkCategory(r.categoryId(), "expense");
      UUID id = db.sql("""
          insert into expenses (clinic_id, description, amount_cents, due_date, category_id, method, financial_account_id, paid_at, created_by)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
          .params(c.clinicId(), r.description().trim(), r.amountCents(), r.dueDate(), r.categoryId(), r.method(), r.financialAccountId(),
              paid ? (r.paidAt() != null ? r.paidAt() : OffsetDateTime.now()) : null, c.userId())
          .query(UUID.class).single();
      audit(c, "expense.create", id);
      return expense(id);
    });
  }

  @PatchMapping("/expenses/{id}")
  public Row updateExpense(@PathVariable UUID id, @Valid @RequestBody ExpenseReq r) {
    Ctx c = Ctx.current();
    c.require("fin.expenses_edit");
    return db.inClinic(() -> {
      checkCategory(r.categoryId(), "expense");
      int n = db.sql("""
          update expenses set description = ?, amount_cents = ?, due_date = ?, category_id = ?,
                 financial_account_id = coalesce(?, financial_account_id), method = coalesce(?, method)
           where id = ?""")
          .params(r.description().trim(), r.amountCents(), r.dueDate(), r.categoryId(), r.financialAccountId(), r.method(), id).update();
      if (n == 0) throw ApiException.notFound("Despesa");
      audit(c, "expense.update", id);
      return expense(id);
    });
  }

  @PostMapping("/expenses/{id}/pay")
  public Row payExpense(@PathVariable UUID id, @Valid @RequestBody PayReq r) {
    Ctx c = Ctx.current();
    c.require("fin.expenses_edit");
    if (r.paidAt() != null && r.paidAt().isAfter(OffsetDateTime.now().plusMinutes(5))) throw ApiException.badRequest("FUTURE_DATE", "A data do pagamento não pode ser no futuro.");
    if (r.paidAt() != null && r.paidAt().isBefore(OffsetDateTime.now().minusHours(24))) c.require("fin.pay_backdated");
    return db.inClinic(() -> {
      // "and paid_at is null": pagar duas vezes (duplo clique) não muda nada.
      int n = db.sql("update expenses set paid_at = coalesce(?, now()), financial_account_id = ?, method = ? where id = ? and paid_at is null")
          .params(r.paidAt(), r.financialAccountId(), r.method(), id).update();
      if (n == 0 && db.sql("select count(*) from expenses where id = ?").param(id).query(Long.class).single() == 0) throw ApiException.notFound("Despesa");
      if (n > 0) audit(c, "expense.pay", id);
      return expense(id);
    });
  }

  /** Desfaz o pagamento lançado por engano (fica no histórico). */
  @PostMapping("/expenses/{id}/unpay")
  public Row unpayExpense(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("fin.expenses_edit");
    return db.inClinic(() -> {
      if (db.sql("update expenses set paid_at = null where id = ? and paid_at is not null").param(id).update() > 0) audit(c, "expense.unpay", id);
      return expense(id);
    });
  }

  @DeleteMapping("/expenses/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteExpense(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("fin.expenses_edit");
    db.inClinic(() -> {
      var e = db.sql("select description, amount_cents, paid_at from expenses where id = ?").param(id).query().listOfRows()
          .stream().findFirst().orElseThrow(() -> ApiException.notFound("Despesa"));
      if (e.get("paid_at") != null) throw new ApiException(409, "EXPENSE_PAID", "Desfaça o pagamento antes de excluir a despesa.");
      db.sql("delete from expenses where id = ?").param(id).update();
      db.sql("""
          insert into audit_log (clinic_id, user_id, action, entity, entity_id, diff)
          values (?, ?, 'expense.delete', 'expense', ?, jsonb_build_object('description', ?::text, 'amount_cents', ?::bigint))""")
          .params(c.clinicId(), c.userId(), id, e.get("description"), e.get("amount_cents")).update();
    });
  }

  // ---------------- receita sem vínculo ----------------

  /** Receita sem paciente (ex.: aluguel de sala, venda de produto). Recebe-se pelo mesmo fluxo de pagamento dos débitos. */
  @PostMapping("/income")
  @ResponseStatus(HttpStatus.CREATED)
  public Row createIncome(@Valid @RequestBody IncomeReq r) {
    Ctx c = Ctx.current();
    c.require("fin.debits_create");
    return db.inClinic(() -> {
      checkCategory(r.categoryId(), "income");
      UUID id = db.sql("""
          insert into debits (clinic_id, patient_id, description, amount_cents, due_date, category_id, created_by)
          values (?, null, ?, ?, ?, ?, ?) returning id""")
          .params(c.clinicId(), r.description().trim(), r.amountCents(), r.dueDate(), r.categoryId(), c.userId())
          .query(UUID.class).single();
      audit(c, "income.create", id);
      return cashflow(r.dueDate(), r.dueDate()).rows().stream().filter(x -> x.id().equals(id)).findFirst().orElseThrow();
    });
  }

  private Row expense(UUID id) {
    return db.sql("""
        select 'despesa' type, e.id, e.description, null::uuid patient_id, null patient_name, e.amount_cents,
               case when e.paid_at is null then 0 else e.amount_cents end paid_cents, e.due_date, e.paid_at,
               case when e.paid_at is not null then 'pago'
                    when e.due_date < (now() at time zone (select timezone from clinics where id = app_clinic_id()))::date then 'atrasado'
                    else 'a_vencer' end status,
               e.category_id, cat.name category_name, a.name account_name, e.method
          from expenses e left join categories cat on cat.id = e.category_id left join financial_accounts a on a.id = e.financial_account_id
         where e.id = ?""").param(id).query(Row.class).optional().orElseThrow(() -> ApiException.notFound("Despesa"));
  }

  private void checkCategory(UUID categoryId, String kind) {
    if (categoryId == null) return;
    String k = db.sql("select kind from categories where id = ?").param(categoryId).query(String.class).optional()
        .orElseThrow(() -> ApiException.badRequest("CATEGORY", "Categoria não encontrada."));
    if (!k.equals(kind)) throw ApiException.badRequest("CATEGORY", kind.equals("expense") ? "Escolha uma categoria de despesa." : "Escolha uma categoria de receita.");
  }

  private void audit(Ctx c, String action, UUID id) {
    db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, ?, ?, ?)")
        .params(c.clinicId(), c.userId(), action, action.startsWith("expense") ? "expense" : "debit", id).update();
  }

  static String blank(String s) { return Text.blank(s); }
}

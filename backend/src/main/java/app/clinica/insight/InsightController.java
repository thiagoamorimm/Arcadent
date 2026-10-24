package app.clinica.insight;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Inteligência (S25). Desempenho do período (com o período anterior de mesmo tamanho para comparar)
 * e o painel do dia (aniversariantes, inadimplência, tratamentos sem consulta marcada).
 * Datas sempre no fuso da clínica.
 */
@RestController
@RequestMapping("/api/insights")
public class InsightController {
  private final Db db;

  public InsightController(Db db) { this.db = db; }

  public record Numbers(long appointments, long attended, long noShows, long canceled, long newPatients,
                        long budgetsCreated, long budgetsCreatedCents, long budgetsApproved, long budgetsApprovedCents,
                        long receivedCents, long paidCents) {}
  public record Month(String month, long receivedCents, long paidCents) {}
  public record Performance(LocalDate from, LocalDate to, Numbers current, Numbers previous, List<Month> months,
                            List<Map<String, Object>> byProfessional) {}
  public record Birthday(UUID id, String name, String phone, LocalDate birthDate, int day, int turns, boolean today) {}
  public record Debtor(UUID id, String name, String phone, long overdueCents, LocalDate oldestDue, int daysLate) {}
  public record NoVisit(UUID id, String name, String phone, long openTreatments, java.time.OffsetDateTime lastVisit) {}
  public record Tasks(List<Birthday> birthdays, List<Debtor> debtors, List<NoVisit> withoutAppointment) {}

  @GetMapping("/performance")
  public Performance performance(@RequestParam LocalDate from, @RequestParam LocalDate to) {
    Ctx.current().require("insight.performance");
    if (to.isBefore(from)) throw ApiException.badRequest("PERIOD", "O fim do período vem antes do início.");
    if (ChronoUnit.DAYS.between(from, to) > 400) throw ApiException.badRequest("PERIOD", "Escolha um período de até 1 ano.");
    long days = ChronoUnit.DAYS.between(from, to) + 1;
    LocalDate pFrom = from.minusDays(days), pTo = from.minusDays(1);
    return db.inClinic(() -> {
      String tz = db.sql("select timezone from clinics where id = app_clinic_id()").query(String.class).single();
      var months = db.sql("""
          with m as (select generate_series(date_trunc('month', ?::date), date_trunc('month', ?::date), interval '1 month')::date m)
          select to_char(m.m, 'YYYY-MM') as month,
                 coalesce((select sum(pm.amount_cents) from payments pm where pm.canceled_at is null
                            and date_trunc('month', pm.paid_at at time zone ?)::date = m.m), 0) received_cents,
                 coalesce((select sum(e.amount_cents) from expenses e where e.paid_at is not null
                            and date_trunc('month', e.paid_at at time zone ?)::date = m.m), 0) paid_cents
            from m order by m.m""")
          .params(to.minusMonths(5), to, tz, tz).query(Month.class).list();
      var byPro = db.sql("""
          select u.name professional, count(*) filter (where a.status = 'atendido') attended,
                 count(*) filter (where a.status = 'faltou') no_shows,
                 coalesce((select sum(t.price_cents) from treatments t where t.professional_id = m.id and t.status = 'done'
                            and (t.done_at at time zone ?)::date between ? and ?), 0) produced_cents
            from memberships m join users u on u.id = m.user_id
            left join appointments a on a.professional_id = m.id and a.kind = 'consulta'
                 and (a.start_at at time zone ?)::date between ? and ?
           where m.does_attend and m.is_active
           group by m.id, u.name order by u.name""")
          .params(tz, from, to, tz, from, to).query().listOfRows();
      return new Performance(from, to, numbers(tz, from, to), numbers(tz, pFrom, pTo), months, byPro);
    });
  }

  private Numbers numbers(String tz, LocalDate from, LocalDate to) {
    return db.sql("""
        select
          count(*) filter (where a.kind = 'consulta') appointments,
          count(*) filter (where a.kind = 'consulta' and a.status = 'atendido') attended,
          count(*) filter (where a.kind = 'consulta' and a.status = 'faltou') no_shows,
          count(*) filter (where a.kind = 'consulta' and a.status = 'cancelado') canceled,
          (select count(*) from patients p where p.deleted_at is null and (p.created_at at time zone ?)::date between ? and ?) new_patients,
          (select count(*) from budgets b where (b.created_at at time zone ?)::date between ? and ?) budgets_created,
          (select coalesce(sum(i.price_cents), 0) from budgets b join budget_items i on i.budget_id = b.id
            where (b.created_at at time zone ?)::date between ? and ?) budgets_created_cents,
          (select count(*) from budgets b where b.status in ('approved','partial') and (b.approved_at at time zone ?)::date between ? and ?) budgets_approved,
          (select coalesce(sum(b.total_cents), 0) from budgets b where b.status in ('approved','partial')
            and (b.approved_at at time zone ?)::date between ? and ?) budgets_approved_cents,
          (select coalesce(sum(pm.amount_cents), 0) from payments pm where pm.canceled_at is null
            and (pm.paid_at at time zone ?)::date between ? and ?) received_cents,
          (select coalesce(sum(e.amount_cents), 0) from expenses e where e.paid_at is not null
            and (e.paid_at at time zone ?)::date between ? and ?) paid_cents
        from appointments a where (a.start_at at time zone ?)::date between ? and ?""")
        .params(tz, from, to, tz, from, to, tz, from, to, tz, from, to, tz, from, to, tz, from, to, tz, from, to, tz, from, to)
        .query(Numbers.class).single();
  }

  /** Painel do dia: o que pede uma ação da recepção hoje. */
  @GetMapping("/tasks")
  public Tasks tasks() {
    Ctx.current().require("insight.tasks");
    return db.inClinic(() -> {
      String tz = db.sql("select timezone from clinics where id = app_clinic_id()").query(String.class).single();
      var birthdays = db.sql("""
          with hoje as (select (now() at time zone ?)::date d)
          select p.id, p.name, p.phone, p.birth_date, extract(day from p.birth_date)::int as day,
                 (extract(year from hoje.d) - extract(year from p.birth_date))::int turns,
                 (extract(day from p.birth_date) = extract(day from hoje.d)) today
            from patients p, hoje
           where p.deleted_at is null and p.birth_date is not null
             and extract(month from p.birth_date) = extract(month from hoje.d)
           order by extract(day from p.birth_date), p.name""").param(tz).query(Birthday.class).list();
      var debtors = db.sql("""
          with hoje as (select (now() at time zone ?)::date d)
          select p.id, p.name, p.phone, sum(d.amount_cents - d.paid_cents) overdue_cents, min(d.due_date) oldest_due,
                 (hoje.d - min(d.due_date))::int days_late
            from debits d join patients p on p.id = d.patient_id, hoje
           where d.status in ('open','partial') and d.due_date < hoje.d and p.deleted_at is null
           group by p.id, p.name, p.phone, hoje.d order by overdue_cents desc limit 100""").param(tz).query(Debtor.class).list();
      var noVisit = db.sql("""
          select p.id, p.name, p.phone, count(t.id) open_treatments,
                 (select max(a.start_at) from appointments a where a.patient_id = p.id and a.status = 'atendido') last_visit
            from patients p join treatments t on t.patient_id = p.id and t.status = 'open'
           where p.deleted_at is null
             and not exists (select 1 from appointments a where a.patient_id = p.id and a.start_at >= now()
                              and a.status not in ('cancelado','faltou'))
           group by p.id, p.name, p.phone order by last_visit nulls first limit 100""").query(NoVisit.class).list();
      return new Tasks(birthdays, debtors, noVisit);
    });
  }
}

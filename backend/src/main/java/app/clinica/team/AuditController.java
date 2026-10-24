package app.clinica.team;

import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Trilha de auditoria (quem fez o quê, quando, e quem abriu cada ficha). Só leitura — a role da
 * aplicação não consegue alterar nem apagar o audit_log. Restrita a quem gerencia a equipe.
 */
@RestController
@RequestMapping("/api")
public class AuditController {
  private static final int PAGE = 100;
  private final Db db;

  public AuditController(Db db) { this.db = db; }

  public record Entry(long id, OffsetDateTime at, String action, String entity, UUID entityId, UUID userId, String userName,
                      String label, UUID patientId, String patientName, String diff) {}
  public record Page(List<Entry> items, Long nextBefore) {}

  /** De qual paciente é cada evento (para filtrar por ficha e oferecer o link). */
  private static final String PATIENT = """
      case l.entity
        when 'patient' then l.entity_id
        when 'debit' then (select patient_id from debits where id = l.entity_id)
        when 'evolution' then (select patient_id from evolutions where id = l.entity_id)
        when 'treatment' then (select patient_id from treatments where id = l.entity_id)
        when 'receipt' then (select patient_id from receipts where id = l.entity_id)
        when 'document' then (select patient_id from documents where id = l.entity_id)
        when 'anamnesis' then (select patient_id from anamneses where id = l.entity_id)
        when 'patient_file' then (select patient_id from patient_files where id = l.entity_id)
        when 'budget' then (select patient_id from budgets where id = l.entity_id)
        when 'appointment' then (select patient_id from appointments where id = l.entity_id)
      end
      """;

  /** Texto curto do "sobre o quê" (o nome do paciente vem pelo patient_id). */
  private static final String LABEL = """
      case l.entity
        when 'debit' then (select description from debits where id = l.entity_id)
        when 'treatment' then (select pr.name || coalesce(' · dente ' || t.tooth, '') from treatments t
                                 join procedures pr on pr.id = t.procedure_id where t.id = l.entity_id)
        when 'receipt' then (select 'Recibo nº ' || number from receipts where id = l.entity_id)
        when 'expense' then (select description from expenses where id = l.entity_id)
        when 'patient_file' then (select file_name from patient_files where id = l.entity_id)
        when 'budget' then (select 'Orçamento nº ' || number from budgets where id = l.entity_id)
        when 'document' then (select case kind when 'prescription' then 'Receita' when 'certificate' then 'Atestado' else 'Documento' end
                                from documents where id = l.entity_id)
        when 'invitation' then (select email from invitations where id = l.entity_id)
        when 'membership' then (select u.name from memberships m join users u on u.id = m.user_id where m.id = l.entity_id)
      end
      """;

  @GetMapping("/audit")
  public Page list(@RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
                   @RequestParam(required = false) UUID userId, @RequestParam(required = false) String action,
                   @RequestParam(required = false) UUID patientId, @RequestParam(required = false) Long before) {
    Ctx.current().require("config.team");
    String act = action == null || action.isBlank() ? null : action.endsWith(".") ? action.replace("%", "") + "%" : action;
    return db.inClinic(() -> {
      String tz = db.sql("select timezone from clinics where id = app_clinic_id()").query(String.class).single();
      List<Entry> rows = db.sql("""
          select x.*, p.name patient_name from (
            select l.id, l.at, l.action, l.entity, l.entity_id, l.user_id, u.name user_name, l.diff::text diff,
                   """ + LABEL + """
           label,
                   """ + PATIENT + """
           patient_id
              from audit_log l left join users u on u.id = l.user_id
             where (?::date is null or (l.at at time zone ?)::date >= ?)
               and (?::date is null or (l.at at time zone ?)::date <= ?)
               and (?::uuid is null or l.user_id = ?)
               and (?::text is null or l.action like ?)
               and (?::bigint is null or l.id < ?)
          ) x left join patients p on p.id = x.patient_id
           where (?::uuid is null or x.patient_id = ?)
          order by x.id desc limit ?""")
          .params(from, tz, from, to, tz, to, userId, userId, act, act, before, before, patientId, patientId, PAGE + 1)
          .query((rs, n) -> new Entry(rs.getLong("id"), rs.getObject("at", OffsetDateTime.class), rs.getString("action"),
              rs.getString("entity"), (UUID) rs.getObject("entity_id"), (UUID) rs.getObject("user_id"), rs.getString("user_name"),
              rs.getString("label"), (UUID) rs.getObject("patient_id"), rs.getString("patient_name"), rs.getString("diff")))
          .list();
      boolean more = rows.size() > PAGE;
      List<Entry> items = more ? rows.subList(0, PAGE) : rows;
      return new Page(items, more ? items.get(items.size() - 1).id() : null);
    });
  }
}

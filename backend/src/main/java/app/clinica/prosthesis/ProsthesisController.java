package app.clinica.prosthesis;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Controle de prótese (S27): pedido ao laboratório que anda por 5 etapas (pré-laboratório, envio,
 * laboratório, prova/agenda, realizado). Cada etapa pode ter prazo; prazo vencido = atrasado.
 * Cada mudança de etapa fica no histórico do pedido.
 */
@RestController
@RequestMapping("/api/prosthesis")
public class ProsthesisController {
  static final List<String> STAGES = List.of("pre_lab", "envio", "laboratorio", "prova", "realizado");
  private final Db db;

  public ProsthesisController(Db db) { this.db = db; }

  public record Order(UUID id, UUID patientId, String patientName, UUID treatmentId, UUID professionalId, String professionalName,
                      String description, String laboratory, String stage, LocalDate dueDate, Long costCents, String notes,
                      boolean late, int daysInStage, OffsetDateTime createdAt, OffsetDateTime stageAt) {}
  public record OrderReq(@NotNull UUID patientId, UUID treatmentId, UUID professionalId,
                         @NotBlank @Size(max = 200) String description, @Size(max = 120) String laboratory,
                         LocalDate dueDate, @PositiveOrZero Long costCents, @Size(max = 2000) String notes) {}
  public record StageReq(@NotNull @Pattern(regexp = "pre_lab|envio|laboratorio|prova|realizado") String stage,
                         LocalDate dueDate, @Size(max = 300) String note) {}
  public record Event(String stage, String note, String userName, OffsetDateTime at) {}

  private static final String SELECT = """
      select o.id, o.patient_id, p.name patient_name, o.treatment_id, o.professional_id, u.name professional_name,
             o.description, o.laboratory, o.stage, o.due_date, o.cost_cents, o.notes,
             coalesce(o.stage <> 'realizado' and o.due_date < (now() at time zone c.timezone)::date, false) late,
             coalesce(greatest(0, ((now() at time zone c.timezone)::date - (st.at at time zone c.timezone)::date)), 0)::int days_in_stage,
             o.created_at, st.at stage_at
        from prosthesis_orders o
        join clinics c on c.id = o.clinic_id
        join patients p on p.id = o.patient_id
        left join memberships m on m.id = o.professional_id left join users u on u.id = m.user_id
        left join lateral (select max(e.at) at from prosthesis_events e where e.order_id = o.id and e.stage = o.stage) st on true
      """;

  /** Quadro: tudo em andamento + realizados dos últimos 30 dias. */
  @GetMapping
  public List<Order> board() {
    Ctx.current().require("prosthesis.manage");
    return db.inClinic(() -> db.sql(SELECT + """
         where o.canceled_at is null and (o.stage <> 'realizado' or o.updated_at > now() - interval '30 days')
         order by o.due_date nulls last, o.created_at""").query(Order.class).list());
  }

  @GetMapping("/laboratories")
  public List<String> laboratories() {
    Ctx.current().require("prosthesis.manage");
    return db.inClinic(() -> db.sql("""
        select laboratory from prosthesis_orders where laboratory is not null
         group by laboratory order by count(*) desc, laboratory limit 30""").query(String.class).list());
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Order create(@Valid @RequestBody OrderReq r) {
    Ctx c = Ctx.current();
    c.require("prosthesis.manage");
    return db.inClinic(() -> {
      if (r.treatmentId() != null && !db.sql("select exists(select 1 from treatments where id = ? and patient_id = ?)")
          .params(r.treatmentId(), r.patientId()).query(Boolean.class).single()) {
        throw ApiException.badRequest("TREATMENT", "Esse tratamento não é deste paciente.");
      }
      UUID id = db.sql("""
          insert into prosthesis_orders (clinic_id, patient_id, treatment_id, professional_id, description, laboratory,
                                         due_date, cost_cents, notes, created_by)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""")
          .params(c.clinicId(), r.patientId(), r.treatmentId(), r.professionalId(), r.description().trim(), Text.blank(r.laboratory()),
              r.dueDate(), r.costCents(), Text.blank(r.notes()), c.userId())
          .query(UUID.class).single();
      event(c, id, "pre_lab", "Pedido criado");
      return get(id);
    });
  }

  @PatchMapping("/{id}")
  public Order update(@PathVariable UUID id, @Valid @RequestBody OrderReq r) {
    Ctx.current().require("prosthesis.manage");
    return db.inClinic(() -> {
      int n = db.sql("""
          update prosthesis_orders set description = ?, laboratory = ?, due_date = ?, cost_cents = ?, notes = ?, professional_id = ?
           where id = ? and canceled_at is null""")
          .params(r.description().trim(), Text.blank(r.laboratory()), r.dueDate(), r.costCents(), Text.blank(r.notes()),
              r.professionalId(), id).update();
      if (n == 0) throw ApiException.notFound("Pedido de prótese");
      return get(id);
    });
  }

  /** Muda de etapa (para frente ou para trás, ex.: prova não deu certo, volta ao laboratório). */
  @PostMapping("/{id}/stage")
  public Order stage(@PathVariable UUID id, @Valid @RequestBody StageReq r) {
    Ctx c = Ctx.current();
    c.require("prosthesis.manage");
    return db.inClinic(() -> {
      String cur = db.sql("select stage from prosthesis_orders where id = ? and canceled_at is null for update").param(id)
          .query(String.class).optional().orElseThrow(() -> ApiException.notFound("Pedido de prótese"));
      if (cur.equals(r.stage())) return get(id);
      db.sql("update prosthesis_orders set stage = ?, due_date = ? where id = ?")
          .params(r.stage(), r.stage().equals("realizado") ? null : r.dueDate(), id).update();
      event(c, id, r.stage(), Text.blank(r.note()));
      return get(id);
    });
  }

  @PostMapping("/{id}/cancel")
  public Order cancel(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("prosthesis.manage");
    return db.inClinic(() -> {
      if (db.sql("update prosthesis_orders set canceled_at = now() where id = ? and canceled_at is null").param(id).update() == 0) {
        throw ApiException.notFound("Pedido de prótese");
      }
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'prosthesis.cancel', 'prosthesis', ?)")
          .params(c.clinicId(), c.userId(), id).update();
      return db.sql(SELECT + " where o.id = ?").param(id).query(Order.class).single();
    });
  }

  @GetMapping("/{id}/events")
  public List<Event> events(@PathVariable UUID id) {
    Ctx.current().require("prosthesis.manage");
    return db.inClinic(() -> db.sql("""
        select e.stage, e.note, u.name user_name, e.at from prosthesis_events e left join users u on u.id = e.user_id
         where e.order_id = ? order by e.at""").param(id).query(Event.class).list());
  }

  private void event(Ctx c, UUID id, String stage, String note) {
    db.sql("insert into prosthesis_events (clinic_id, order_id, stage, note, user_id) values (?, ?, ?, ?, ?)")
        .params(c.clinicId(), id, stage, note, c.userId()).update();
  }

  private Order get(UUID id) {
    return db.sql(SELECT + " where o.id = ? and o.canceled_at is null").param(id).query(Order.class).optional()
        .orElseThrow(() -> ApiException.notFound("Pedido de prótese"));
  }
}

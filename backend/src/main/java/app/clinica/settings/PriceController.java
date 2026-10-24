package app.clinica.settings;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
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
 * Ajustes › Tabelas de preço e procedimentos. Procedimento nunca é apagado (orçamentos e tratamentos
 * antigos apontam para ele): só é desativado e some das listas de escolha.
 */
@RestController
@RequestMapping("/api")
public class PriceController {
  private final Db db;

  public PriceController(Db db) { this.db = db; }

  public record PriceTable(UUID id, String name, String kind, boolean isDefault, boolean isActive, long procedureCount) {}
  public record TableReq(@NotBlank @Size(max = 80) String name, @Pattern(regexp = "particular|convenio") String kind,
                         UUID copyFrom, Boolean isDefault, Boolean isActive) {}
  public record Procedure(UUID id, UUID priceTableId, String name, String tussCode, String specialty, long priceCents,
                          long costCents, String scope, boolean isActive) {}
  public record ProcReq(@Size(min = 1, max = 160) String name, @Size(max = 20) @Pattern(regexp = "[0-9]*") String tussCode,
                        @Size(max = 40) String specialty, @PositiveOrZero Long priceCents, @PositiveOrZero Long costCents,
                        @Pattern(regexp = "tooth|face|region|arch|mouth") String scope, Boolean isActive) {}

  @GetMapping("/price-tables")
  public List<PriceTable> tables() {
    return db.inClinic(() -> db.sql("""
        select t.id, t.name, t.kind, t.is_default, t.is_active,
               (select count(*) from procedures p where p.price_table_id = t.id and p.is_active) procedure_count
          from price_tables t order by t.is_default desc, t.is_active desc, t.name""").query(PriceTable.class).list());
  }

  @PostMapping("/price-tables")
  @ResponseStatus(HttpStatus.CREATED)
  public PriceTable createTable(@Valid @RequestBody TableReq r) {
    Ctx c = Ctx.current();
    c.require("config.plans");
    return db.inClinic(() -> {
      UUID id = db.sql("insert into price_tables (clinic_id, name, kind) values (?, ?, ?) returning id")
          .params(c.clinicId(), r.name().trim(), r.kind() == null ? "convenio" : r.kind()).query(UUID.class).single();
      if (r.copyFrom() != null) {
        // Convênio novo partindo da lista de outra tabela; os preços a clínica ajusta depois.
        db.sql("""
            insert into procedures (clinic_id, price_table_id, name, tuss_code, specialty, price_cents, cost_cents, scope)
            select clinic_id, ?, name, tuss_code, specialty, price_cents, cost_cents, scope
              from procedures where price_table_id = ? and is_active""").params(id, r.copyFrom()).update();
      }
      if (Boolean.TRUE.equals(r.isDefault())) makeDefault(id);
      return table(id);
    });
  }

  @PatchMapping("/price-tables/{id}")
  public PriceTable patchTable(@PathVariable UUID id, @Valid @RequestBody TableReq r) {
    Ctx c = Ctx.current();
    c.require("config.plans");
    return db.inClinic(() -> {
      boolean isDefault = db.sql("select is_default from price_tables where id = ?").param(id).query(Boolean.class)
          .optional().orElseThrow(() -> ApiException.notFound("Tabela"));
      if (isDefault && Boolean.FALSE.equals(r.isActive())) {
        throw new ApiException(409, "DEFAULT_TABLE", "A tabela padrão não pode ser desativada. Escolha outra como padrão antes.");
      }
      db.sql("update price_tables set name = ?, kind = coalesce(?, kind), is_active = coalesce(?, is_active) where id = ?")
          .params(r.name().trim(), r.kind(), r.isActive(), id).update();
      if (Boolean.TRUE.equals(r.isDefault())) makeDefault(id);
      return table(id);
    });
  }

  @GetMapping("/price-tables/{id}/procedures")
  public List<Procedure> procedures(@PathVariable UUID id, @RequestParam(defaultValue = "false") boolean includeInactive) {
    return db.inClinic(() -> db.sql("""
        select id, price_table_id, name, tuss_code, specialty, price_cents, cost_cents, scope, is_active
          from procedures where price_table_id = ? and (? or is_active)
         order by is_active desc, name""").params(id, includeInactive).query(Procedure.class).list());
  }

  @PostMapping("/price-tables/{id}/procedures")
  @ResponseStatus(HttpStatus.CREATED)
  public Procedure createProcedure(@PathVariable UUID id, @Valid @RequestBody ProcReq r) {
    Ctx c = Ctx.current();
    c.require("config.plans");
    if (r.name() == null || r.name().isBlank()) throw ApiException.badRequest("NAME_REQUIRED", "Dê um nome ao procedimento.");
    return db.inClinic(() -> {
      UUID pid = db.sql("""
          insert into procedures (clinic_id, price_table_id, name, tuss_code, specialty, price_cents, cost_cents, scope)
          values (?, ?, ?, ?, ?, ?, ?, ?) returning id""")
          .params(c.clinicId(), id, r.name().trim(), Text.blank(r.tussCode()), Text.blank(r.specialty()),
              r.priceCents() == null ? 0 : r.priceCents(), r.costCents() == null ? 0 : r.costCents(),
              r.scope() == null ? "tooth" : r.scope())
          .query(UUID.class).single();
      return procedure(pid);
    });
  }

  @PatchMapping("/procedures/{id}")
  public Procedure patchProcedure(@PathVariable UUID id, @Valid @RequestBody ProcReq r) {
    Ctx c = Ctx.current();
    c.require("config.plans");
    return db.inClinic(() -> {
      // tussCode "" limpa o código; null mantém.
      int n = db.sql("""
          update procedures set name = coalesce(?, name),
                 tuss_code = case when ?::text is null then tuss_code else nullif(?::text, '') end,
                 specialty = coalesce(?, specialty), price_cents = coalesce(?, price_cents),
                 cost_cents = coalesce(?, cost_cents), scope = coalesce(?, scope), is_active = coalesce(?, is_active)
           where id = ?""")
          .params(Text.blank(r.name()), r.tussCode(), r.tussCode(), Text.blank(r.specialty()), r.priceCents(),
              r.costCents(), r.scope(), r.isActive(), id).update();
      if (n == 0) throw ApiException.notFound("Procedimento");
      return procedure(id);
    });
  }

  private void makeDefault(UUID id) {
    db.sql("update price_tables set is_default = false where is_default and id <> ?").param(id).update();
    db.sql("update price_tables set is_default = true, is_active = true where id = ?").param(id).update();
  }

  private PriceTable table(UUID id) {
    return tables().stream().filter(t -> t.id().equals(id)).findFirst().orElseThrow();
  }

  private Procedure procedure(UUID id) {
    return db.sql("select id, price_table_id, name, tuss_code, specialty, price_cents, cost_cents, scope, is_active from procedures where id = ?")
        .param(id).query(Procedure.class).single();
  }
}

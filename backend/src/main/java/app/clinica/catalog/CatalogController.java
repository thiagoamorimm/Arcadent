package app.clinica.catalog;

import app.clinica.shared.Db;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Listas de apoio que as telas da fatia vertical precisam (profissionais, procedimentos, contas, rótulos). */
@RestController
@RequestMapping("/api")
public class CatalogController {
  private final Db db;

  public CatalogController(Db db) { this.db = db; }

  public record Procedure(UUID id, String name, String tussCode, String specialty, long priceCents, String scope) {}
  public record Account(UUID id, String name, String kind, boolean isDefault) {}
  public record Label(UUID id, String name, String color) {}

  @GetMapping("/procedures")
  public List<Procedure> procedures(@RequestParam(required = false) String q) {
    String term = q == null ? "" : q.trim();
    return db.inClinic(() -> db.sql("""
        select p.id, p.name, p.tuss_code, p.specialty, p.price_cents, p.scope
          from procedures p join price_tables t on t.id = p.price_table_id
         where t.is_default and p.is_active
           and (? = '' or p.name ilike '%' || ? || '%' or p.tuss_code = ?)
         order by p.name
         limit 50""").params(term, term, term).query(Procedure.class).list());
  }

  @GetMapping("/financial-accounts")
  public List<Account> accounts() {
    return db.inClinic(() -> db.sql("""
        select id, name, kind, is_default from financial_accounts where is_active order by is_default desc, name""")
        .query(Account.class).list());
  }

  @GetMapping("/labels")
  public List<Label> labels() {
    return db.inClinic(() -> db.sql("select id, name, color from labels order by name").query(Label.class).list());
  }
}

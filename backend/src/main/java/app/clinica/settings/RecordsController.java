package app.clinica.settings;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
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

/** Ajustes › Rótulos, Contas financeiras e Categorias. */
@RestController
@RequestMapping("/api")
public class RecordsController {
  private final Db db;

  public RecordsController(Db db) { this.db = db; }

  // ---------- Rótulos (cor = índice 1–8 da paleta de tokens label-N) ----------
  public record Label(UUID id, String name, String color, long usage) {}
  public record LabelReq(@NotBlank @Size(max = 40) String name, @NotBlank @Pattern(regexp = "[1-8]") String color) {}

  @GetMapping("/labels/manage")
  public List<Label> labels() {
    return db.inClinic(() -> db.sql("""
        select l.id, l.name, l.color, (select count(*) from appointments a where a.label_id = l.id) usage
          from labels l order by l.name""").query(Label.class).list());
  }

  @PostMapping("/labels")
  @ResponseStatus(HttpStatus.CREATED)
  public Label createLabel(@Valid @RequestBody LabelReq r) {
    Ctx c = Ctx.current();
    c.require("config.records");
    return db.inClinic(() -> {
      UUID id = db.sql("insert into labels (clinic_id, name, color) values (?, ?, ?) returning id")
          .params(c.clinicId(), r.name().trim(), r.color()).query(UUID.class).single();
      return labelById(id);
    });
  }

  @PatchMapping("/labels/{id}")
  public Label patchLabel(@PathVariable UUID id, @Valid @RequestBody LabelReq r) {
    Ctx.current().require("config.records");
    return db.inClinic(() -> {
      if (db.sql("update labels set name = ?, color = ? where id = ?").params(r.name().trim(), r.color(), id).update() == 0) {
        throw ApiException.notFound("Rótulo");
      }
      return labelById(id);
    });
  }

  /** Consultas com esse rótulo ficam sem rótulo (FK on delete set null); nada some da agenda. */
  @DeleteMapping("/labels/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteLabel(@PathVariable UUID id) {
    Ctx.current().require("config.records");
    db.inClinic(() -> {
      if (db.sql("delete from labels where id = ?").param(id).update() == 0) throw ApiException.notFound("Rótulo");
    });
  }

  private Label labelById(UUID id) {
    return labels().stream().filter(l -> l.id().equals(id)).findFirst().orElseThrow();
  }

  // ---------- Contas financeiras ----------
  public record Account(UUID id, String name, String kind, boolean isDefault, boolean isActive, long usage) {}
  public record AccountReq(@NotBlank @Size(max = 80) String name, @Pattern(regexp = "bank|cash") String kind,
                           Boolean isDefault, Boolean isActive) {}

  @GetMapping("/financial-accounts/manage")
  public List<Account> accounts() {
    return db.inClinic(() -> db.sql("""
        select a.id, a.name, a.kind, a.is_default, a.is_active,
               (select count(*) from payments p where p.financial_account_id = a.id)
             + (select count(*) from expenses e where e.financial_account_id = a.id) usage
          from financial_accounts a order by a.is_default desc, a.is_active desc, a.name""").query(Account.class).list());
  }

  @PostMapping("/financial-accounts")
  @ResponseStatus(HttpStatus.CREATED)
  public Account createAccount(@Valid @RequestBody AccountReq r) {
    Ctx c = Ctx.current();
    c.require("config.finance");
    return db.inClinic(() -> {
      UUID id = db.sql("insert into financial_accounts (clinic_id, name, kind) values (?, ?, ?) returning id")
          .params(c.clinicId(), r.name().trim(), r.kind() == null ? "bank" : r.kind()).query(UUID.class).single();
      if (Boolean.TRUE.equals(r.isDefault())) makeDefaultAccount(id);
      return accountById(id);
    });
  }

  @PatchMapping("/financial-accounts/{id}")
  public Account patchAccount(@PathVariable UUID id, @Valid @RequestBody AccountReq r) {
    Ctx.current().require("config.finance");
    return db.inClinic(() -> {
      var cur = db.sql("select is_default, kind from financial_accounts where id = ?").param(id).query().listOfRows()
          .stream().findFirst().orElseThrow(() -> ApiException.notFound("Conta"));
      if (Boolean.TRUE.equals(cur.get("is_default")) && Boolean.FALSE.equals(r.isActive())) {
        throw new ApiException(409, "DEFAULT_ACCOUNT", "A conta padrão não pode ser desativada. Escolha outra como padrão antes.");
      }
      // Trocar o tipo de uma conta com caixa aberto quebraria o fechamento de caixa.
      if (r.kind() != null && !r.kind().equals(cur.get("kind"))) {
        boolean openCash = db.sql("select exists(select 1 from cash_sessions where financial_account_id = ? and closed_at is null)")
            .param(id).query(Boolean.class).single();
        if (openCash) throw new ApiException(409, "CASH_OPEN", "Feche o caixa desta conta antes de mudar o tipo.");
      }
      db.sql("update financial_accounts set name = ?, kind = coalesce(?, kind), is_active = coalesce(?, is_active) where id = ?")
          .params(r.name().trim(), r.kind(), r.isActive(), id).update();
      if (Boolean.TRUE.equals(r.isDefault())) makeDefaultAccount(id);
      return accountById(id);
    });
  }

  /** Só apaga conta nunca usada; com movimento, a saída é desativar (o histórico continua apontando para ela). */
  @DeleteMapping("/financial-accounts/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteAccount(@PathVariable UUID id) {
    Ctx.current().require("config.finance");
    db.inClinic(() -> {
      Account a = accounts().stream().filter(x -> x.id().equals(id)).findFirst().orElseThrow(() -> ApiException.notFound("Conta"));
      if (a.isDefault()) throw new ApiException(409, "DEFAULT_ACCOUNT", "A conta padrão não pode ser excluída.");
      boolean cash = db.sql("select exists(select 1 from cash_sessions where financial_account_id = ?)").param(id).query(Boolean.class).single();
      if (a.usage() > 0 || cash) {
        throw new ApiException(409, "ACCOUNT_IN_USE", "Esta conta já tem movimentações. Desative-a em vez de excluir.");
      }
      db.sql("delete from financial_accounts where id = ?").param(id).update();
    });
  }

  private void makeDefaultAccount(UUID id) {
    db.sql("update financial_accounts set is_default = false where is_default and id <> ?").param(id).update();
    db.sql("update financial_accounts set is_default = true, is_active = true where id = ?").param(id).update();
  }

  private Account accountById(UUID id) {
    return accounts().stream().filter(a -> a.id().equals(id)).findFirst().orElseThrow();
  }

  // ---------- Categorias ----------
  public record Category(UUID id, String name, String kind, long usage) {}
  public record CategoryReq(@NotBlank @Size(max = 60) String name, @Pattern(regexp = "expense|income") String kind) {}

  @GetMapping("/categories")
  public List<Category> categories(@RequestParam(required = false) String kind) {
    return db.inClinic(() -> db.sql("""
        select c.id, c.name, c.kind,
               (select count(*) from expenses e where e.category_id = c.id)
             + (select count(*) from debits d where d.category_id = c.id) usage
          from categories c where (?::text is null or c.kind = ?) order by c.kind, c.name""")
        .params(kind, kind).query(Category.class).list());
  }

  @PostMapping("/categories")
  @ResponseStatus(HttpStatus.CREATED)
  public Category createCategory(@Valid @RequestBody CategoryReq r) {
    Ctx c = Ctx.current();
    c.require("config.finance");
    if (r.kind() == null) throw ApiException.badRequest("KIND", "Escolha se é categoria de despesa ou de receita.");
    return db.inClinic(() -> {
      UUID id = db.sql("insert into categories (clinic_id, name, kind) values (?, ?, ?) on conflict do nothing returning id")
          .params(c.clinicId(), r.name().trim(), r.kind()).query(UUID.class).optional()
          .orElseThrow(() -> new ApiException(409, "CATEGORY_EXISTS", "Já existe uma categoria com esse nome."));
      return categoryById(id);
    });
  }

  @PatchMapping("/categories/{id}")
  public Category patchCategory(@PathVariable UUID id, @Valid @RequestBody CategoryReq r) {
    Ctx.current().require("config.finance");
    return db.inClinic(() -> {
      boolean clash = db.sql("""
          select exists(select 1 from categories x join categories me on me.id = ?
                         where x.id <> me.id and x.kind = me.kind and lower(x.name) = lower(?))""")
          .params(id, r.name().trim()).query(Boolean.class).single();
      if (clash) throw new ApiException(409, "CATEGORY_EXISTS", "Já existe uma categoria com esse nome.");
      if (db.sql("update categories set name = ? where id = ?").params(r.name().trim(), id).update() == 0) {
        throw ApiException.notFound("Categoria");
      }
      return categoryById(id);
    });
  }

  /** Lançamentos com essa categoria ficam "sem categoria" (FK on delete set null). */
  @DeleteMapping("/categories/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteCategory(@PathVariable UUID id) {
    Ctx.current().require("config.finance");
    db.inClinic(() -> {
      if (db.sql("delete from categories where id = ?").param(id).update() == 0) throw ApiException.notFound("Categoria");
    });
  }

  private Category categoryById(UUID id) {
    return categories(null).stream().filter(x -> x.id().equals(id)).findFirst().orElseThrow();
  }
}

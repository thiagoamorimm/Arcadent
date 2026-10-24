package app.clinica.stock;

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
import java.math.BigDecimal;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Estoque (S26): produtos com saldo e nível mínimo; toda entrada, saída ou ajuste vira movimento
 * (histórico só de inclusão). O saldo nunca fica negativo: saída maior que o saldo é recusada.
 */
@RestController
@RequestMapping("/api/stock")
public class StockController {
  private final Db db;

  public StockController(Db db) { this.db = db; }

  public record Product(UUID id, String name, String unit, String category, BigDecimal minQty, BigDecimal qty,
                        Long costCents, boolean isActive, boolean low, OffsetDateTime lastMovementAt) {}
  public record ProductReq(@NotBlank @Size(max = 120) String name, @Size(max = 12) String unit, @Size(max = 60) String category,
                           @PositiveOrZero BigDecimal minQty, @PositiveOrZero BigDecimal initialQty, @PositiveOrZero Long costCents,
                           Boolean isActive) {}
  /** entrada/saida: qty positivo; ajuste: countedQty = quanto há de fato na prateleira. */
  public record MovementReq(@NotNull @Pattern(regexp = "entrada|saida|ajuste") String kind, BigDecimal qty, BigDecimal countedQty,
                            @PositiveOrZero Long costCents, @Size(max = 200) String reason) {}
  public record Movement(UUID id, String kind, BigDecimal qty, BigDecimal balance, Long costCents, String reason,
                         String userName, OffsetDateTime createdAt) {}

  private static final String SELECT = """
      select p.id, p.name, p.unit, p.category, p.min_qty, p.qty, p.cost_cents, p.is_active,
             (p.qty <= p.min_qty) low,
             (select max(m.created_at) from stock_movements m where m.product_id = p.id) last_movement_at
        from stock_products p
      """;

  @GetMapping("/products")
  public List<Product> list(@RequestParam(defaultValue = "false") boolean includeInactive) {
    Ctx.current().require("stock.manage");
    return db.inClinic(() -> db.sql(SELECT + " where (? or p.is_active) order by (p.qty <= p.min_qty) desc, lower(p.name)")
        .param(includeInactive).query(Product.class).list());
  }

  @PostMapping("/products")
  @ResponseStatus(HttpStatus.CREATED)
  public Product create(@Valid @RequestBody ProductReq r) {
    Ctx c = Ctx.current();
    c.require("stock.manage");
    return db.inClinic(() -> {
      UUID id;
      try {
        id = db.sql("""
            insert into stock_products (clinic_id, name, unit, category, min_qty, cost_cents)
            values (?, ?, ?, ?, ?, ?) returning id""")
            .params(c.clinicId(), r.name().trim(), unit(r.unit()), Text.blank(r.category()),
                r.minQty() == null ? BigDecimal.ZERO : r.minQty(), r.costCents())
            .query(UUID.class).single();
      } catch (org.springframework.dao.DuplicateKeyException e) {
        throw new ApiException(409, "DUPLICATE", "Já existe um produto com esse nome.");
      }
      if (r.initialQty() != null && r.initialQty().signum() > 0) {
        move(c, id, "entrada", r.initialQty(), r.costCents(), "Saldo inicial");
      }
      return get(id);
    });
  }

  @PatchMapping("/products/{id}")
  public Product update(@PathVariable UUID id, @Valid @RequestBody ProductReq r) {
    Ctx.current().require("stock.manage");
    return db.inClinic(() -> {
      try {
        int n = db.sql("""
            update stock_products set name = ?, unit = ?, category = ?, min_qty = coalesce(?, min_qty),
                   cost_cents = coalesce(?, cost_cents), is_active = coalesce(?, is_active)
             where id = ?""")
            .params(r.name().trim(), unit(r.unit()), Text.blank(r.category()), r.minQty(), r.costCents(), r.isActive(), id).update();
        if (n == 0) throw ApiException.notFound("Produto");
      } catch (org.springframework.dao.DuplicateKeyException e) {
        throw new ApiException(409, "DUPLICATE", "Já existe um produto com esse nome.");
      }
      return get(id);
    });
  }

  @PostMapping("/products/{id}/movements")
  @ResponseStatus(HttpStatus.CREATED)
  public Product movement(@PathVariable UUID id, @Valid @RequestBody MovementReq r) {
    Ctx c = Ctx.current();
    c.require("stock.manage");
    return db.inClinic(() -> {
      BigDecimal cur = db.sql("select qty from stock_products where id = ? and is_active for update").param(id)
          .query(BigDecimal.class).optional().orElseThrow(() -> ApiException.notFound("Produto"));
      BigDecimal delta;
      switch (r.kind()) {
        case "ajuste" -> {
          if (r.countedQty() == null || r.countedQty().signum() < 0) throw ApiException.badRequest("QTY", "Informe quanto há de fato no estoque.");
          delta = r.countedQty().subtract(cur);
          if (delta.signum() == 0) return get(id); // conferiu e bateu: nada a registrar
          if (Text.blank(r.reason()) == null) throw ApiException.badRequest("REASON", "Diga o motivo do ajuste (perda, vencido, contagem…).");
        }
        case "saida" -> {
          if (r.qty() == null || r.qty().signum() <= 0) throw ApiException.badRequest("QTY", "Informe a quantidade.");
          if (r.qty().compareTo(cur) > 0) {
            throw new ApiException(409, "STOCK_NEGATIVE", "Só há " + cur.stripTrailingZeros().toPlainString() + " em estoque.");
          }
          delta = r.qty().negate();
        }
        default -> {
          if (r.qty() == null || r.qty().signum() <= 0) throw ApiException.badRequest("QTY", "Informe a quantidade.");
          delta = r.qty();
        }
      }
      move(c, id, r.kind(), delta, r.costCents(), r.reason());
      return get(id);
    });
  }

  @GetMapping("/products/{id}/movements")
  public List<Movement> movements(@PathVariable UUID id) {
    Ctx.current().require("stock.manage");
    return db.inClinic(() -> db.sql("""
        select m.id, m.kind, m.qty, m.balance, m.cost_cents, m.reason, u.name user_name, m.created_at
          from stock_movements m left join users u on u.id = m.created_by
         where m.product_id = ? order by m.created_at desc limit 200""").param(id).query(Movement.class).list());
  }

  /** Precisa estar na transação com o produto travado. */
  private void move(Ctx c, UUID id, String kind, BigDecimal delta, Long cost, String reason) {
    BigDecimal balance = db.sql("update stock_products set qty = qty + ?, cost_cents = coalesce(?, cost_cents) where id = ? returning qty")
        .params(delta, kind.equals("entrada") ? cost : null, id).query(BigDecimal.class).single();
    db.sql("""
        insert into stock_movements (clinic_id, product_id, kind, qty, cost_cents, reason, balance, created_by)
        values (?, ?, ?, ?, ?, ?, ?, ?)""")
        .params(c.clinicId(), id, kind, delta, cost, Text.blank(reason), balance, c.userId()).update();
  }

  private Product get(UUID id) {
    return db.sql(SELECT + " where p.id = ?").param(id).query(Product.class).optional().orElseThrow(() -> ApiException.notFound("Produto"));
  }

  private static String unit(String u) {
    String t = Text.blank(u);
    return t == null ? "un" : t;
  }
}

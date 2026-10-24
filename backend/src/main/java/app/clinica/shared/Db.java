package app.clinica.shared;

import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Único caminho para o banco. Toda operação roda numa transação que começa com
 * set_config('app.clinic_id') / set_config('app.user_id') (escopo da transação),
 * e é isso que faz o RLS do Postgres filtrar a clínica certa.
 * Sem passar por aqui, a role da aplicação não enxerga nenhuma linha de clínica.
 */
@Component
public class Db {
  private final JdbcClient jdbc;
  private final TransactionTemplate tx;

  public Db(JdbcClient jdbc, TransactionTemplate tx) {
    this.jdbc = jdbc;
    this.tx = tx;
  }

  /** Clínica e usuário do token da requisição atual. */
  public <T> T inClinic(Supplier<T> work) {
    Ctx c = Ctx.current();
    return as(c.clinicId(), c.userId(), work);
  }

  public void inClinic(Runnable work) {
    inClinic(() -> { work.run(); return null; });
  }

  /** Contexto explícito (cadastro, login, fluxos públicos com token). */
  public <T> T as(UUID clinicId, UUID userId, Supplier<T> work) {
    return tx.execute(status -> {
      jdbc.sql("select set_config('app.clinic_id', ?, true), set_config('app.user_id', ?, true)")
          .params(clinicId == null ? "" : clinicId.toString(), userId == null ? "" : userId.toString())
          .query().singleRow();
      return work.get();
    });
  }

  public JdbcClient sql() {
    return jdbc;
  }

  public JdbcClient.StatementSpec sql(String sql) {
    return jdbc.sql(sql);
  }
}

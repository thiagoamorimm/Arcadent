package app.clinica.auth;

import app.clinica.shared.Db;
import java.util.UUID;

/**
 * Cadastros iniciais de toda clínica nova, para ela começar a usar no primeiro minuto.
 * Lista e preços de partida são nossos (editáveis pela clínica). Código TUSS fica em branco:
 * a clínica preenche conforme a tabela oficial que usa.
 */
final class ClinicSeed {
  private ClinicSeed() {}

  private record Proc(String name, String specialty, long priceCents, String scope) {}

  private static final Proc[] PROCEDURES = {
      new Proc("Avaliação inicial", "clinica_geral", 15000, "mouth"),
      new Proc("Profilaxia (limpeza)", "periodontia", 20000, "mouth"),
      new Proc("Aplicação de flúor", "prevencao", 8000, "mouth"),
      new Proc("Radiografia periapical", "radiologia", 5000, "tooth"),
      new Proc("Restauração em resina — 1 face", "dentistica", 25000, "face"),
      new Proc("Restauração em resina — 2 ou mais faces", "dentistica", 32000, "face"),
      new Proc("Raspagem por sextante", "periodontia", 18000, "region"),
      new Proc("Extração simples", "cirurgia", 30000, "tooth"),
      new Proc("Tratamento de canal — unirradicular", "endodontia", 90000, "tooth"),
      new Proc("Tratamento de canal — multirradicular", "endodontia", 140000, "tooth"),
      new Proc("Coroa em porcelana", "protese", 180000, "tooth"),
      new Proc("Implante unitário", "implantodontia", 350000, "tooth"),
      new Proc("Clareamento de consultório", "estetica", 90000, "arch"),
      new Proc("Manutenção ortodôntica", "ortodontia", 18000, "mouth"),
  };

  /** Expediente de partida: seg–sex 08–12 e 13–18, sábado 08–12. A clínica ajusta em Ajustes › Clínica. */
  static final String DEFAULT_HOURS = """
      {"mon":[["08:00","12:00"],["13:00","18:00"]],"tue":[["08:00","12:00"],["13:00","18:00"]],
       "wed":[["08:00","12:00"],["13:00","18:00"]],"thu":[["08:00","12:00"],["13:00","18:00"]],
       "fri":[["08:00","12:00"],["13:00","18:00"]],"sat":[["08:00","12:00"]],"sun":[]}""";

  static void apply(Db db, UUID clinicId) {
    db.sql("update clinics set business_hours = ?::jsonb where id = ?").params(DEFAULT_HOURS, clinicId).update();
    db.sql("update memberships set work_hours = ?::jsonb where clinic_id = ? and does_attend").params(DEFAULT_HOURS, clinicId).update();
    UUID table = db.sql("""
        insert into price_tables (clinic_id, name, kind, is_default) values (?, 'Particular', 'particular', true)
        returning id""").param(clinicId).query(UUID.class).single();
    for (Proc p : PROCEDURES) {
      db.sql("insert into procedures (clinic_id, price_table_id, name, specialty, price_cents, scope) values (?, ?, ?, ?, ?, ?)")
          .params(clinicId, table, p.name(), p.specialty(), p.priceCents(), p.scope()).update();
    }
    db.sql("insert into financial_accounts (clinic_id, name, kind, is_default) values (?, 'Caixa da recepção', 'cash', true), (?, 'Conta bancária', 'bank', false)")
        .params(clinicId, clinicId).update();
    for (String c : new String[] {"Aluguel", "Materiais", "Laboratório", "Salários", "Impostos", "Marketing", "Outras despesas"}) {
      db.sql("insert into categories (clinic_id, name, kind) values (?, ?, 'expense')").params(clinicId, c).update();
    }
    for (String c : new String[] {"Tratamentos", "Outras receitas"}) {
      db.sql("insert into categories (clinic_id, name, kind) values (?, ?, 'income')").params(clinicId, c).update();
    }
    // Modelo de anamnese padrão (o mesmo da migration V4), editável em Ajustes.
    try (var in = ClinicSeed.class.getResourceAsStream("/seed/anamnese-padrao.json")) {
      String questions = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
      db.sql("insert into anamnesis_templates (clinic_id, name, questions) values (?, 'Anamnese odontológica', ?::jsonb)")
          .params(clinicId, questions).update();
    } catch (java.io.IOException e) {
      throw new IllegalStateException(e);
    }
    String[][] labels = {{"Avaliação", "1"}, {"Retorno", "2"}, {"Urgência", "3"}, {"Cirurgia", "4"}, {"Ortodontia", "5"}, {"Estética", "7"}};
    for (String[] l : labels) {
      db.sql("insert into labels (clinic_id, name, color) values (?, ?, ?)").params(clinicId, l[0], l[1]).update();
    }
  }
}

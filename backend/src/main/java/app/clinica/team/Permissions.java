package app.clinica.team;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Catálogo de permissões (códigos estáveis + textos nossos). O dono tem todas sempre.
 * "Atende pacientes" não é permissão: é o campo does_attend do vínculo (quem tem agenda).
 */
public final class Permissions {
  private Permissions() {}

  public record Perm(String code, String label, String hint) {}
  public record Group(String key, String label, List<Perm> perms) {}

  public static final List<Group> CATALOG = List.of(
      new Group("agenda", "Agenda", List.of(
          new Perm("agenda.view_all", "Ver a agenda de todos os profissionais", "Recepção e gestão. Sem isso, a pessoa vê só a própria agenda."),
          new Perm("agenda.create", "Marcar e alterar consultas", null),
          new Perm("agenda.create_for_others", "Marcar na agenda de outros profissionais", "Recepção."),
          new Perm("agenda.delete", "Excluir consultas", "Prefira cancelar: excluir apaga o histórico da consulta."))),
      new Group("pacientes", "Pacientes e prontuário", List.of(
          new Perm("paciente.edit", "Cadastrar e editar pacientes", null),
          new Perm("paciente.delete", "Excluir pacientes", null),
          new Perm("paciente.anamnesis", "Ver e preencher anamneses", "Dados de saúde."),
          new Perm("paciente.budgets", "Criar, editar e aprovar orçamentos", null),
          new Perm("paciente.treatments", "Lançar e finalizar tratamentos", null),
          new Perm("paciente.evolution_edit", "Editar e excluir evoluções", null),
          new Perm("paciente.documents", "Emitir receitas, atestados e documentos", null),
          new Perm("paciente.files", "Enviar e excluir imagens e arquivos", null))),
      new Group("financeiro", "Financeiro", List.of(
          new Perm("fin.debits_view", "Ver débitos e recebimentos", null),
          new Perm("fin.debits_create", "Lançar débitos e receitas", null),
          new Perm("fin.debits_delete", "Cancelar débitos e recebimentos", null),
          new Perm("fin.pay", "Registrar recebimentos", null),
          new Perm("fin.pay_backdated", "Registrar recebimento com data passada", "Use com cuidado: altera o caixa de dias anteriores."),
          new Perm("fin.expenses_view", "Ver despesas", null),
          new Perm("fin.expenses_edit", "Lançar, pagar e editar despesas", null),
          new Perm("fin.cash", "Abrir e fechar o caixa", null),
          new Perm("fin.commission_pay", "Pagar comissões", null))),
      new Group("clinica", "Estoque e prótese", List.of(
          new Perm("stock.manage", "Ver e movimentar o estoque", null),
          new Perm("prosthesis.manage", "Controle de prótese (pedidos ao laboratório)", null))),
      new Group("ajustes", "Ajustes", List.of(
          new Perm("config.clinic", "Dados da clínica e assinatura", "Só dono ou sócio."),
          new Perm("config.team", "Equipe, convites e permissões", "Só dono ou sócio."),
          new Perm("config.plans", "Tabelas de preço e procedimentos", null),
          new Perm("config.records", "Rótulos e cadeiras", null),
          new Perm("config.finance", "Contas financeiras e categorias", null),
          new Perm("config.anamnesis", "Modelos de anamnese e documentos", null))),
      new Group("indicadores", "Indicadores", List.of(
          new Perm("insight.tasks", "Painel do dia (aniversariantes, retornos, pendências)", null),
          new Perm("insight.performance", "Indicadores de desempenho e faturamento", "Dono e gestão."))));

  public static final Set<String> ALL = CATALOG.stream()
      .flatMap(g -> g.perms().stream()).map(Perm::code).collect(Collectors.toUnmodifiableSet());

  /** Pontos de partida ao convidar. O dono ajusta item a item depois. */
  public static final Map<String, List<String>> PRESETS = presets();

  private static Map<String, List<String>> presets() {
    var m = new LinkedHashMap<String, List<String>>();
    m.put("dentist", List.of(
        "agenda.create", "paciente.edit", "paciente.anamnesis", "paciente.budgets", "paciente.treatments",
        "paciente.documents", "paciente.files", "fin.debits_view", "insight.tasks", "prosthesis.manage"));
    m.put("secretary", List.of(
        "agenda.view_all", "agenda.create", "agenda.create_for_others", "paciente.edit", "paciente.budgets",
        "fin.debits_view", "fin.debits_create", "fin.pay", "fin.cash", "insight.tasks", "stock.manage", "prosthesis.manage"));
    m.put("custom", List.of());
    return Map.copyOf(m);
  }

  public static List<String> sanitize(List<String> perms) {
    return perms == null ? List.of() : perms.stream().filter(ALL::contains).distinct().sorted().toList();
  }
}

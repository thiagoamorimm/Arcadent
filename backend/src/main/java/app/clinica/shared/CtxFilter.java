package app.clinica.shared;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.sql.Array;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Depois de validar o JWT, carrega o vínculo atual (papel, permissões, ativo) da clínica do token.
 * Vínculo desativado ou removido → 401 na hora. Registrado no SecurityConfig depois do filtro de Bearer.
 * Também aplica o modo leitura da assinatura: clínica sem assinatura válida lê tudo, mas não grava.
 */
@Component
public class CtxFilter extends OncePerRequestFilter {
  private final Db db;
  private final ObjectMapper json;

  public CtxFilter(Db db, ObjectMapper json) {
    this.db = db;
    this.json = json;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth instanceof JwtAuthenticationToken jwt) {
      var t = jwt.getToken();
      UUID userId = UUID.fromString(t.getSubject());
      UUID clinicId = UUID.fromString(t.getClaimAsString("clinic"));
      Map<String, Object> m = db.as(clinicId, userId, () -> db.sql("""
          select m.id, m.role, m.permissions, m.does_attend, """ + READ_ONLY_SQL + """
           read_only
            from memberships m left join subscriptions s on s.clinic_id = m.clinic_id
           where m.user_id = ? and m.clinic_id = ? and m.is_active""")
          .params(userId, clinicId).query().listOfRows().stream().findFirst().orElse(null));
      if (m == null) {
        res.setStatus(401);
        res.setContentType("application/json;charset=UTF-8");
        json.writeValue(res.getOutputStream(), Map.of("code", "MEMBERSHIP_INACTIVE",
            "message", "Seu acesso a esta clínica foi encerrado. Fale com o responsável."));
        return;
      }
      if (Boolean.TRUE.equals(m.get("read_only")) && writes(req)) {
        res.setStatus(402);
        res.setContentType("application/json;charset=UTF-8");
        json.writeValue(res.getOutputStream(), Map.of("code", "READ_ONLY",
            "message", "A clínica está em modo leitura: o período de teste terminou ou a assinatura não está em dia. "
                + "Dá para consultar tudo, mas não lançar nada novo."));
        return;
      }
      req.setAttribute(Ctx.ATTR, new Ctx(userId, clinicId, (UUID) m.get("id"), (String) m.get("role"),
          toList(m.get("permissions")), Boolean.TRUE.equals(m.get("does_attend"))));
    }
    chain.doFilter(req, res);
  }

  /**
   * Regra única do modo leitura (também usada pelo /me): teste vencido, pagamento atrasado há mais de
   * 7 dias, ou status read_only/canceled. Espera o alias "s" para subscriptions.
   */
  public static final String READ_ONLY_SQL = """
      coalesce(s.status in ('read_only','canceled')
        or (s.status = 'trialing' and s.trial_ends_at < now())
        or (s.status = 'past_due' and coalesce(s.current_period_end, now()) < now() - interval '7 days'), false)""";

  /** Gravação = qualquer método que não seja leitura, fora login/sessão (trocar de clínica e sair continuam). */
  private static boolean writes(HttpServletRequest req) {
    String m = req.getMethod();
    if (m.equals("GET") || m.equals("HEAD") || m.equals("OPTIONS")) return false;
    return !req.getRequestURI().startsWith("/api/auth/");
  }

  static List<String> toList(Object pgArray) {
    try {
      if (pgArray instanceof Array a) return List.of((String[]) a.getArray());
    } catch (SQLException ignored) { }
    return List.of();
  }
}

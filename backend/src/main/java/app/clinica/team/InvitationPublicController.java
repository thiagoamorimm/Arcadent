package app.clinica.team;

import app.clinica.auth.AuthService;
import app.clinica.shared.ApiException;
import app.clinica.shared.Db;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Página pública do convite. O token só existe no link; aqui ele vira hash e é resolvido pela função
 * invitation_lookup (security definer). Depois disso tudo roda no contexto da clínica do convite.
 */
@RestController
@RequestMapping("/api/public/invitations")
public class InvitationPublicController {
  private final Db db;
  private final PasswordEncoder passwords;
  private final AuthService auth;

  public InvitationPublicController(Db db, PasswordEncoder passwords, AuthService auth) {
    this.db = db;
    this.passwords = passwords;
    this.auth = auth;
  }

  public record Preview(String clinicName, String email, String name, String role, boolean hasAccount) {}
  public record AcceptReq(@Size(max = 120) String name, @NotBlank @Size(min = 8, max = 200) String password) {}

  @GetMapping("/{token}")
  public Preview preview(@PathVariable String token) {
    var inv = lookup(token);
    boolean hasAccount = db.sql("select exists(select 1 from users where lower(email) = ?)")
        .param(((String) inv.get("email")).toLowerCase()).query(Boolean.class).single();
    return new Preview((String) inv.get("clinic_name"), (String) inv.get("email"), (String) inv.get("name"),
        (String) inv.get("role"), hasAccount);
  }

  /** Conta nova: cria com nome e senha. Conta existente: confirma a senha dela. Depois cria o vínculo. */
  @PostMapping("/{token}/accept")
  public AuthService.Session accept(@PathVariable String token, @Valid @RequestBody AcceptReq r) {
    var inv = lookup(token);
    UUID clinicId = (UUID) inv.get("clinic_id");
    String email = ((String) inv.get("email")).toLowerCase();

    var existing = db.sql("select id, name, password_hash from users where lower(email) = ?").param(email)
        .query().listOfRows().stream().findFirst().orElse(null);
    UUID userId;
    String userName;
    if (existing != null) {
      if (!passwords.matches(r.password(), (String) existing.get("password_hash"))) {
        throw new ApiException(401, "INVALID_CREDENTIALS", "Senha incorreta para a conta " + email + ".");
      }
      userId = (UUID) existing.get("id");
      userName = (String) existing.get("name");
    } else {
      String name = r.name() == null || r.name().isBlank() ? (String) inv.get("name") : r.name().trim();
      if (name == null || name.isBlank()) throw ApiException.badRequest("NAME_REQUIRED", "Informe seu nome.");
      userId = UUID.randomUUID();
      userName = name;
      db.sql("insert into users (id, name, email, password_hash) values (?, ?, ?, ?)")
          .params(userId, name, email, passwords.encode(r.password())).update();
    }

    final UUID uid = userId;
    db.as(clinicId, uid, () -> {
      // Trava o convite: dois cliques no "Entrar na equipe" não criam dois vínculos.
      var still = db.sql("select accepted_at from invitations where id = ? for update").param(inv.get("id"))
          .query().listOfRows();
      if (still.isEmpty() || still.get(0).get("accepted_at") != null) return null;
      // Quem já foi da equipe e foi desativado volta com o papel e as permissões do novo convite.
      db.sql("""
          insert into memberships (clinic_id, user_id, role, permissions, does_attend)
          select clinic_id, ?, role, permissions, does_attend from invitations where id = ?
          on conflict (clinic_id, user_id) do update set
            is_active = true, role = excluded.role, permissions = excluded.permissions, does_attend = excluded.does_attend
          where memberships.role <> 'owner'""")
          .params(uid, inv.get("id")).update();
      db.sql("update invitations set accepted_at = now() where id = ?").param(inv.get("id")).update();
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'team.join', 'invitation', ?)")
          .params(clinicId, uid, inv.get("id")).update();
      return null;
    });
    return auth.enter(userId, userName, clinicId);
  }

  private Map<String, Object> lookup(String token) {
    if (token == null || token.length() < 20 || token.length() > 100) throw ApiException.notFound("Convite");
    var inv = db.sql("select * from invitation_lookup(?)").param(TeamController.sha256(token))
        .query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Convite"));
    if (inv.get("accepted_at") != null) {
      throw new ApiException(410, "INVITATION_USED", "Este convite já foi usado. Entre com seu e-mail e senha.");
    }
    var exp = ((java.sql.Timestamp) inv.get("expires_at")).toInstant();
    if (exp.isBefore(OffsetDateTime.now().toInstant())) {
      throw new ApiException(410, "INVITATION_EXPIRED", "Este convite venceu. Peça um novo ao responsável pela clínica.");
    }
    return inv;
  }
}

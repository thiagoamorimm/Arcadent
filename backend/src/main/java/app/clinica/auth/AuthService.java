package app.clinica.auth;

import app.clinica.shared.ApiException;
import app.clinica.shared.Db;
import app.clinica.shared.Mailer;
import app.clinica.shared.Tokens;
import java.text.Normalizer;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
  private final Db db;
  private final PasswordEncoder passwords;
  private final JwtEncoder jwt;
  private final long ttlMinutes;
  private final Mailer mailer;
  private final String appUrl;
  /** Sessão "lembrada": o token de renovação vale 30 dias e é trocado a cada uso. */
  private static final long REFRESH_DAYS = 30;
  /** Duas abas renovando juntas: quem chega segundos depois do outro não derruba a sessão. */
  private static final long REFRESH_GRACE_SECONDS = 60;

  public AuthService(Db db, PasswordEncoder passwords, JwtEncoder jwt, @Value("${app.jwt-ttl-minutes}") long ttlMinutes,
                     Mailer mailer, @Value("${app.cors-origin}") String appUrl) {
    this.db = db;
    this.passwords = passwords;
    this.jwt = jwt;
    this.ttlMinutes = ttlMinutes;
    this.mailer = mailer;
    this.appUrl = appUrl.replaceAll("/+$", "");
  }

  public record ClinicRef(UUID id, String name, String role) {}
  public record Session(String token, String refreshToken, UUID userId, String userName, UUID clinicId, String clinicName,
                        List<ClinicRef> clinics) {}

  /** Cria usuário + clínica + vínculo de dono + trial de 14 dias + cadastros iniciais, tudo numa transação. */
  public Session signup(String name, String email, String password, String clinicName, boolean attends) {
    String normEmail = email.trim().toLowerCase();
    UUID userId = UUID.randomUUID();
    UUID clinicId = UUID.randomUUID();
    String hash = passwords.encode(password);

    UUID membershipId = db.as(clinicId, userId, () -> {
      db.sql("insert into users (id, name, email, password_hash) values (?, ?, ?, ?)")
          .params(userId, name.trim(), normEmail, hash).update();
      db.sql("insert into clinics (id, name, slug) values (?, ?, ?)")
          .params(clinicId, clinicName.trim(), slug(clinicName)).update();
      db.sql("insert into subscriptions (clinic_id, plan, status, trial_ends_at) values (?, 'trial', 'trialing', now() + interval '14 days')")
          .params(clinicId).update();
      UUID mid = db.sql("""
          insert into memberships (clinic_id, user_id, role, does_attend, color)
          values (?, ?, 'owner', ?, '1') returning id""")
          .params(clinicId, userId, attends).query(UUID.class).single();
      ClinicSeed.apply(db, clinicId);
      return mid;
    });
    return session(userId, name.trim(), clinicId, clinicName.trim(), "owner", membershipId, List.of(), List.of(new ClinicRef(clinicId, clinicName.trim(), "owner")));
  }

  public Session login(String email, String password, UUID preferredClinic) {
    var user = db.sql("select id, name, password_hash from users where lower(email) = ?")
        .param(email.trim().toLowerCase()).query().listOfRows().stream().findFirst()
        .orElse(null);
    // Mesma resposta para e-mail inexistente e senha errada (não revela quem tem conta).
    if (user == null || !passwords.matches(password, (String) user.get("password_hash"))) {
      throw new ApiException(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
    }
    return enter((UUID) user.get("id"), (String) user.get("name"), preferredClinic);
  }

  /**
   * Troca o token de renovação por uma sessão nova (o usado é revogado na hora). Reuso de um token
   * revogado há mais de um minuto indica roubo: todas as sessões do usuário caem.
   */
  public Session refresh(String refreshToken, UUID clinicId) {
    String hash = Tokens.sha256(refreshToken);
    UUID userId = db.sql("""
        update refresh_tokens set revoked_at = now(), revoke_reason = 'rotated'
         where token_hash = ? and revoked_at is null and expires_at > now() returning user_id""")
        .param(hash).query(UUID.class).optional().orElse(null);
    if (userId == null) {
      // Só a troca normal (rotated) tem tolerância; sair, senha nova e roubo detectado não.
      var old = db.sql("""
          select user_id, revoke_reason, revoke_reason = 'rotated' and revoked_at > now() - make_interval(secs => ?) recent
            from refresh_tokens where token_hash = ? and revoked_at is not null""")
          .params(REFRESH_GRACE_SECONDS, hash).query().listOfRows().stream().findFirst().orElse(null);
      if (old != null && Boolean.TRUE.equals(old.get("recent"))) {
        throw new ApiException(409, "REFRESH_RACE", "A sessão acabou de ser renovada em outra aba.");
      }
      // Token trocado há tempo sendo usado de novo = alguém copiou: derruba todas as sessões.
      if (old != null && "rotated".equals(old.get("revoke_reason"))) {
        revokeAll((UUID) old.get("user_id"), "reuse");
      }
      throw new ApiException(401, "INVALID_REFRESH", "Sua sessão expirou. Entre de novo.");
    }
    String name = db.sql("select name from users where id = ?").param(userId).query(String.class).single();
    return enter(userId, name, clinicId);
  }

  public void logout(String refreshToken) {
    db.sql("update refresh_tokens set revoked_at = now(), revoke_reason = 'logout' where token_hash = ? and revoked_at is null")
        .param(Tokens.sha256(refreshToken)).update();
  }

  /** Trocar de clínica: só para uma clínica em que a pessoa tem vínculo ativo (nada de "cair" na primeira). */
  public Session switchClinic(UUID userId, UUID clinicId) {
    boolean ok = db.as(null, userId, () -> db.sql("select exists(select 1 from memberships where user_id = ? and clinic_id = ? and is_active)")
        .params(userId, clinicId).query(Boolean.class).single());
    if (!ok) throw new ApiException(403, "NO_ACCESS", "Você não tem acesso a essa clínica.");
    String name = db.sql("select name from users where id = ?").param(userId).query(String.class).single();
    return enter(userId, name, clinicId);
  }

  /**
   * Esqueci a senha: manda o link (1 h, uso único) se o e-mail existir. A resposta é sempre a mesma,
   * exista ou não a conta. Pedir de novo invalida o link anterior.
   */
  public void forgot(String email) {
    var user = db.sql("select id, name, email from users where lower(email) = ?").param(email.trim().toLowerCase())
        .query().listOfRows().stream().findFirst().orElse(null);
    if (user == null) return;
    UUID userId = (UUID) user.get("id");
    String token = Tokens.random();
    db.sql("update password_resets set used_at = now() where user_id = ? and used_at is null").param(userId).update();
    db.sql("insert into password_resets (user_id, token_hash, expires_at) values (?, ?, now() + interval '1 hour')")
        .params(userId, Tokens.sha256(token)).update();
    mailer.send((String) user.get("email"), "Arcadent: redefinir sua senha",
        "Olá, " + user.get("name") + ".\n\nPara criar uma senha nova no Arcadent, abra o link abaixo (vale por 1 hora e só uma vez):\n"
            + appUrl + "/redefinir-senha?token=" + token
            + "\n\nSe não foi você que pediu, ignore este e-mail: sua senha continua a mesma.\n\nEquipe Arcadent");
  }

  /** Senha nova pelo link. Derruba as outras sessões (quem estava com a senha antiga sai) e já entra. */
  public Session reset(String token, String newPassword) {
    UUID userId = db.sql("""
        update password_resets set used_at = now()
         where token_hash = ? and used_at is null and expires_at > now() returning user_id""")
        .param(Tokens.sha256(token)).query(UUID.class).optional()
        .orElseThrow(() -> new ApiException(400, "INVALID_RESET", "Este link expirou ou já foi usado. Peça um novo."));
    db.sql("update users set password_hash = ? where id = ?").params(passwords.encode(newPassword), userId).update();
    revokeAll(userId, "password_reset");
    String name = db.sql("select name from users where id = ?").param(userId).query(String.class).single();
    return enter(userId, name, null);
  }

  private void revokeAll(UUID userId, String reason) {
    db.sql("update refresh_tokens set revoked_at = now(), revoke_reason = ? where user_id = ? and revoked_at is null")
        .params(reason, userId).update();
  }

  /** Clínicas em que a pessoa tem vínculo ativo (seletor de clínica). */
  public List<ClinicRef> clinicsOf(UUID userId) {
    return db.as(null, userId, () -> db.sql("""
        select c.id, c.name, m.role from memberships m join clinics c on c.id = m.clinic_id
         where m.user_id = ? and m.is_active order by c.name""").param(userId).query(ClinicRef.class).list());
  }

  /** Sessão para um usuário já autenticado (login ou aceite de convite), na clínica preferida se tiver vínculo. */
  public Session enter(UUID userId, String userName, UUID preferredClinic) {
    // Sem clínica no contexto: as policies own_memberships/own_clinics liberam só os vínculos do usuário.
    List<Map<String, Object>> links = db.as(null, userId, () -> db.sql("""
        select m.id mid, m.role, m.permissions, c.id cid, c.name cname
          from memberships m join clinics c on c.id = m.clinic_id
         where m.user_id = ? and m.is_active
         order by c.name""").param(userId).query().listOfRows());
    if (links.isEmpty()) throw new ApiException(403, "NO_CLINIC", "Sua conta não está ligada a nenhuma clínica ativa.");

    var chosen = links.stream().filter(l -> l.get("cid").equals(preferredClinic)).findFirst().orElse(links.get(0));
    db.sql("update users set last_login_at = now() where id = ?").param(userId).update();
    List<ClinicRef> clinics = links.stream()
        .map(l -> new ClinicRef((UUID) l.get("cid"), (String) l.get("cname"), (String) l.get("role"))).toList();
    return session(userId, userName, (UUID) chosen.get("cid"), (String) chosen.get("cname"),
        (String) chosen.get("role"), (UUID) chosen.get("mid"), toList(chosen.get("permissions")), clinics);
  }

  private Session session(UUID userId, String userName, UUID clinicId, String clinicName, String role,
                          UUID membershipId, List<String> perms, List<ClinicRef> clinics) {
    Instant now = Instant.now();
    var claims = JwtClaimsSet.builder()
        .subject(userId.toString())
        .issuedAt(now)
        .expiresAt(now.plus(ttlMinutes, ChronoUnit.MINUTES))
        .claim("clinic", clinicId.toString())
        .claim("mid", membershipId.toString())
        .claim("role", role)
        .claim("perms", perms)
        .build();
    String token = jwt.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    String refresh = Tokens.random();
    db.sql("insert into refresh_tokens (user_id, token_hash, expires_at) values (?, ?, now() + make_interval(days => ?))")
        .params(userId, Tokens.sha256(refresh), (int) REFRESH_DAYS).update();
    return new Session(token, refresh, userId, userName, clinicId, clinicName, clinics);
  }

  @SuppressWarnings("unchecked")
  private static List<String> toList(Object pgArray) {
    try {
      if (pgArray instanceof java.sql.Array a) return List.of((String[]) a.getArray());
    } catch (java.sql.SQLException ignored) { }
    return pgArray instanceof List<?> l ? (List<String>) l : List.of();
  }

  private static String slug(String name) {
    String s = Normalizer.normalize(name, Normalizer.Form.NFD).replaceAll("\\p{M}", "")
        .toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
    if (s.isBlank()) s = "clinica";
    if (s.length() > 40) s = s.substring(0, 40);
    return s + "-" + Integer.toString(ThreadLocalRandom.current().nextInt(36 * 36 * 36, 36 * 36 * 36 * 36), 36);
  }
}

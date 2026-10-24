package app.clinica.team;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Ajustes › Equipe: membros, convites e permissões. Exige config.team (por padrão, só o dono). */
@RestController
@RequestMapping("/api")
public class TeamController {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final Db db;

  public TeamController(Db db) { this.db = db; }

  public record Member(UUID id, UUID userId, String name, String email, String role, List<String> permissions,
                       boolean doesAttend, boolean isActive, String color, String cro, String specialty,
                       OffsetDateTime lastLoginAt, boolean isMe) {}
  public record Invitation(UUID id, String email, String name, String role, List<String> permissions, boolean doesAttend,
                           OffsetDateTime expiresAt, OffsetDateTime createdAt) {}
  public record Team(List<Member> members, List<Invitation> invitations) {}

  public record InviteReq(@NotBlank @Email @Size(max = 200) String email, @Size(max = 120) String name,
                          @NotBlank @Pattern(regexp = "dentist|secretary|custom") String role,
                          List<String> permissions, Boolean doesAttend) {}
  /** O link vai uma vez só nesta resposta; no banco fica só o hash. */
  public record InviteCreated(Invitation invitation, String token) {}

  public record MemberPatch(@Pattern(regexp = "dentist|secretary|custom") String role, List<String> permissions,
                            Boolean doesAttend, Boolean isActive, @Size(max = 2) String color,
                            @Size(max = 30) String cro, @Size(max = 80) String specialty) {}

  @GetMapping("/settings/permissions")
  public Map<String, Object> catalog() {
    return Map.of("groups", Permissions.CATALOG, "presets", Permissions.PRESETS);
  }

  @GetMapping("/team")
  public Team team() {
    Ctx c = Ctx.current();
    c.require("config.team");
    return db.inClinic(() -> new Team(members(c), invitations()));
  }

  @PostMapping("/team/invitations")
  @ResponseStatus(HttpStatus.CREATED)
  public InviteCreated invite(@Valid @RequestBody InviteReq r) {
    Ctx c = Ctx.current();
    c.require("config.team");
    String email = r.email().trim().toLowerCase();
    byte[] raw = new byte[32];
    RANDOM.nextBytes(raw);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    return db.inClinic(() -> {
      boolean already = db.sql("""
          select exists(select 1 from memberships m join users u on u.id = m.user_id
                         where lower(u.email) = ? and m.is_active)""").param(email).query(Boolean.class).single();
      if (already) throw new ApiException(409, "ALREADY_MEMBER", "Essa pessoa já faz parte da equipe.");
      // Um convite aberto por e-mail: reenviar substitui o anterior (o link antigo deixa de valer).
      db.sql("delete from invitations where lower(email) = ? and accepted_at is null").param(email).update();
      List<String> perms = r.permissions() == null ? Permissions.PRESETS.get(r.role()) : Permissions.sanitize(r.permissions());
      UUID id = db.sql("""
          insert into invitations (clinic_id, email, name, role, permissions, does_attend, token_hash, expires_at, invited_by)
          values (?, ?, ?, ?, ?::text[], ?, ?, now() + interval '7 days', ?) returning id""")
          .params(c.clinicId(), email, Text.blank(r.name()), r.role(), pgArray(perms),
              Boolean.TRUE.equals(r.doesAttend()), sha256(token), c.userId())
          .query(UUID.class).single();
      audit(c, "team.invite", "invitation", id);
      return new InviteCreated(invitations().stream().filter(i -> i.id().equals(id)).findFirst().orElseThrow(), token);
    });
  }

  @DeleteMapping("/team/invitations/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void revoke(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("config.team");
    db.inClinic(() -> {
      int n = db.sql("delete from invitations where id = ? and accepted_at is null").param(id).update();
      if (n == 0) throw ApiException.notFound("Convite");
      audit(c, "team.invite_revoke", "invitation", id);
    });
  }

  @PatchMapping("/team/{membershipId}")
  public Member patch(@PathVariable UUID membershipId, @Valid @RequestBody MemberPatch r) {
    Ctx c = Ctx.current();
    c.require("config.team");
    return db.inClinic(() -> {
      String role = db.sql("select role from memberships where id = ? for update").param(membershipId)
          .query(String.class).optional().orElseThrow(() -> ApiException.notFound("Membro"));
      boolean target_is_owner = "owner".equals(role);
      if (target_is_owner && (r.role() != null || r.permissions() != null || Boolean.FALSE.equals(r.isActive()))) {
        throw new ApiException(409, "OWNER_LOCKED", "O dono da clínica tem acesso total e não pode ser desativado.");
      }
      if (membershipId.equals(c.membershipId()) && Boolean.FALSE.equals(r.isActive())) {
        throw new ApiException(409, "SELF_DEACTIVATE", "Você não pode desativar o seu próprio acesso.");
      }
      if (membershipId.equals(c.membershipId()) && r.permissions() != null && !c.isOwner()) {
        throw new ApiException(409, "SELF_PERMISSIONS", "Peça a outra pessoa responsável para mudar as suas permissões.");
      }
      db.sql("""
          update memberships set
            role = coalesce(?, role),
            permissions = coalesce(?::text[], permissions),
            does_attend = coalesce(?, does_attend),
            is_active = coalesce(?, is_active),
            color = coalesce(?, color), cro = coalesce(?, cro), specialty = coalesce(?, specialty)
           where id = ?""")
          .params(r.role(), r.permissions() == null ? null : pgArray(Permissions.sanitize(r.permissions())),
              r.doesAttend(), r.isActive(), Text.blank(r.color()), Text.blank(r.cro()), Text.blank(r.specialty()),
              membershipId)
          .update();
      audit(c, "team.update", "membership", membershipId);
      return members(c).stream().filter(m -> m.id().equals(membershipId)).findFirst().orElseThrow();
    });
  }

  private List<Member> members(Ctx c) {
    return db.sql("""
        select m.id, m.user_id, u.name, u.email, m.role, m.permissions, m.does_attend, m.is_active, m.color, m.cro,
               m.specialty, u.last_login_at
          from memberships m join users u on u.id = m.user_id
         order by m.is_active desc, (m.role = 'owner') desc, u.name""")
        .query((rs, n) -> new Member((UUID) rs.getObject("id"), (UUID) rs.getObject("user_id"), rs.getString("name"),
            rs.getString("email"), rs.getString("role"), arr(rs.getArray("permissions")), rs.getBoolean("does_attend"),
            rs.getBoolean("is_active"), rs.getString("color"), rs.getString("cro"), rs.getString("specialty"),
            rs.getObject("last_login_at", OffsetDateTime.class), c.userId().equals(rs.getObject("user_id"))))
        .list();
  }

  private List<Invitation> invitations() {
    return db.sql("""
        select id, email, name, role, permissions, does_attend, expires_at, created_at
          from invitations where accepted_at is null order by created_at desc""")
        .query((rs, n) -> new Invitation((UUID) rs.getObject("id"), rs.getString("email"), rs.getString("name"),
            rs.getString("role"), arr(rs.getArray("permissions")), rs.getBoolean("does_attend"),
            rs.getObject("expires_at", OffsetDateTime.class), rs.getObject("created_at", OffsetDateTime.class)))
        .list();
  }

  private void audit(Ctx c, String action, String entity, UUID id) {
    db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, ?, ?, ?)")
        .params(c.clinicId(), c.userId(), action, entity, id).update();
  }

  static List<String> arr(java.sql.Array a) throws java.sql.SQLException {
    return a == null ? List.of() : List.of((String[]) a.getArray());
  }

  static String pgArray(List<String> v) {
    return "{" + String.join(",", v) + "}"; // códigos do catálogo: [a-z._], sem vírgula nem aspas
  }

  static String sha256(String token) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}

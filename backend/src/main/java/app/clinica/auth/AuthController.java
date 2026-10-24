package app.clinica.auth;

import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AuthController {
  private final AuthService auth;
  private final Db db;

  public AuthController(AuthService auth, Db db) {
    this.auth = auth;
    this.db = db;
  }

  public record SignupReq(
      @NotBlank @Size(max = 120) String name,
      @NotBlank @Email @Size(max = 200) String email,
      @NotBlank @Size(min = 8, max = 200) String password,
      @NotBlank @Size(max = 120) String clinicName,
      Boolean attends) {}

  public record LoginReq(@NotBlank String email, @NotBlank String password, UUID clinicId) {}
  public record RefreshReq(@NotBlank @Size(max = 200) String refreshToken, UUID clinicId) {}
  public record ForgotReq(@NotBlank @Email @Size(max = 200) String email) {}
  public record ResetReq(@NotBlank @Size(max = 200) String token, @NotBlank @Size(min = 8, max = 200) String password) {}
  public record SwitchReq(@jakarta.validation.constraints.NotNull UUID clinicId, @Size(max = 200) String refreshToken) {}

  @PostMapping("/auth/signup")
  @ResponseStatus(HttpStatus.CREATED)
  public AuthService.Session signup(@Valid @RequestBody SignupReq r) {
    return auth.signup(r.name(), r.email(), r.password(), r.clinicName(), r.attends() == null || r.attends());
  }

  @PostMapping("/auth/login")
  public AuthService.Session login(@Valid @RequestBody LoginReq r) {
    return auth.login(r.email(), r.password(), r.clinicId());
  }

  @PostMapping("/auth/refresh")
  public AuthService.Session refresh(@Valid @RequestBody RefreshReq r) {
    return auth.refresh(r.refreshToken(), r.clinicId());
  }

  @PostMapping("/auth/logout")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void logout(@Valid @RequestBody RefreshReq r) {
    auth.logout(r.refreshToken());
  }

  @PostMapping("/auth/forgot")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void forgot(@Valid @RequestBody ForgotReq r) {
    auth.forgot(r.email());
  }

  @PostMapping("/auth/reset")
  public AuthService.Session reset(@Valid @RequestBody ResetReq r) {
    return auth.reset(r.token(), r.password());
  }

  /** Troca de clínica: sessão nova na outra clínica; o token de renovação antigo é revogado. */
  @PostMapping("/auth/switch")
  public AuthService.Session switchClinic(@Valid @RequestBody SwitchReq r) {
    Ctx c = Ctx.current();
    AuthService.Session s = auth.switchClinic(c.userId(), r.clinicId());
    if (r.refreshToken() != null) auth.logout(r.refreshToken());
    return s;
  }

  /** Quem sou, em qual clínica, com que permissões e em que estado está a assinatura. */
  @GetMapping("/me")
  public Map<String, Object> me() {
    Ctx c = Ctx.current();
    var row = db.inClinic(() -> db.sql("""
        select u.id user_id, u.name user_name, u.email, c.id clinic_id, c.name clinic_name, c.timezone,
               m.id membership_id, m.role, m.does_attend,
               s.status subscription_status, s.trial_ends_at, s.plan, s.current_period_end,
               """ + app.clinica.shared.CtxFilter.READ_ONLY_SQL + """
           read_only
          from users u
          join memberships m on m.user_id = u.id and m.clinic_id = ?
          join clinics c on c.id = m.clinic_id
          left join subscriptions s on s.clinic_id = c.id
         where u.id = ?""").params(c.clinicId(), c.userId()).query().singleRow());
    var out = new java.util.LinkedHashMap<String, Object>(row);
    // Permissões efetivas (dono = todas): a tela usa isso para esconder o que a pessoa não pode fazer.
    out.put("permissions", c.isOwner() ? app.clinica.team.Permissions.ALL.stream().sorted().toList() : c.permissions());
    out.put("clinics", auth.clinicsOf(c.userId()));
    return out;
  }
}

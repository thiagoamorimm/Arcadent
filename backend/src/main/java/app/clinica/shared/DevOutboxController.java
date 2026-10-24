package app.clinica.shared;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Só em dev (app.dev-outbox=true): lê os e-mails "enviados". Em produção responde 404. */
@RestController
public class DevOutboxController {
  private final Mailer mailer;

  public DevOutboxController(Mailer mailer) { this.mailer = mailer; }

  @GetMapping("/api/public/dev/outbox")
  public List<Mailer.Mail> outbox(@RequestParam(required = false) String to) {
    if (!mailer.devOutboxEnabled()) throw ApiException.notFound("Recurso");
    return mailer.outbox(to);
  }
}

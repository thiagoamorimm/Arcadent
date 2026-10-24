package app.clinica.shared;

import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Saída de e-mail. Ainda sem provedor (SMTP/transacional é escolhido no deploy): em dev, com
 * app.dev-outbox=true, as mensagens ficam numa caixa de saída em memória que os testes e quem
 * desenvolve conseguem ler. O log nunca leva o corpo (que pode ter link com token).
 */
@Component
public class Mailer {
  private static final Logger log = LoggerFactory.getLogger(Mailer.class);
  private static final int KEEP = 50;

  public record Mail(String to, String subject, String body, OffsetDateTime at) {}

  private final boolean devOutbox;
  private final Deque<Mail> outbox = new ArrayDeque<>();

  public Mailer(@Value("${app.dev-outbox:false}") boolean devOutbox) {
    this.devOutbox = devOutbox;
  }

  public void send(String to, String subject, String body) {
    log.info("e-mail para {}: {}", to, subject);
    if (!devOutbox) {
      log.warn("Nenhum provedor de e-mail configurado: a mensagem \"{}\" não foi entregue.", subject);
      return;
    }
    synchronized (outbox) {
      outbox.addFirst(new Mail(to, subject, body, OffsetDateTime.now()));
      while (outbox.size() > KEEP) outbox.removeLast();
    }
  }

  public boolean devOutboxEnabled() {
    return devOutbox;
  }

  public List<Mail> outbox(String to) {
    synchronized (outbox) {
      return outbox.stream().filter(m -> to == null || m.to().equalsIgnoreCase(to)).toList();
    }
  }
}

package app.clinica.record;

import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Gera o PDF com papel timbrado: cabeçalho com os dados da clínica, corpo do documento e assinatura
 * do profissional (nome, CRO). Datas no fuso da clínica. Todo texto vindo do usuário passa por esc().
 * Deve ser chamado dentro de db.inClinic (lê a clínica e o profissional pelo RLS).
 */
@Service
public class PdfService {
  private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy", Locale.forLanguageTag("pt-BR"));
  private final Db db;

  public PdfService(Db db) { this.db = db; }

  public byte[] render(Ctx c, UUID professionalId, String title, String bodyHtml, OffsetDateTime issuedAt, boolean patientSignature) {
    Map<String, Object> clinic = db.sql("select name, phone, email, document, timezone, address::text address from clinics where id = app_clinic_id()")
        .query().singleRow();
    Map<String, Object> pro = db.sql("""
        select u.name, m.cro, m.specialty from memberships m join users u on u.id = m.user_id where m.id = ?""")
        .param(professionalId != null ? professionalId : c.membershipId()).query().listOfRows().stream().findFirst().orElse(Map.of());
    ZoneId tz = ZoneId.of((String) clinic.get("timezone"));
    String date = issuedAt.atZoneSameInstant(tz).format(LONG);
    String contact = join(" · ", (String) clinic.get("phone"), (String) clinic.get("email"), doc((String) clinic.get("document")));

    String html = """
        <html><head><meta charset="utf-8"/><title>%s</title><style>
          @page { size: A4; margin: 18mm 18mm 22mm 18mm; }
          body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #14171c; line-height: 1.45; }
          .lh { border-bottom: 1.5pt solid #0f6b63; padding-bottom: 8pt; margin-bottom: 16pt; }
          .lh .name { font-size: 16pt; font-weight: bold; color: #0f6b63; }
          .lh .contact { font-size: 9pt; color: #5b6470; }
          h1 { font-size: 14pt; text-align: center; letter-spacing: 1pt; text-transform: uppercase; margin: 6pt 0 14pt; }
          .meta { text-align: center; color: #5b6470; font-size: 9pt; margin-top: -10pt; }
          .patient { border: 0.75pt solid #c9ced6; padding: 6pt 8pt; margin-bottom: 14pt; font-size: 10pt; }
          .rx-use { font-weight: bold; margin: 10pt 0 4pt; text-transform: uppercase; font-size: 9.5pt; color: #5b6470; }
          .rx { margin: 0 0 10pt; }
          .rx .line { width: 100%%; }
          .rx .med { font-weight: bold; }
          .rx .qty { text-align: right; white-space: nowrap; }
          .rx .how { margin-left: 14pt; }
          table { border-collapse: collapse; width: 100%%; }
          .qa td { border-bottom: 0.5pt solid #e3e6ea; padding: 4pt 2pt; vertical-align: top; font-size: 10pt; }
          .qa .q { width: 62%%; } .qa .a { font-weight: bold; } .detail { font-weight: normal; color: #5b6470; }
          .alerts { margin-top: 10pt; color: #b42626; }
          .text { text-align: justify; margin: 18pt 0; font-size: 12pt; }
          .notes { margin-top: 10pt; font-size: 10pt; color: #3d4652; }
          .sign { margin-top: 48pt; text-align: center; }
          .sign .line { border-top: 0.75pt solid #14171c; width: 75%%; margin: 0 auto 4pt; }
          .sign .who { font-size: 10pt; }
          .date { margin-top: 20pt; text-align: right; font-size: 10pt; }
          .consent { margin-top: 16pt; font-size: 9.5pt; color: #3d4652; }
        </style></head><body>
          <div class="lh"><div class="name">%s</div><div class="contact">%s</div></div>
          %s
          <p class="date">%s</p>
          %s
        </body></html>""".formatted(esc(title), esc((String) clinic.get("name")), esc(contact), bodyHtml, esc(date),
        signature(pro, patientSignature));

    try (var out = new ByteArrayOutputStream()) {
      var b = new PdfRendererBuilder();
      b.useFastMode();
      b.withHtmlContent(html, null);
      b.toStream(out);
      b.run();
      return out.toByteArray();
    } catch (Exception e) {
      throw new IllegalStateException("Falha ao gerar PDF", e);
    }
  }

  private static String signature(Map<String, Object> pro, boolean patient) {
    String who = esc((String) pro.getOrDefault("name", ""));
    String cro = pro.get("cro") == null ? "" : "<br/>CRO " + esc((String) pro.get("cro"));
    String spec = pro.get("specialty") == null ? "" : "<br/>" + esc((String) pro.get("specialty"));
    String prof = "<div class='sign'><div class='line'></div><div class='who'>" + who + cro + spec + "</div></div>";
    return patient
        ? "<table style='table-layout:fixed'><tr><td style='width:50%;vertical-align:top'>" + prof
          + "</td><td style='width:50%;vertical-align:top'><div class='sign'><div class='line'></div><div class='who'>Paciente ou responsável</div></div></td></tr></table>"
        : prof;
  }

  /** Bloco "Paciente: …" usado em todos os documentos. */
  public static String patientBlock(String name, String cpf, Object birth) {
    String b = birth == null ? null : ((java.sql.Date) birth).toLocalDate().format(DateTimeFormatter.ofPattern("dd/MM/yyyy"));
    return "<div class='patient'><b>Paciente:</b> " + esc(name)
        + (cpf == null ? "" : " &#160;·&#160; <b>CPF:</b> " + esc(cpf))
        + (b == null ? "" : " &#160;·&#160; <b>Nascimento:</b> " + esc(b)) + "</div>";
  }

  public static String longDate(LocalDate d) {
    return d.format(LONG);
  }

  /** Escapa para XHTML (o renderizador exige XML válido). */
  public static String esc(String s) {
    if (s == null) return "";
    StringBuilder sb = new StringBuilder(s.length());
    for (char ch : s.toCharArray()) {
      switch (ch) {
        case '&' -> sb.append("&amp;");
        case '<' -> sb.append("&lt;");
        case '>' -> sb.append("&gt;");
        case '"' -> sb.append("&quot;");
        case '\'' -> sb.append("&#39;");
        case '\n' -> sb.append("<br/>");
        case '\r' -> { }
        default -> { if (ch >= 0x20 || ch == '\t') sb.append(ch); }
      }
    }
    return sb.toString();
  }

  private static String doc(String d) {
    if (d == null) return null;
    String digits = d.replaceAll("\\D", "");
    return (digits.length() == 14 ? "CNPJ " : digits.length() == 11 ? "CPF " : "") + d;
  }

  private static String join(String sep, String... parts) {
    return String.join(sep, java.util.Arrays.stream(parts).filter(p -> p != null && !p.isBlank()).toList());
  }
}

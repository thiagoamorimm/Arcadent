package app.clinica.record;

import app.clinica.shared.ApiException;
import app.clinica.shared.Ctx;
import app.clinica.shared.Db;
import app.clinica.shared.Text;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Imagens e arquivos do paciente (fotos, radiografias, tomografias, STL, PDF). O tipo é conferido pelos
 * primeiros bytes do arquivo, não pelo nome. Download só pela API, com permissão, nunca link público.
 */
@RestController
@RequestMapping("/api")
public class FileController {
  private static final long MAX = 50L * 1024 * 1024;
  private final Db db;
  private final FileStore store;

  public FileController(Db db, FileStore store) {
    this.db = db;
    this.store = store;
  }

  public record PatientFile(UUID id, String kind, String fileName, String mimeType, long sizeBytes, LocalDate takenAt,
                            String uploadedBy, OffsetDateTime createdAt, UUID evolutionId) {}
  public record FilePatch(String kind, LocalDate takenAt, String fileName) {}

  private static final List<String> KINDS = List.of("photo", "xray", "ct", "stl", "pdf", "other");

  @GetMapping("/patients/{patientId}/files")
  public List<PatientFile> list(@PathVariable UUID patientId) {
    Ctx.current().requireClinical();
    return db.inClinic(() -> db.sql(SELECT + " where f.patient_id = ? and f.deleted_at is null order by coalesce(f.taken_at, f.created_at::date) desc, f.created_at desc")
        .param(patientId).query(PatientFile.class).list());
  }

  @PostMapping(path = "/patients/{patientId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  public PatientFile upload(@PathVariable UUID patientId, @RequestParam("file") MultipartFile file,
                            @RequestParam(required = false) String kind, @RequestParam(required = false) LocalDate takenAt,
                            @RequestParam(required = false) UUID evolutionId) throws IOException {
    Ctx c = Ctx.current();
    c.require("paciente.files");
    if (file.isEmpty()) throw ApiException.badRequest("EMPTY", "O arquivo está vazio.");
    if (file.getSize() > MAX) throw new ApiException(413, "TOO_LARGE", "Arquivo maior que 50 MB.");
    String name = safeName(file.getOriginalFilename());
    Detected d;
    try (InputStream in = new BufferedInputStream(file.getInputStream())) {
      d = detect(in, name);
    }
    if (d == null) throw new ApiException(415, "UNSUPPORTED", "Tipo de arquivo não aceito. Envie JPG, PNG, WEBP, PDF, STL ou DICOM.");
    String k = kind != null && KINDS.contains(kind) ? kind : d.kind();
    if (takenAt != null && takenAt.isAfter(LocalDate.now().plusDays(1))) throw ApiException.badRequest("DATE", "A data do exame não pode ser no futuro.");
    UUID id = UUID.randomUUID();
    String key = c.clinicId() + "/" + patientId + "/" + id + d.ext();
    return db.inClinic(() -> {
      boolean exists = db.sql("select exists(select 1 from patients where id = ? and deleted_at is null)").param(patientId).query(Boolean.class).single();
      if (!exists) throw ApiException.notFound("Paciente");
      // Anexo de evolução: a evolução precisa ser deste paciente e estar na ficha.
      if (evolutionId != null && !db.sql("select exists(select 1 from evolutions where id = ? and patient_id = ? and deleted_at is null)")
          .params(evolutionId, patientId).query(Boolean.class).single()) {
        throw ApiException.badRequest("EVOLUTION", "Essa evolução não é deste paciente.");
      }
      try (InputStream in = file.getInputStream()) {
        store.put(key, in);
      } catch (IOException e) {
        throw new IllegalStateException("Falha ao gravar arquivo", e);
      }
      db.sql("""
          insert into patient_files (id, clinic_id, patient_id, kind, storage_key, file_name, mime_type, size_bytes, taken_at, uploaded_by, evolution_id)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
          .params(id, c.clinicId(), patientId, k, key, name, d.mime(), file.getSize(), takenAt, c.userId(), evolutionId).update();
      return get(id);
    });
  }

  @GetMapping("/files/{id}/content")
  public ResponseEntity<InputStreamResource> content(@PathVariable UUID id, @RequestParam(defaultValue = "false") boolean download) throws IOException {
    Ctx c = Ctx.current();
    c.requireClinical();
    Map<String, Object> f = db.inClinic(() -> db.sql("select storage_key, file_name, mime_type, size_bytes from patient_files where id = ? and deleted_at is null")
        .param(id).query().listOfRows().stream().findFirst().orElseThrow(() -> ApiException.notFound("Arquivo")));
    var disposition = (download ? ContentDisposition.attachment() : ContentDisposition.inline())
        .filename((String) f.get("file_name"), java.nio.charset.StandardCharsets.UTF_8).build();
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType((String) f.get("mime_type")))
        .contentLength(((Number) f.get("size_bytes")).longValue())
        .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
        .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
        .header("X-Content-Type-Options", "nosniff")
        .body(new InputStreamResource(store.get((String) f.get("storage_key"))));
  }

  @PatchMapping("/files/{id}")
  public PatientFile patch(@PathVariable UUID id, @RequestBody FilePatch r) {
    Ctx.current().require("paciente.files");
    if (r.kind() != null && !KINDS.contains(r.kind())) throw ApiException.badRequest("KIND", "Tipo inválido.");
    return db.inClinic(() -> {
      if (db.sql("update patient_files set kind = coalesce(?, kind), taken_at = coalesce(?, taken_at), file_name = coalesce(?, file_name) where id = ? and deleted_at is null")
          .params(r.kind(), r.takenAt(), r.fileName() == null ? null : safeName(r.fileName()), id).update() == 0) {
        throw ApiException.notFound("Arquivo");
      }
      return get(id);
    });
  }

  /** Exclusão lógica: some da ficha, mas o arquivo fica guardado (prontuário). */
  @DeleteMapping("/files/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable UUID id) {
    Ctx c = Ctx.current();
    c.require("paciente.files");
    db.inClinic(() -> {
      if (db.sql("update patient_files set deleted_at = now() where id = ? and deleted_at is null").param(id).update() == 0) throw ApiException.notFound("Arquivo");
      db.sql("insert into audit_log (clinic_id, user_id, action, entity, entity_id) values (?, ?, 'file.delete', 'patient_file', ?)")
          .params(c.clinicId(), c.userId(), id).update();
    });
  }

  private static final String SELECT = """
      select f.id, f.kind, f.file_name, f.mime_type, f.size_bytes, f.taken_at, u.name uploaded_by, f.created_at, f.evolution_id
        from patient_files f left join users u on u.id = f.uploaded_by
      """;

  private PatientFile get(UUID id) {
    return db.sql(SELECT + " where f.id = ?").param(id).query(PatientFile.class).single();
  }

  record Detected(String mime, String ext, String kind) {}

  /** Identifica pelo conteúdo (assinatura de bytes). STL ASCII/binário só pela extensão + cabeçalho plausível. */
  static Detected detect(InputStream in, String name) throws IOException {
    in.mark(200);
    byte[] h = in.readNBytes(132);
    in.reset();
    String lower = name.toLowerCase();
    if (h.length >= 3 && (h[0] & 0xFF) == 0xFF && (h[1] & 0xFF) == 0xD8 && (h[2] & 0xFF) == 0xFF) return new Detected("image/jpeg", ".jpg", "photo");
    if (h.length >= 8 && (h[0] & 0xFF) == 0x89 && h[1] == 'P' && h[2] == 'N' && h[3] == 'G') return new Detected("image/png", ".png", "photo");
    if (h.length >= 12 && h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F' && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P') return new Detected("image/webp", ".webp", "photo");
    if (h.length >= 5 && h[0] == '%' && h[1] == 'P' && h[2] == 'D' && h[3] == 'F' && h[4] == '-') return new Detected("application/pdf", ".pdf", "pdf");
    if (h.length >= 132 && h[128] == 'D' && h[129] == 'I' && h[130] == 'C' && h[131] == 'M') return new Detected("application/dicom", ".dcm", "ct");
    if (lower.endsWith(".stl") && h.length >= 84) return new Detected("model/stl", ".stl", "stl");
    return null;
  }

  static String safeName(String n) {
    String s = n == null ? "arquivo" : n.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
    if (s.isEmpty()) s = "arquivo";
    return s.length() > 150 ? s.substring(s.length() - 150) : Text.blank(s);
  }
}

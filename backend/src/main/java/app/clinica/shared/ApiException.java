package app.clinica.shared;

/** Erro com status HTTP, código estável (o front decide pelo código) e mensagem para o usuário. */
public class ApiException extends RuntimeException {
  private final int status;
  private final String code;
  private final Object details;

  public ApiException(int status, String code, String message) {
    this(status, code, message, null);
  }

  /** details vai junto na resposta (ex.: a lista de horários em conflito). */
  public ApiException(int status, String code, String message, Object details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  public int status() { return status; }
  public String code() { return code; }
  public Object details() { return details; }

  public static ApiException notFound(String what) {
    return new ApiException(404, "NOT_FOUND", what + " não encontrado.");
  }

  public static ApiException badRequest(String code, String message) {
    return new ApiException(400, code, message);
  }
}

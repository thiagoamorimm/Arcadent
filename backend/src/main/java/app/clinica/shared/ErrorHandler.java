package app.clinica.shared;

import java.util.Map;
import org.postgresql.util.PSQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Resposta de erro sempre no formato {code, message}. Restrições do banco viram mensagens úteis. */
@RestControllerAdvice
public class ErrorHandler {
  private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

  /** constraint do schema → (status, código, mensagem) */
  private static final Map<String, Object[]> CONSTRAINTS = Map.of(
      "appt_no_overlap_professional", new Object[] {409, "APPOINTMENT_CONFLICT",
          "Este profissional já tem um horário marcado nesse intervalo."},
      "appt_no_overlap_chair", new Object[] {409, "CHAIR_CONFLICT",
          "Essa cadeira já está ocupada nesse intervalo."},
      "cash_one_open_per_account", new Object[] {409, "CASH_ALREADY_OPEN",
          "Já existe um caixa aberto para essa conta."},
      "debit_paid_le_amount", new Object[] {422, "OVERPAYMENT",
          "O valor recebido é maior que o saldo do débito."},
      "patients_cpf_uq", new Object[] {409, "CPF_TAKEN",
          "Já existe um paciente com esse CPF."},
      "users_email_uq", new Object[] {409, "EMAIL_TAKEN",
          "Já existe uma conta com esse e-mail."});

  record Body(String code, String message, Object details) {
    Body(String code, String message) { this(code, message, null); }
  }

  @ExceptionHandler(ApiException.class)
  ResponseEntity<Body> api(ApiException e) {
    return ResponseEntity.status(e.status()).body(new Body(e.code(), e.getMessage(), e.details()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<Body> invalid(MethodArgumentNotValidException e) {
    var f = e.getBindingResult().getFieldErrors().stream().findFirst();
    String msg = f.map(x -> x.getField() + ": " + x.getDefaultMessage()).orElse("Dados inválidos.");
    return ResponseEntity.badRequest().body(new Body("VALIDATION", msg));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<Body> unreadable(HttpMessageNotReadableException e) {
    return ResponseEntity.badRequest().body(new Body("VALIDATION", "Corpo da requisição inválido."));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<Body> integrity(DataIntegrityViolationException e) {
    Throwable c = e;
    while (c != null && !(c instanceof PSQLException)) c = c.getCause();
    if (c instanceof PSQLException p && p.getServerErrorMessage() != null) {
      String constraint = p.getServerErrorMessage().getConstraint();
      Object[] m = constraint == null ? null : CONSTRAINTS.get(constraint);
      if (m != null) {
        return ResponseEntity.status((int) m[0]).body(new Body((String) m[1], (String) m[2]));
      }
      log.warn("Violação de integridade não mapeada: {} / {}", constraint, p.getServerErrorMessage().getMessage());
    }
    return ResponseEntity.status(409).body(new Body("CONFLICT", "Não foi possível salvar: os dados conflitam com um registro existente."));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Body> unexpected(Exception e) {
    log.error("Erro inesperado", e);
    return ResponseEntity.status(500).body(new Body("INTERNAL", "Algo deu errado do nosso lado. Tente de novo em instantes."));
  }
}

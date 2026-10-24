package app.clinica.shared;

import java.util.List;
import java.util.UUID;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

/**
 * Quem está chamando. Montado a cada requisição pelo CtxFilter a partir do JWT (quem/qual clínica)
 * + o vínculo ATUAL no banco (papel, permissões, ativo). Assim, tirar uma permissão ou desativar
 * alguém vale na hora, sem esperar o token expirar.
 */
public record Ctx(UUID userId, UUID clinicId, UUID membershipId, String role, List<String> permissions, boolean attends) {

  static final String ATTR = Ctx.class.getName();

  public static Ctx current() {
    var attrs = RequestContextHolder.getRequestAttributes();
    Object c = attrs == null ? null : attrs.getAttribute(ATTR, RequestAttributes.SCOPE_REQUEST);
    if (!(c instanceof Ctx ctx)) {
      throw new ApiException(401, "UNAUTHENTICATED", "Faça login para continuar.");
    }
    return ctx;
  }

  public boolean isOwner() {
    return "owner".equals(role);
  }

  /** Dono tem tudo; os demais precisam da permissão no vínculo. */
  public boolean can(String permission) {
    return isOwner() || permissions.contains(permission);
  }

  /** Prontuário clínico: quem tem pelo menos uma permissão clínica (recepção, por padrão, não vê). */
  public void requireClinical() {
    if (!(can("paciente.anamnesis") || can("paciente.treatments") || can("paciente.documents")
        || can("paciente.files") || can("paciente.evolution_edit"))) {
      throw new ApiException(403, "FORBIDDEN", "O prontuário é restrito a quem atende. Fale com o responsável pela clínica.");
    }
  }

  public void require(String permission) {
    if (!can(permission)) {
      throw new ApiException(403, "FORBIDDEN", "Seu acesso não permite esta ação. Fale com o responsável pela clínica.");
    }
  }
}

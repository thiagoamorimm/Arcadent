package app.clinica.record;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Onde ficam os arquivos dos pacientes. Dev: disco local. Produção: implementar a mesma interface
 * sobre S3/R2 privado (a aplicação nunca expõe o arquivo direto; sempre passa pela API com permissão).
 */
public interface FileStore {
  void put(String key, InputStream in) throws IOException;
  InputStream get(String key) throws IOException;

  @Component
  class Local implements FileStore {
    private final Path root;

    public Local(@Value("${app.files-dir}") String dir) throws IOException {
      this.root = Path.of(dir).toAbsolutePath().normalize();
      Files.createDirectories(root);
    }

    private Path resolve(String key) {
      Path p = root.resolve(key).normalize();
      if (!p.startsWith(root)) throw new IllegalArgumentException("chave inválida");
      return p;
    }

    @Override
    public void put(String key, InputStream in) throws IOException {
      Path p = resolve(key);
      Files.createDirectories(p.getParent());
      Files.copy(in, p, StandardCopyOption.REPLACE_EXISTING);
    }

    @Override
    public InputStream get(String key) throws IOException {
      return Files.newInputStream(resolve(key));
    }
  }
}

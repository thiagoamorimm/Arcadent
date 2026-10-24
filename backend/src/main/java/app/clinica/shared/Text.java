package app.clinica.shared;

import java.util.Arrays;
import java.util.List;

public final class Text {
  private Text() {}

  /** null ou só espaços → null; senão, sem espaços nas pontas. */
  public static String blank(String s) {
    return s == null || s.isBlank() ? null : s.trim();
  }

  /** "M,O" (de array_to_string) → [M, O] */
  public static List<String> csv(String s) {
    return s == null || s.isEmpty() ? List.of() : Arrays.asList(s.split(","));
  }
}

package app.clinica.finance;

import java.util.ArrayList;
import java.util.List;

/** Valor em reais por extenso, para recibo: 56668 → "quinhentos e sessenta e seis reais e sessenta e oito centavos". */
public final class Extenso {
  private Extenso() {}

  private static final String[] UNI = {"", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
      "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"};
  private static final String[] DEZ = {"", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"};
  private static final String[] CEM = {"", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
      "setecentos", "oitocentos", "novecentos"};

  public static String reais(long cents) {
    if (cents < 0) throw new IllegalArgumentException("valor negativo");
    long r = cents / 100, c = cents % 100;
    String reais = r == 0 ? "" : inteiro(r) + (r == 1 ? " real" : (r % 1_000_000 == 0 ? " de reais" : " reais"));
    String cent = c == 0 ? "" : inteiro(c) + (c == 1 ? " centavo" : " centavos");
    if (r == 0 && c == 0) return "zero real";
    if (r == 0) return cent;
    if (c == 0) return reais;
    return reais + " e " + cent;
  }

  /** 1 a 999.999.999.999 por extenso. Grupos separados por espaço; "e" antes do último se ele for < 100 ou centena redonda. */
  static String inteiro(long n) {
    if (n == 0) return "zero";
    long[] g = {n / 1_000_000_000L % 1000, n / 1_000_000 % 1000, n / 1000 % 1000, n % 1000};
    String[][] nome = {{"bilhão", "bilhões"}, {"milhão", "milhões"}, {"mil", "mil"}, {"", ""}};
    List<String> partes = new ArrayList<>();
    List<Long> valores = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      if (g[i] == 0) continue;
      String txt = (i == 2 && g[i] == 1) ? "mil" : centena(g[i]) + (nome[i][0].isEmpty() ? "" : " " + (g[i] == 1 ? nome[i][0] : nome[i][1]));
      partes.add(txt);
      valores.add(i == 3 ? g[i] : -1L);
    }
    StringBuilder sb = new StringBuilder(partes.get(0));
    for (int i = 1; i < partes.size(); i++) {
      long v = valores.get(i);
      boolean e = i == partes.size() - 1 && v > 0 && (v < 100 || v % 100 == 0);
      sb.append(e ? " e " : " ").append(partes.get(i));
    }
    return sb.toString();
  }

  private static String centena(long n) {
    if (n == 100) return "cem";
    long c = n / 100, d = n % 100;
    List<String> p = new ArrayList<>();
    if (c > 0) p.add(CEM[(int) c]);
    if (d > 0) {
      if (d < 20) p.add(UNI[(int) d]);
      else p.add(DEZ[(int) (d / 10)] + (d % 10 == 0 ? "" : " e " + UNI[(int) (d % 10)]));
    }
    return String.join(" e ", p);
  }
}

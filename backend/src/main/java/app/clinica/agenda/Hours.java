package app.clinica.agenda;

import app.clinica.shared.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Horário semanal: {"mon":[["08:00","12:00"],["13:00","18:00"]], "tue":[...], ...}.
 * Usado no expediente da clínica e no horário de atendimento de cada profissional.
 * Dia ausente ou lista vazia = fechado. Horas no fuso da clínica.
 */
public final class Hours {
  private Hours() {}

  public static final List<String> DAYS = List.of("mon", "tue", "wed", "thu", "fri", "sat", "sun");
  private static final ObjectMapper JSON = new ObjectMapper();

  /** Valida e normaliza (ordena intervalos; rejeita formato errado, fim antes do início e sobreposição). */
  public static Map<String, List<List<String>>> validate(Map<String, List<List<String>>> in) {
    if (in == null) throw ApiException.badRequest("HOURS", "Informe os horários.");
    var out = new LinkedHashMap<String, List<List<String>>>();
    for (var e : in.entrySet()) {
      if (!DAYS.contains(e.getKey())) throw ApiException.badRequest("HOURS", "Dia inválido: " + e.getKey());
    }
    for (String d : DAYS) {
      List<List<String>> ranges = in.getOrDefault(d, List.of());
      if (ranges.size() > 4) throw ApiException.badRequest("HOURS", "No máximo 4 intervalos por dia.");
      var parsed = new ArrayList<LocalTime[]>();
      for (List<String> r : ranges) {
        if (r == null || r.size() != 2) throw ApiException.badRequest("HOURS", "Cada intervalo precisa de início e fim.");
        LocalTime a = parse(r.get(0)), b = parse(r.get(1));
        if (!b.isAfter(a) && !"24:00".equals(r.get(1))) throw ApiException.badRequest("HOURS", "O fim precisa ser depois do início (" + r.get(0) + "–" + r.get(1) + ").");
        parsed.add(new LocalTime[] {a, "24:00".equals(r.get(1)) ? LocalTime.MAX : b});
      }
      parsed.sort((x, y) -> x[0].compareTo(y[0]));
      for (int i = 1; i < parsed.size(); i++) {
        if (parsed.get(i)[0].isBefore(parsed.get(i - 1)[1])) throw ApiException.badRequest("HOURS", "Os intervalos de " + label(d) + " se sobrepõem.");
      }
      out.put(d, parsed.stream().map(p -> List.of(fmt(p[0]), p[1] == LocalTime.MAX ? "24:00" : fmt(p[1]))).toList());
    }
    return out;
  }

  public static String toJson(Map<String, List<List<String>>> h) {
    try { return JSON.writeValueAsString(h); } catch (Exception e) { throw new IllegalStateException(e); }
  }

  public static Map<String, List<List<String>>> fromJson(String json) {
    if (json == null || json.isBlank()) return Map.of();
    try { return JSON.readValue(json, new TypeReference<>() {}); } catch (Exception e) { return Map.of(); }
  }

  /** true se [start,end) cabe inteiro em algum intervalo do dia (horário local da clínica). Sem horário cadastrado = sem restrição. */
  public static boolean fits(Map<String, List<List<String>>> h, ZonedDateTime start, ZonedDateTime end) {
    if (h == null || h.isEmpty() || h.values().stream().allMatch(List::isEmpty)) return true;
    if (!start.toLocalDate().equals(end.minusNanos(1).toLocalDate())) return false;
    String key = key(start.getDayOfWeek());
    LocalTime s = start.toLocalTime(), e = end.toLocalTime();
    boolean endsMidnight = e.equals(LocalTime.MIDNIGHT);
    for (List<String> r : h.getOrDefault(key, List.of())) {
      LocalTime a = parse(r.get(0));
      boolean openTillMidnight = "24:00".equals(r.get(1));
      LocalTime b = openTillMidnight ? LocalTime.MAX : parse(r.get(1));
      if (!s.isBefore(a) && (endsMidnight ? openTillMidnight : !e.isAfter(b))) return true;
    }
    return false;
  }

  public static String key(DayOfWeek d) {
    return DAYS.get(d.getValue() - 1);
  }

  public static void validZone(String tz) {
    try { ZoneId.of(tz); } catch (Exception e) { throw ApiException.badRequest("TIMEZONE", "Fuso horário inválido: " + tz); }
  }

  private static String label(String d) {
    return switch (d) {
      case "mon" -> "segunda"; case "tue" -> "terça"; case "wed" -> "quarta"; case "thu" -> "quinta";
      case "fri" -> "sexta"; case "sat" -> "sábado"; default -> "domingo";
    };
  }

  private static LocalTime parse(String s) {
    if (s == null || !s.matches("([01]\\d|2[0-3]):[0-5]\\d|24:00")) throw ApiException.badRequest("HOURS", "Horário inválido: " + s + " (use HH:MM).");
    return "24:00".equals(s) ? LocalTime.MAX : LocalTime.parse(s);
  }

  private static String fmt(LocalTime t) {
    return String.format("%02d:%02d", t.getHour(), t.getMinute());
  }
}

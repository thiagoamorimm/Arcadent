package app.clinica.finance;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ExtensoTest {
  @Test
  void casos() {
    assertEquals("zero real", Extenso.reais(0));
    assertEquals("um centavo", Extenso.reais(1));
    assertEquals("um real", Extenso.reais(100));
    assertEquals("dois reais e cinquenta centavos", Extenso.reais(250));
    assertEquals("quinhentos e sessenta e seis reais e sessenta e oito centavos", Extenso.reais(56668));
    assertEquals("cem reais", Extenso.reais(10000));
    assertEquals("cento e um reais", Extenso.reais(10100));
    assertEquals("mil reais", Extenso.reais(100000));
    assertEquals("mil e cem reais", Extenso.reais(110000));
    assertEquals("mil e cinco reais", Extenso.reais(100500));
    assertEquals("mil e setecentos reais", Extenso.reais(170000));
    assertEquals("mil duzentos e trinta e quatro reais", Extenso.reais(123400));
    assertEquals("dois mil e quinhentos reais", Extenso.reais(250000));
    assertEquals("dezenove mil novecentos e noventa e nove reais e noventa e nove centavos", Extenso.reais(1999999));
    assertEquals("um milhão de reais", Extenso.reais(100000000));
    assertEquals("dois milhões trezentos mil e quinhentos reais", Extenso.reais(230050000));
    assertEquals("um milhão e um reais", Extenso.reais(100000100));
  }
}

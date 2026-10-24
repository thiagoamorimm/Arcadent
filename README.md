<div align="center">

<img src="frontend/public/brand/logo.png" alt="Arcadent" width="96" />

# Arcadent

**A clínica odontológica inteira num lugar só: agenda, prontuário com odontograma, orçamentos, financeiro, prótese, estoque e indicadores.**

Feito para a recepção marcar rápido, para o dentista registrar sem burocracia e para o dono enxergar o negócio.

![Java 21](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white)
![Spring Boot 3.5](https://img.shields.io/badge/Spring_Boot-3.5-6DB33F?logo=springboot&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Testes](https://img.shields.io/badge/testes-76_e2e_%2B_320_API-0f6b63)
![Acessibilidade](https://img.shields.io/badge/WCAG_2.1-AA-0f6b63)

<br />

<img src="docs/screenshots/02-agenda-semana.png" alt="Agenda da semana do Arcadent" width="100%" />

</div>

---

## Por que Arcadent

| | |
| --- | --- |
| 🗓️ **Agenda que não deixa marcar errado** | Conflito de horário é barrado pelo próprio banco de dados, com aviso de *com quem* conflita e a opção consciente de encaixe. Marcar paciente novo leva 3 cliques. |
| 🦷 **Odontograma de verdade** | Desenho anatômico de cada dente (permanentes e decíduos), planejado em vermelho e realizado em azul, faces por botão e anotações por dente. |
| 💸 **Do orçamento ao recibo sem planilha** | Orçamento aprovado (inteiro ou só parte) vira tratamentos e parcelas sozinho. Recebimento parcial, recibo numerado sem buraco, fluxo de caixa pelo dia em que o dinheiro entrou. |
| 📈 **Números que viram ação** | Faltas, conversão de orçamentos, ticket médio e receitas × despesas comparados com o período anterior, mais o painel do dia: aniversariantes, inadimplentes e quem está com tratamento parado. |
| 🔒 **Feito para dado de saúde (LGPD)** | Cada clínica isolada no banco (Row Level Security), permissões por pessoa, prontuário que não se apaga e auditoria de quem abriu cada ficha. |
| 📱 **Funciona no celular** | Todas as telas foram testadas em 390 px, sem rolagem lateral. |

---

## Tour pelas telas

### Agenda

Visão de semana ou de dia, por profissional ou todos lado a lado, no fuso horário da clínica (horário de verão incluso). Status do atendimento, rótulos coloridos, compromissos e bloqueios, aviso de fora do expediente, duplicar consulta para a semana seguinte.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/03-agenda-dia.png" alt="Agenda do dia por profissional" /></td>
    <td width="50%"><img src="docs/screenshots/04-nova-consulta.png" alt="Marcar consulta com cadastro rápido de paciente" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Dia, com os profissionais lado a lado</sub></td>
    <td align="center"><sub>Marcar consulta (paciente novo cadastrado ali mesmo)</sub></td>
  </tr>
</table>

### Pacientes e ficha clínica

Busca por nome, celular ou CPF. A ficha reúne dados (com responsável para menores), alertas clínicos vindos da anamnese, próxima consulta e saldo devedor no topo.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/05-pacientes.png" alt="Lista de pacientes com filtros por coluna" /></td>
    <td width="50%"><img src="docs/screenshots/06-ficha-paciente.png" alt="Ficha do paciente com alerta de alergia" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Lista com filtro e ordenação em cada coluna</sub></td>
    <td align="center"><sub>Ficha com alerta clínico sempre visível</sub></td>
  </tr>
</table>

### Odontograma, orçamento e tratamentos

Marque os dentes no desenho, escolha as faces por botão e o procedimento da tabela de preços. Aprovar o orçamento (inteiro ou só os itens aceitos) lança os tratamentos e as parcelas. Tratamento pode ser editado ou excluído, sempre com histórico de quem fez, quando e o que mudou.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/07-odontograma-tratamentos.png" alt="Odontograma de acompanhamento" /></td>
    <td width="50%"><img src="docs/screenshots/08-novo-orcamento.png" alt="Montando orçamento no odontograma" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Acompanhamento: planejado, realizado e anotações</sub></td>
    <td align="center"><sub>Orçamento: dentes, faces, desconto e parcelas</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/09-orcamentos.png" alt="Orçamentos do paciente" /></td>
    <td width="50%"><img src="docs/screenshots/28-pdf-orcamento.png" alt="PDF do orçamento para o paciente" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Aprovar tudo, aprovar parte ou reprovar com motivo</sub></td>
    <td align="center"><sub>PDF do orçamento com papel timbrado</sub></td>
  </tr>
</table>

### Prontuário

Anamnese a partir de modelos da clínica (as respostas de risco viram alertas na ficha), evoluções com imagens anexadas, receitas e atestados em PDF com papel timbrado, e galeria de radiografias e fotos. Prontuário não é apagado de verdade: correções ficam no histórico.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/10-anamnese.png" alt="Anamnese do paciente" /></td>
    <td width="50%"><img src="docs/screenshots/11-evolucoes.png" alt="Evoluções clínicas" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/12-imagens.png" alt="Imagens e radiografias" /></td>
    <td width="50%"><img src="docs/screenshots/26-pdf-receita.png" alt="Receita em PDF" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Radiografias e fotos, com visualizador</sub></td>
    <td align="center"><sub>Receita em PDF com papel timbrado</sub></td>
  </tr>
</table>

### Financeiro

Débitos do paciente (parcelados, avulsos, recebimento total ou parcial, à prova de duplo clique), recibo numerado em nome do paciente ou do responsável, fluxo de caixa com despesas e receitas sem vínculo, exportação para planilha.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/13-debitos.png" alt="Débitos do paciente" /></td>
    <td width="50%"><img src="docs/screenshots/14-fluxo-de-caixa.png" alt="Fluxo de caixa do mês" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/15-recibos.png" alt="Recibos emitidos" /></td>
    <td width="50%"><img src="docs/screenshots/27-pdf-recibo.png" alt="Recibo em PDF com valor por extenso" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Recibos numerados</sub></td>
    <td align="center"><sub>Recibo em PDF com valor por extenso</sub></td>
  </tr>
</table>

### Indicadores

Desempenho do período comparado ao anterior, gráfico de receitas × despesas de 6 meses (com versão em tabela) e produção por profissional. O painel do dia mostra para quem ligar hoje.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/16-indicadores.png" alt="Indicadores de desempenho" /></td>
    <td width="50%"><img src="docs/screenshots/17-painel-do-dia.png" alt="Painel do dia" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Faltas, conversão, ticket médio, recebido</sub></td>
    <td align="center"><sub>Aniversariantes, inadimplência, tratamento parado</sub></td>
  </tr>
</table>

### Prótese e estoque

Quadro de prótese em 5 etapas (pré-laboratório → envio → laboratório → prova → realizado) com prazo por etapa e alerta de atraso. Estoque com mínimo para repor, entradas, saídas e ajustes com motivo e histórico.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/18-protese.png" alt="Controle de prótese" /></td>
    <td width="50%"><img src="docs/screenshots/19-estoque.png" alt="Controle de estoque" /></td>
  </tr>
</table>

### Equipe, permissões e auditoria

Convide dentistas e recepção por link, comece de um perfil pronto e ajuste permissão por permissão (vale na hora, sem a pessoa sair). A auditoria mostra quem fez o quê e quem abriu cada ficha, e não pode ser alterada.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/21-permissoes.png" alt="Permissões por pessoa" /></td>
    <td width="50%"><img src="docs/screenshots/22-auditoria.png" alt="Trilha de auditoria" /></td>
  </tr>
</table>

### No celular

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/23-celular-agenda.png" alt="Agenda no celular" /></td>
    <td width="33%"><img src="docs/screenshots/24-celular-ficha.png" alt="Ficha e odontograma no celular" /></td>
    <td width="33%"><img src="docs/screenshots/25-celular-financeiro.png" alt="Financeiro no celular" /></td>
  </tr>
</table>

---

## Planos

| | |
| --- | --- |
| **Tudo liberado** | Todas as funcionalidades em todos os planos |
| **Preço** | R$ 99/mês pelo 1º dentista + R$ 49/mês por dentista adicional. Recepção e secretária não pagam |
| **Teste grátis** | 14 dias, sem cartão |
| **Anual** | 2 meses grátis |

Assinatura vencida não apaga nada: a clínica entra em **modo leitura** (consulta tudo, não lança nada novo) até regularizar.

---

## Segurança e privacidade

- **Isolamento por clínica no banco**: toda tabela tem Row Level Security no PostgreSQL. Mesmo com um erro no código, uma clínica não enxerga dados de outra.
- **Permissões finas**, conferidas no servidor a cada requisição. Tirar uma permissão vale na hora.
- **Prontuário imutável**: anamnese concluída, documentos emitidos e evoluções não se apagam de verdade; edições guardam o antes e o depois.
- **Auditoria só de inclusão** (a aplicação não consegue alterar nem apagar), incluindo abertura de ficha.
- **Sessão segura**: token de acesso curto, token de renovação trocado a cada uso com detecção de reuso, senhas com Argon2id, recuperação de senha por link de uso único.
- **Dinheiro sem duplicar**: recebimentos idempotentes e recibos numerados na mesma transação.

---

## Tecnologia

| Camada | |
| --- | --- |
| Backend | Java 21, Spring Boot 3.5, JDBC (sem ORM), Flyway, OpenHTMLtoPDF |
| Banco | PostgreSQL 16 com Row Level Security por clínica |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4 (tokens próprios), Radix UI, TanStack Query |
| Testes | Playwright + axe (acessibilidade) em 76 cenários de navegador; 320 checagens de API |

```
backend/    API Spring Boot (pacotes por área: agenda, patient, budget, finance, record, stock, prosthesis, insight…)
frontend/   app React (pages/, domain/, ui/)
db/init/    criação das roles do banco
e2e/        testes de navegador (Playwright)
scripts/    testes de API, massa de dados de demonstração e geração dos prints
docs/       prints desta página
```

---

## Rodando localmente

Pré-requisitos: Docker, Java 21 + Maven, Node 20+.

```bash
# 1. banco
docker compose up -d db

# 2. API (porta 8090) — o perfil dev guarda os e-mails numa caixa de saída local
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev

# 3. app (porta 5180)
cd frontend && npm install && npm run dev
```

Crie uma conta em http://localhost:5180/criar-conta. Para popular uma clínica de demonstração com ~5 meses de uso (pacientes, agenda, orçamentos, financeiro, estoque, prótese), cadastre a conta de teste descrita em `scripts/dev-accounts.example.json` e rode:

```bash
node scripts/seed-demo.mjs --reset
```

Testes:

```bash
node scripts/smoke-api.mjs            # e as demais scripts/smoke-*.mjs
cd e2e && npm install && npx playwright install chromium && npx playwright test
```

---

## Próximos passos

- Pagamento da assinatura online (provedor a definir) e envio de e-mail em produção
- Fechamento de caixa e comissões por profissional
- Fila de encaixe, alerta de retorno e link público de agendamento
- Anamnese preenchida pelo paciente por link, com assinatura eletrônica
- Confirmação de consulta por WhatsApp

<div align="center">
<br />
<img src="frontend/public/brand/logo.png" alt="" width="40" />
<br />
<sub>Arcadent © 2026</sub>
</div>

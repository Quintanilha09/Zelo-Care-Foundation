# ZELO — Extensão B2B Institucional

> **Status:** Proposta v0.1 — **não faz parte do MVP**
> **Criado em:** 18/08/2026
> **Origem:** ideia do fundador — asilos, casas de recuperação e serviços de cuidado como clientes, com comprovação de que a medicação foi de fato administrada
> **Decidido em 18/08/2026:** **hospital está fora.** Ver §3.
> **Depende de:** Fases 01 a 07 concluídas (`planning/ROADMAP.md`)
> **Pasta do Vault:** `Pessoal/Projetos/Apps Replit/Zelo`

> [!warning] Este documento é uma tese, não um backlog
> Nada aqui altera as Fases 01 a 10. Ele existe para que a decisão seja tomada com o problema inteiro na mesa — inclusive as partes que a ideia original não previa, que são as caras. As referências regulatórias precisam de validação jurídica antes de virar promessa comercial.

---

## 1. A tese em uma frase

Quando o cuidado é terceirizado, a família perde exatamente aquilo que o ZELO entrega: a certeza de que foi feito. O ZELO institucional devolve essa certeza — e quem paga é a instituição, porque isso vira o argumento de venda dela, não um custo.

---

## 2. Por que é extensão natural, e onde ela deixa de ser

**O que já serve, sem mudança de conceito:**

- O produto já responde "está tudo em dia?" para uma família cujo cuidador é outra pessoa. Trocar "a irmã Ana" por "a técnica de enfermagem Ana" não muda o modelo mental do usuário que lê a tela.
- O papel **Observador** (§2.2 da spec) já existe e já é o vetor de crescimento orgânico. Na instituição, a família inteira é Observadora por padrão — é o caso de uso puro do papel.
- A **trilha de auditoria imutável** (REQ-005) já é requisito desde a Fase 02. No B2C ela é higiene de LGPD; no B2B ela é o produto que está sendo vendido.
- O tom "nunca culpar" e a proibição de gamificação (CON-011, CON-012) já protegem contra o pior instinto de um produto de fiscalização.

**A diferença que muda tudo:**

No B2C, quem registra a dose e quem lê o registro são a mesma pessoa, ou pessoas do mesmo lado. No B2B, **quem registra é fiscalizado por quem lê** — e as duas partes têm interesses que podem divergir. Isso introduz três problemas que o produto atual não tem:

1. O registro precisa de **valor probatório**, não só de rastreabilidade.
2. O profissional registrado vira **sujeito monitorado**, com direitos próprios.
3. A instituição vira **cliente pagante com interesse em como o dado aparece** para a família.

Todo o trabalho novo está nesses três pontos. O resto é reaproveitamento.

---

## 3. Os segmentos não são o mesmo negócio — e hospital está fora

| Segmento | Quem decide a compra | Quem registra a dose | O que a família quer ver | Barreira | Atratividade |
|---|---|---|---|---|---|
| **ILPI (asilo / casa de repouso)** | Dono ou administrador — decisão de uma pessoa | Técnico de enfermagem, cuidador formal | Se o remédio foi dado, se a mãe comeu, se saiu do quarto | Vigilância sanitária municipal, RDC da Anvisa para ILPI | **Alta — porta de entrada** |
| **Home care / agência de cuidadores** | Dono da agência | Cuidador na casa do paciente | Se o cuidador chegou, ficou e deu o remédio | Baixa. Relação trabalhista mais frágil | Alta — segundo alvo |
| **Casa de recuperação / comunidade terapêutica** | Direção | Monitor, enfermagem | Adesão a psicotrópico, presença, rotina | **Medicamento controlado** e população em situação de vulnerabilidade jurídica | Média — cuidado redobrado |

> **Decisão de 18/08/2026 — hospital não é nicho do ZELO.** Compra por processo formal com TI, suprimentos e compliance; já tem prontuário eletrônico regulado, que o ZELO colidiria em vez de complementar; e a internação é curta, então a família nunca chega a formar hábito. Parecia o cliente grande e é o mais caro de conquistar e o mais perigoso de servir. Está fora do escopo desta extensão, não adiado.

> **Porta de entrada: ILPI.** A dor é a mais aguda — a família literalmente não vê nada, e o setor carrega desconfiança histórica. A decisão de compra é de uma pessoa só, o ciclo de venda é curto, e não existe sistema incumbente para deslocar. Home care é o segundo alvo natural: mesmo produto, mesma evidência, só que o "leito" é a casa do paciente.

---

## 4. O que "comprovação" pode significar — e o que não pode

Esta é a parte da ideia original que mais precisa de refino.

### 4.1 A foto não prova o que parece provar

Uma foto do paciente com o comprimido na mão prova que **alguém entregou um comprimido**. Não prova que era o medicamento certo, não prova a dose, e principalmente **não prova ingestão**. Vender isso como "comprovação" cria uma promessa que o produto não sustenta — e é exatamente o tipo de promessa que vira processo quando algo dá errado.

O que dá valor probatório de verdade não é o pixel: é a **cadeia de custódia**. Identidade autenticada + carimbo de tempo do servidor + prova de presença física + imutabilidade. A foto, quando entra, é um reforço dessa cadeia — nunca o alicerce dela.

### 4.2 Escada de evidência

| Nível | O que é | O que efetivamente prova | Atrito para a equipe | Sensibilidade do dado |
|---|---|---|---|---|
| **N0** | Registro nominal autenticado *(já existe hoje)* | Que uma pessoa identificada afirmou ter administrado | Nenhum | Baixa |
| **N1** | N0 + carimbo de tempo do servidor + vínculo com a escala do turno | Que a afirmação veio de quem estava de plantão, no horário em que estava | Nenhum | Baixa |
| **N2** | N1 + **prova de presença**: QR ou NFC no leito / na pulseira, lido no momento da dose | Que o profissional estava **fisicamente junto do paciente** naquele minuto | 1 toque | Baixa |
| **N3** | N2 + foto da **dose preparada** (blister, copo, sachê) — sem pessoa no enquadramento | Que a dose correspondente foi separada | 1 foto | Média |
| **N4** | N2 + foto **com o paciente** | Que houve entrega presencial | 1 foto | **Alta** |

> **Recomendação: o padrão do produto é N2.**
> É o nível que produz o salto de confiança que a família realmente busca — a dúvida dela é "essa pessoa esteve no quarto?", não "como era o comprimido". Custa um toque, não custa dignidade, e não cria passivo de imagem. É também o princípio que o setor hospitalar já usa: leitura de código de barras à beira do leito (BCMA), que existe para sustentar os cinco certos da administração.
>
> **N3 é opcional, configurável por instituição.**
> **N4 é opt-in por paciente**, com consentimento específico do titular ou do representante legal, revogável a qualquer momento, e **nunca pré-requisito para registrar a dose** — se a câmera falhar, o registro acontece do mesmo jeito. Nenhuma dose fica sem registro por causa de evidência.

### 4.3 Se a foto for ativada, o que a torna confiável

- **Captura só pela câmera do app**, sem seleção da galeria. Reaproveitar foto antiga é a fraude óbvia e é a primeira que aparece.
- **Carimbo de tempo é do servidor**, jamais do relógio do dispositivo.
- **Hash da imagem gravado na trilha imutável** no momento do upload — substituir o arquivo depois fica detectável.
- **Retenção curta e definida** (sugestão: 90 dias) com descarte automático. Foto de pessoa vulnerável armazenada indefinidamente é passivo, não ativo.
- A foto é **anexo do registro**, nunca substituto dele.
- Nada de dado de saúde em URL; acesso por link assinado e expirável, como já vale para a foto de receita (§3.5 da spec).

### 4.4 Três coisas que o ZELO nunca faz aqui

Extensão direta do invariante 3 — o produto não faz medicina:

- **Nenhum reconhecimento facial.** Biometria é categoria própria de dado sensível e o ganho é nulo perto do risco.
- **Nenhuma IA olhando a foto para decidir se a dose foi tomada.** Isso é interpretação clínica automatizada, viola CON-001 e CON-003, e um falso positivo aqui é um dano real com carimbo do ZELO.
- **Nenhuma inferência de comportamento do paciente** a partir de imagem ou de padrão de registro.

---

## 5. O outro lado: o profissional não é suspeito

A ideia original enxerga a família e a instituição. Falta o terceiro personagem, que é quem decide se o produto funciona: **a pessoa que registra**.

Um produto que a equipe sente como vigilância é sabotado em uma semana — registro em lote no fim do turno, QR do leito fotografado e colado na parede da sala de medicação, dado que apodrece. E dado que apodrece é a morte anunciada do princípio 2 da §4.1 da spec.

**Regras que precisam existir desde o primeiro dia:**

- **O profissional vê exatamente o que a família vê.** Nenhuma tela oculta, nenhum relatório que ele não possa abrir.
- **Sem ranking, placar ou métrica de adesão individual por profissional.** CON-012 já proíbe gamificação para famílias; aqui ela precisa valer explicitamente para a equipe.
- **A dose não administrada tem justificativa de primeira classe**, não é exceção envergonhada: paciente recusou, paciente dormindo, dose suspensa por ordem médica, paciente fora da unidade. **A recusa do paciente é um direito dele, não uma falha do profissional** — e a família precisa ler isso com esse enquadramento na tela.
- **Geolocalização, se existir, é grossa e confirmatória** (dentro ou fora da unidade), nunca rastro contínuo. Localização de trabalhador é dado pessoal e o histórico dele é passivo trabalhista.
- **O contrato com a instituição define o que ela pode fazer com o dado da equipe.** Isso é cláusula jurídica, não configuração de produto.

> Esse cuidado não é só ética — é qualidade do dado. O registro honesto é o único que tem valor, e ele só acontece se registrar a verdade for seguro para quem registra.

---

## 6. Conta institucional: e-mail corporativo não é o controle antifraude

A segunda parte da ideia original está certa no problema e insuficiente na solução. Domínio corporativo prova muito pouco: qualquer pessoa registra `casaderepousosaojose.com.br` por algumas dezenas de reais. Bloquear Gmail e Hotmail é higiene de cadastro, não antifraude.

A verificação que funciona tem três camadas, e cada uma responde a uma pergunta diferente:

**1. A pessoa jurídica existe e é o que diz ser**
- CNPJ ativo, com atividade compatível.
- Para quem é registrado como estabelecimento de saúde — clínica, comunidade terapêutica, empresa de atenção domiciliar: registro no **CNES** (Cadastro Nacional de Estabelecimentos de Saúde), conferido contra o CNPJ. É o filtro mais forte e mais barato disponível no Brasil, quando se aplica.
- Para ILPI, atenção: muitas não constam no CNES porque são registradas como assistência social, não como estabelecimento de saúde. Ali o documento certo é o **alvará sanitário municipal** e o registro no conselho municipal do idoso. Isso precisa ser confirmado caso a caso — é mais um motivo para o cadastro institucional não ser automático.

**2. Quem está abrindo a conta fala pela instituição**
- Verificação de controle do domínio por registro DNS TXT — prova que quem cadastra administra o domínio.
- E-mail dentro do domínio verificado.
- Documento de designação assinado pelo responsável legal, arquivado.

**3. Quem registra a dose é um profissional**
- Número de conselho (COREN, CRM, CRF) no cadastro do profissional, validado na ativação.
- **Exibido ao lado do registro.** É isto que a família de fato quer ver: não "✓ Tomou — Ana", mas "✓ Tomou — Ana Souza, Téc. Enf., COREN-SP 123456, 14:02".

> **A decisão de produto que resolve fraude por construção: conta institucional não é self-service no v1.**
> Cadastro vira solicitação → verificação manual → ativação. Um asilo por semana é volume perfeitamente humano de tratar, e cliente B2B que passa por onboarding assistido converte melhor e cancela menos. Self-service só quando o volume justificar e a verificação estiver automatizada — nunca antes.

SSO corporativo (Google Workspace, Microsoft Entra) entra quando aparecer o primeiro cliente que tem TI própria. Não antes.

---

## 7. Modelo de dados — a única decisão realmente cara

Hoje a **Família** é o tenant raiz, `familyId` é escopo obrigatório em toda consulta (REQ-002), consulta sem ele não compila, recurso de outra família devolve 404 (CON-014), e existe suíte automatizada de isolamento que cresce sozinha (REQ-003). Isso é o invariante 2 do produto e não pode ser afrouxado.

**O erro caro seria criar um segundo tenant paralelo.** Uma árvore "Instituição" ao lado da árvore "Família" duplica a lógica de autorização, duplica a suíte de isolamento, e cria exatamente a costura por onde dado vaza entre contas.

**Modelagem recomendada — um tenant só, com tipo:**

```
Organização { tipo: familia | instituicao }
  └─ Unidade (ala, andar, casa)        [só instituição]
       └─ Leito / Quarto                [só instituição]
Paciente ─ N:N ─ Organização (com papel do vínculo)
  ├─ vínculo com a instituição  → quem registra
  └─ vínculo com a família      → quem observa
Escala: profissional × unidade × janela de tempo
```

A mudança estrutural real é uma só: **`paciente.familyId` vira uma relação N:N entre paciente e organização.** O paciente institucional pertence a dois círculos ao mesmo tempo — a unidade que administra e a família que acompanha. Renomear Família para Organização é migration barata; a relação N:N não é.

> **Recomendação de sequenciamento, sem meio-termo: não implementar nada disso agora, e não fazer hedge de schema.**
>
> **Por quê:** a restrição dominante do projeto é crédito, e construir estrutura para um cliente que ainda não existe é a forma mais cara de errar. O B2C ainda não foi provado. O custo da migração depois é real, mas é conhecido e limitado — e é menor do que o custo de carregar abstração especulativa por 20 histórias.
>
> **O que dá para fazer de graça agora:** não criar dependências novas e duras de `familyId` além das que já existem, e tratar "família" como nome de exibição, não como conceito espalhado por regra de negócio.

---

## 8. Monetização

| Item | Modelo | Por quê |
|---|---|---|
| Unidade de cobrança | **Por leito ativo/mês** | A instituição já pensa em leito. E o valor não explode quando quatro irmãos entram na conta |
| Acesso da família | **Incluído e ilimitado** | É o produto que a instituição está comprando. Cobrar do familiar aqui destrói a proposta |
| Contrato | Anual, com piso mínimo | Previsibilidade, e filtra piloto eterno |
| Implantação | **Onboarding pago** — cadastrar pacientes, emitir os QR de leito, treinar a equipe | É o que separa cliente sério de curioso, e é trabalho real |
| Sequência | ILPI → home care → casa de recuperação | Ver §3. Hospital está fora |

> **O vetor não óbvio, e talvez o mais valioso:** cada família que convive com o ZELO dentro do asilo é um cadastro B2C provável quando o parente sair de lá, e é um "por que a casa de repouso do meu pai não tem isso?" circulando no mercado. **O B2B institucional é o canal de aquisição B2C mais barato do portfólio** — a instituição paga para distribuir o produto para o público que a gente quer alcançar.

---

## 9. Riscos novos — maiores que os do B2C

| Risco | Severidade | Mitigação |
|---|---|---|
| Virar o sistema de **registro oficial** da instituição, entrando em terreno de prontuário eletrônico regulado | **Crítica** | Posicionamento explícito em contrato e em produto: o ZELO é **camada de transparência para a família**, não o sistema de administração de medicamento da instituição, que mantém o registro oficial dela. Virar sistema de registro é outro projeto, com certificação e jurídico próprios |
| A foto vira falsa sensação de prova e alguém processa a instituição — ou o ZELO — com base nela | Alta | Nunca usar a palavra "comprovação de ingestão". Vocabulário do produto: **"registro verificado"**. Texto na tela dizendo o que o registro prova e o que não prova |
| Vazamento de imagem de pessoa idosa ou em tratamento | **Crítica** | N2 como padrão, N4 opt-in e revogável, retenção curta com descarte real, link assinado e expirável, hash na auditoria |
| Equipe burla o registro (lote no fim do turno, QR na parede da sala) | Alta | Prova de presença por **leito**, não por unidade; janela de registro apertada; padrão de registro em lote vira **sinal operacional para o gestor**, jamais punição automática |
| Conflito trabalhista — produto usado como instrumento de vigilância | Alta | §5 inteira, mais cláusula contratual e validação jurídica |
| Instituição pedir que o ZELO **suavize ou esconda** dose perdida da família | **Crítica** | **Não negociável: a instituição não configura o que a família vê sobre o registro de dose.** Se isso for deal-breaker de venda, esse cliente não é nosso |
| Medicamento controlado em casa de recuperação | Alta | CON-006 continua valendo integralmente. Nenhuma automação de recompra, nenhuma exceção |
| Concentração de receita em poucos contratos | Média | Muitos clientes pequenos antes de um grande |
| Suporte B2B (SLA, treinamento, ligação de gestor) para fundador solo | Alta | Teto explícito de clientes até existir operação; onboarding pago filtra volume |

---

## 10. Onde isso entra no roadmap

**Nada muda nas Fases 01 a 10.** Isto vira a **Fase 11 — Cuidado Institucional**, pós-MVP, com **gatilho de execução medido**, no mesmo padrão que o roadmap já usa para o app nativo:

> Só iniciar a Fase 11 se pelo menos um for verdade:
> - O B2C provou retenção — as métricas de D30/D90 da §6 batem com o alvo em uma base real; **ou**
> - Existe um cliente institucional concreto que assinou carta de intenção ou pagou um piloto.
>
> **Construir B2B no escuro, sem cliente na mão, é a forma mais cara de errar que existe neste projeto.**

**As histórias estão no Plane** (18/08/2026), no módulo **E10 — Cuidado Institucional**, `ZELO-43` a `ZELO-55`, em ordem numérica estrita como todo o resto do projeto:

| # | História | Natureza |
|---|---|---|
| ZELO-43 | Portão comercial: cliente pagante antes de qualquer código | `sem-codigo` |
| ZELO-44 | Portão jurídico: enquadramento, contrato e base legal do B2B | `sem-codigo` |
| ZELO-45 | Organização como tenant com tipo, e o paciente em dois círculos | A migration cara |
| ZELO-46 | Unidade, leito e alocação do residente | |
| ZELO-47 | Cadastro institucional verificado, sem self-service | Antifraude |
| ZELO-48 | Profissional com credencial de conselho, visível no registro | |
| ZELO-49 | Escala e turno, e o registro carimbado pelo plantão | N1 |
| ZELO-50 | Prova de presença por QR no leito | **N2 — o coração da fase** |
| ZELO-51 | Não administrada com justificativa, como campo de primeira classe | Protege a honestidade do dado |
| ZELO-52 | Evidência por foto: opcional, consentida, com descarte real | N3/N4 |
| ZELO-53 | A tela da família quando o cuidado é institucional | O que a instituição compra |
| ZELO-54 | Painel do gestor, sem métrica individual | |
| ZELO-55 | Faturamento por leito ativo | Manual até doer |

> **Os dois portões são histórias, não bilhetes de intenção.** ZELO-43 e ZELO-44 ocupam as duas primeiras posições justamente porque a regra do projeto é terminar a história de menor número antes de começar a próxima. Com isso, é impossível escrever a primeira linha de código da fase sem ter cliente pagante e parecer jurídico na mão — o gatilho vira estrutura, não disciplina.

---

## 11. Decisões que dependem de você

1. ~~**Segmento de entrada**~~ — **decidido em 18/08/2026: ILPI como porta de entrada, hospital fora do escopo.** Ver §3.
2. **O ZELO aceita virar o registro oficial da instituição, ou fica sempre como camada de transparência?** Recomendo a segunda — é o que mantém o produto fora do enquadramento de prontuário eletrônico regulado, pela mesma lógica da §2.3 da spec.
3. **Nível de evidência padrão** — N2, prova de presença (recomendado), ou foto obrigatória?
4. **Hedge de schema agora, ou migração depois?** Recomendo depois, pela §7.
5. **Marca** — "ZELO Instituições" dentro da mesma marca, ou linha separada?
6. **Validação jurídica** — antes de qualquer conversa comercial, um advogado precisa revisar: enquadramento regulatório da evidência, monitoramento de trabalhador, e a base legal de LGPD para dado de saúde tratado por operador institucional (a instituição vira controladora ou operadora? isso muda o contrato inteiro).

---

*Proposta v0.1 — ZELO Extensão B2B Institucional*

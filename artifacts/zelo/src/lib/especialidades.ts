/**
 * Especialidades médicas para o campo de consulta.
 *
 * Baseada nas especialidades reconhecidas pelo CFM (Conselho Federal de
 * Medicina). `NÃO VERIFICADO` contra a resolução oficial vigente — vale
 * conferir antes de ir a produção com usuários reais, porque a lista do CFM
 * muda por resolução.
 *
 * **Por que uma lista fechada.** Pedido do fundador em 24/08/2026: o campo era
 * texto livre e aceitava qualquer coisa. Especialidade digitada à mão vira
 * "cardiologia", "Cardio", "cardiologista" e "CARDIOLOGIA" na mesma base —
 * o que impede agrupar, filtrar e, mais tarde, mostrar qualquer coisa útil ao
 * médico no relatório.
 *
 * Ordenada alfabeticamente de propósito: quem procura já sabe o nome, e a
 * busca filtra enquanto digita. Ordenar por "mais usadas em geriatria" faria o
 * app supor o diagnóstico do paciente, o que este produto não faz (CON-005).
 */
export const ESPECIALIDADES: readonly string[] = [
  "Acupuntura",
  "Alergia e Imunologia",
  "Anestesiologia",
  "Angiologia",
  "Cardiologia",
  "Cirurgia Cardiovascular",
  "Cirurgia da Mão",
  "Cirurgia de Cabeça e Pescoço",
  "Cirurgia do Aparelho Digestivo",
  "Cirurgia Geral",
  "Cirurgia Oncológica",
  "Cirurgia Pediátrica",
  "Cirurgia Plástica",
  "Cirurgia Torácica",
  "Cirurgia Vascular",
  "Clínica Médica",
  "Coloproctologia",
  "Dermatologia",
  "Endocrinologia e Metabologia",
  "Endoscopia",
  "Gastroenterologia",
  "Genética Médica",
  "Geriatria",
  "Ginecologia e Obstetrícia",
  "Hematologia e Hemoterapia",
  "Homeopatia",
  "Infectologia",
  "Mastologia",
  "Medicina de Família e Comunidade",
  "Medicina do Trabalho",
  "Medicina de Tráfego",
  "Medicina Esportiva",
  "Medicina Física e Reabilitação",
  "Medicina Intensiva",
  "Medicina Legal e Perícia Médica",
  "Medicina Nuclear",
  "Medicina Preventiva e Social",
  "Nefrologia",
  "Neurocirurgia",
  "Neurologia",
  "Nutrologia",
  "Oftalmologia",
  "Oncologia Clínica",
  "Ortopedia e Traumatologia",
  "Otorrinolaringologia",
  "Patologia",
  "Patologia Clínica / Medicina Laboratorial",
  "Pediatria",
  "Pneumologia",
  "Psiquiatria",
  "Radiologia e Diagnóstico por Imagem",
  "Radioterapia",
  "Reumatologia",
  "Urologia",

  // Fora da lista do CFM, mas comuns na rotina de quem cuida de um idoso e
  // frequentes numa agenda de consultas. Sem eles, o campo obrigaria a pessoa
  // a escolher algo errado.
  "Fisioterapia",
  "Fonoaudiologia",
  "Nutrição",
  "Odontologia",
  "Psicologia",
  "Terapia Ocupacional",

  // Escape honesto: exame ou consulta que não se encaixa em nenhuma acima.
  // Sem esta opção, a lista fechada viraria uma armadilha.
  "Outra",
] as const;

/** Normaliza para busca: sem acento, minúsculo. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtra por trecho em qualquer posição, ignorando acento e maiúscula.
 * "dermato" acha "Dermatologia"; "cardio" acha "Cardiologia" e
 * "Cirurgia Cardiovascular".
 */
export function filtrarEspecialidades(busca: string): readonly string[] {
  const alvo = normalizar(busca);
  if (alvo.length === 0) return ESPECIALIDADES;
  return ESPECIALIDADES.filter((e) => normalizar(e).includes(alvo));
}

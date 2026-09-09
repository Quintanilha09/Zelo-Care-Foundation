/**
 * Perfil do cuidador, o que é comum às telas — Issue #116.
 *
 * Três lugares mostram a mesma pessoa: o avatar do cabeçalho, a tela de "Seu
 * perfil" e a lista de Cuidadores. Sem um lugar só para as iniciais e para os
 * rótulos de parentesco, os três divergem na primeira mudança.
 */

/** Até duas iniciais do nome, para o avatar enquanto não há foto. */
export function iniciais(nome: string | undefined | null): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Os sete parentescos, na ordem em que aparecem na lista.
 *
 * **Isto não é papel de acesso.** O `role` (`primary_caregiver`, `caregiver`,
 * `hired_caregiver`, `observer`) decide o que a pessoa pode fazer; isto aqui é
 * só como ela se apresenta. Os valores batem com o enum
 * `caregiver_relationship` do banco — mudar aqui sem mudar lá quebra o
 * `PATCH /account/me` com 400.
 */
export const PARENTESCOS = [
  { valor: "filho_filha", rotulo: "Filho ou filha" },
  { valor: "conjuge", rotulo: "Cônjuge ou companheiro(a)" },
  { valor: "neto_neta", rotulo: "Neto ou neta" },
  { valor: "irmao_irma", rotulo: "Irmão ou irmã" },
  { valor: "contratado", rotulo: "Cuidador(a) contratado(a)" },
  { valor: "amigo", rotulo: "Amigo(a)" },
  { valor: "outro", rotulo: "Outro" },
] as const;

export type Parentesco = (typeof PARENTESCOS)[number]["valor"];

/** O rótulo legível, ou `null` quando a pessoa não escolheu nenhum. */
export function rotuloDoParentesco(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return PARENTESCOS.find((p) => p.valor === valor)?.rotulo ?? null;
}

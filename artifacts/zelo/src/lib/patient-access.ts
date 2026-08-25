/**
 * Acesso do paciente neste aparelho — ZELO-58.
 *
 * Diferente de lib/elder-mode.ts, que guarda só um patientId e depende da
 * SESSÃO DO CUIDADOR estar presente no aparelho. Aqui o que fica guardado é
 * um token próprio do paciente, com escopo de duas rotas — o aparelho não
 * carrega sessão de cuidador nenhuma.
 *
 * É por isso que sair daqui não pede senha: não há sessão de cuidador pra
 * proteger. Sair = apagar este token; pra voltar, o cuidador manda um link novo.
 */

const TOKEN_KEY = "zelo_patient_access_token";
const NAME_KEY = "zelo_patient_access_name";

export function getPatientAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getPatientAccessName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function savePatientAccess(token: string, patientName: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NAME_KEY, patientName);
}

export function clearPatientAccess(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

/**
 * Requisição autenticada como PACIENTE. Nunca usa authFetch: aquele manda
 * o JWT do cuidador e renova sessão — nada disso existe neste aparelho.
 */
export async function patientFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getPatientAccessToken();
  if (!token) throw new Error("Este aparelho não tem acesso configurado.");

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  // FormData (o recado em áudio da QUI-8) precisa que o navegador defina o
  // Content-Type sozinho, com o boundary certo — fixar "application/json"
  // aqui quebraria o multipart. Mesmo cuidado que authFetch já tomava.
  const isFormData = init.body instanceof FormData;

  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      "X-Patient-Access": token,
      ...(init.headers ?? {}),
    },
  });
}

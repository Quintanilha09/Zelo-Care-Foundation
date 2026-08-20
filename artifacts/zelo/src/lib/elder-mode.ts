/**
 * Modo idoso — ZELO-40.
 *
 * O estado "este dispositivo está travado no modo idoso" vive só no
 * localStorage do aparelho — não é uma sessão própria do paciente, é o
 * cuidador que ativou reaproveitando a própria sessão dele, fisicamente
 * naquele dispositivo. Um módulo minúsculo, mas compartilhado entre quem
 * ativa (PatientDetailPage), quem intercepta a navegação (App.tsx) e quem
 * desativa (ElderModePage), pra nunca haver duas strings de chave divergentes.
 *
 * ESCOPO DA "TRANCA", explícito de propósito: isto simplifica a interface,
 * não é uma prisão de segurança. Quem souber abrir o console do navegador
 * apaga esta chave e sai — e tudo bem: a pessoa que o modo protege (o
 * idoso confirmando o próprio remédio) não faz isso, e quem faz é
 * justamente quem deveria conseguir sair. Vale como saída de emergência
 * documentada quando a senha do cuidador se perde:
 *   localStorage.removeItem("zelo_elder_mode_patient_id")
 * As outras duas saídas são a senha (na própria tela) e o cuidador
 * principal desligando o modo remotamente pelo aparelho dele.
 */

const KEY = "zelo_elder_mode_patient_id";

export function getElderModePatientId(): number | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function activateElderModeOnThisDevice(patientId: number): void {
  localStorage.setItem(KEY, String(patientId));
}

export function deactivateElderModeOnThisDevice(): void {
  localStorage.removeItem(KEY);
}

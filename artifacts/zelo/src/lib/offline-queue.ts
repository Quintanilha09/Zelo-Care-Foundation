/**
 * Fila offline de ações de dose — ZELO (ZELO-28).
 *
 * Mesmo esquema de IndexedDB do service worker (public/sw.js) —
 * deliberadamente duplicado, não importado: sw.js é um arquivo estático
 * servido direto, fora do bundle do Vite, então não dá pra compartilhar
 * módulo TS com ele sem uma esteira de build nova (fora do escopo aqui).
 * Mudou um, muda o outro — os dois nomes (banco/store) precisam continuar
 * idênticos.
 */

const DB_NAME = "zelo-offline-queue";
const STORE_NAME = "pending-actions";

export interface QueuedDoseAction {
  id: number;
  kind: "register" | "snooze";
  scheduledDoseId: number;
  patientId?: number;
  outcome?: string;
  /**
   * O instante em que a pessoa TOCOU — Issue #167.
   *
   * ═════════════════════════════════════════════════════════════════
   * SEM ISTO, UMA DOSE DADA NO PORÃO ÀS 20:00 ENTRA COMO 23:00.
   * ═════════════════════════════════════════════════════════════════
   *
   * Para a ação vinda da notificação, deixar o servidor ancorar em
   * `Clock.now()` é o certo: ela sincroniza em segundos, e o relógio
   * deste aparelho pode estar fora de sincronia.
   *
   * Para o registro feito PELA TELA sem internet, não: entre o toque e
   * a sincronização podem passar horas, e o horário da dose é o dado
   * clínico que vai ao médico. Aqui o relógio do aparelho é a única
   * fonte que existe — e é a fonte certa, porque foi ele que estava na
   * mão de quem deu o remédio.
   */
  takenAt?: string;
  /** Vai junto quando o servidor exigir — ver o drain. */
  justification?: string;
  queuedAt: number;
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getQueuedActions(): Promise<QueuedDoseAction[]> {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedDoseAction[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedAction(id: number): Promise<void> {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Mesma fila — usado quando uma ação delegada pela SW falha por rede (não por rejeição real da API), pra tentar de novo depois. */
export async function enqueueAction(action: Omit<QueuedDoseAction, "id" | "queuedAt">): Promise<void> {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add({ ...action, queuedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

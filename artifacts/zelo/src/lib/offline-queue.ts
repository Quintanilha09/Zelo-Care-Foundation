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

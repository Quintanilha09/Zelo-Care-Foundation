/**
 * Armazenamento de mídia — QUI-5.
 *
 * ── Por que uma interface, e não chamar o Replit direto ───────────────────
 *
 * Três razões concretas, nenhuma delas "abstração por elegância":
 *
 * 1. **O teste precisa rodar sem bucket.** A suíte de integração roda no CI
 *    do GitHub, onde não existe Object Storage do Replit. Sem uma
 *    implementação em memória, todo teste de mídia seria impossível — e
 *    história sem teste, neste projeto, é história não entregue.
 * 2. **O `pnpm run dev` local também não tem bucket.**
 * 3. **O comprador pode não usar Replit.** Trocar por S3 ou GCS deve ser
 *    escrever uma classe, não caçar chamadas espalhadas pelas rotas.
 *
 * ── Falha fechada em produção ─────────────────────────────────────────────
 *
 * Se NÃO houver bucket configurado, produção NÃO cai para memória. Cair
 * silenciosamente para memória seria aceitar um upload, responder 201 e
 * perder o arquivo no próximo restart — perda de dado disfarçada de
 * sucesso. Em produção sem bucket, `obterArmazenamento()` devolve `null` e
 * a rota responde 503 dizendo o que falta.
 *
 * Mesma regra do `getAdminSecret()` em lib/admin-auth.ts: esquecer de
 * configurar leva ao estado seguro, nunca ao estado quebrado silencioso.
 */

import crypto from "node:crypto";
import { Client } from "@replit/object-storage";
import { IS_PRODUCTION, allowsDevelopmentShortcuts } from "./environment.ts";
import { safeLog } from "./safe-logger.ts";

export type TipoDeMidia = "image" | "video" | "audio";

export interface ArmazenamentoDeMidia {
  guardar(chave: string, bytes: Buffer, mimeType: string): Promise<void>;
  ler(chave: string): Promise<Buffer | null>;
  apagar(chave: string): Promise<void>;
  existe(chave: string): Promise<boolean>;
}

/**
 * Prefixo das chaves dentro do bucket.
 *
 * `PRIVATE_OBJECT_DIR` é um Secret que o Replit já provisiona neste app e
 * que o código nunca usou. Quando ele existe, respeitamos; quando não,
 * usamos um prefixo próprio. Nos dois casos os objetos são privados — o
 * bucket não serve nada por URL pública.
 */
function prefixo(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR?.trim().replace(/^\/+|\/+$/g, "");
  return dir ? `${dir}/zelo-midia` : "zelo-midia";
}

/**
 * Chave aleatória, sem nenhuma informação dentro.
 *
 * CON-008: nenhum dado de saúde em URL. A chave não carrega id de paciente,
 * nome, nem sequência previsível — quem conseguir a chave não aprende nada
 * e não consegue adivinhar a próxima. 32 bytes de aleatoriedade é o mesmo
 * calibre dos tokens de sessão do projeto.
 */
export function novaChaveDeObjeto(tipo: TipoDeMidia): string {
  return `${prefixo()}/${tipo}/${crypto.randomBytes(32).toString("hex")}`;
}

// ── Implementação real: Object Storage do Replit ──────────────────────────

class ArmazenamentoReplit implements ArmazenamentoDeMidia {
  private readonly cliente: Client;

  constructor(bucketId: string) {
    this.cliente = new Client({ bucketId });
  }

  async guardar(chave: string, bytes: Buffer, mimeType: string): Promise<void> {
    const r = await this.cliente.uploadFromBytes(chave, bytes, {
      compress: false, // JPEG, MP4 e Opus já vêm comprimidos; recomprimir só gasta CPU
    });
    if (!r.ok) throw new Error(`Falha ao gravar objeto (${mimeType}): ${String(r.error)}`);
  }

  async ler(chave: string): Promise<Buffer | null> {
    const r = await this.cliente.downloadAsBytes(chave);
    // downloadAsBytes devolve uma TUPLA [Buffer], não um Buffer. Tratar o
    // valor como Buffer direto compila e falha só em runtime.
    if (!r.ok) return null;
    return r.value[0] ?? null;
  }

  async apagar(chave: string): Promise<void> {
    // ignoreNotFound: apagar duas vezes não pode ser erro. O expurgo por job
    // (história 7) precisa ser idempotente.
    const r = await this.cliente.delete(chave, { ignoreNotFound: true });
    if (!r.ok) throw new Error(`Falha ao apagar objeto: ${String(r.error)}`);
  }

  async existe(chave: string): Promise<boolean> {
    const r = await this.cliente.exists(chave);
    return r.ok ? r.value : false;
  }
}

// ── Implementação de teste e de desenvolvimento local ─────────────────────

/**
 * Guarda os bytes num Map do processo. Some ao reiniciar — e é exatamente
 * por isso que NUNCA é usada em produção.
 */
export class ArmazenamentoEmMemoria implements ArmazenamentoDeMidia {
  private readonly objetos = new Map<string, Buffer>();

  async guardar(chave: string, bytes: Buffer): Promise<void> {
    this.objetos.set(chave, bytes);
  }

  async ler(chave: string): Promise<Buffer | null> {
    return this.objetos.get(chave) ?? null;
  }

  async apagar(chave: string): Promise<void> {
    this.objetos.delete(chave);
  }

  async existe(chave: string): Promise<boolean> {
    return this.objetos.has(chave);
  }
}

// ── Seleção ───────────────────────────────────────────────────────────────

let memoriaCompartilhada: ArmazenamentoEmMemoria | null = null;
let replitCompartilhado: ArmazenamentoReplit | null = null;
let jaAvisou = false;

function bucketConfigurado(): string | null {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID?.trim();
  return id && id.length > 0 ? id : null;
}

/** A capacidade de mídia existe neste ambiente? Usada por GET /config/midia. */
export function midiaConfigurada(): boolean {
  return obterArmazenamento() !== null;
}

/**
 * Devolve o armazenamento ativo, ou `null` quando a capacidade não existe.
 *
 * `null` NÃO significa erro — significa "este ambiente não guarda mídia".
 * Quem chama responde 503 com motivo, nunca 500.
 */
export function obterArmazenamento(): ArmazenamentoDeMidia | null {
  const bucket = bucketConfigurado();

  if (bucket) {
    replitCompartilhado ??= new ArmazenamentoReplit(bucket);
    return replitCompartilhado;
  }

  if (IS_PRODUCTION) {
    if (!jaAvisou) {
      jaAvisou = true;
      safeLog.error(
        { action: "media_storage_unconfigured" },
        "[SEGURANCA] DEFAULT_OBJECT_STORAGE_BUCKET_ID ausente em producao. " +
          "O envio de midia fica DESABILITADO — cair para memoria perderia o arquivo no proximo restart."
      );
    }
    return null;
  }

  // Desenvolvimento e teste: memória, e dito em voz alta.
  if (allowsDevelopmentShortcuts() && !jaAvisou) {
    jaAvisou = true;
    safeLog.warn(
      { action: "media_storage_in_memory" },
      "Sem bucket configurado: midia esta em memoria e some ao reiniciar. Normal em teste e no dev local."
    );
  }
  memoriaCompartilhada ??= new ArmazenamentoEmMemoria();
  return memoriaCompartilhada;
}

/** Só para teste: descarta o estado compartilhado entre casos. */
export function reiniciarArmazenamentoParaTeste(): void {
  memoriaCompartilhada = null;
  replitCompartilhado = null;
  jaAvisou = false;
}

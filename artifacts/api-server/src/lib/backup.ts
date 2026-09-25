/**
 * Cópia de segurança própria, fora do fornecedor — Issue #199.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O BANCO GERENCIADO JÁ FAZ BACKUP. ISTO NÃO É REDUNDÂNCIA.
 *
 * O Lightsail guarda 7 dias, com restauração a cada 5 minutos, e isso é bom.
 * Mas é backup do fornecedor, dentro do fornecedor: ele cobre falha de disco,
 * falha de zona e erro humano no SQL, e NÃO cobre a conta ser suspensa, a
 * região ser apagada, alguém com credencial apagar banco e backups juntos, ou
 * precisar de algo de oito meses atrás.
 *
 * Para dado de saúde, backup fora do fornecedor é a diferença entre um susto
 * e um fim.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── A retenção é do S3, e não deste código — correção ao plano da Issue ───
 *
 * A Issue pedia um expurgo feito pelo job. Isso obrigaria a credencial do app
 * a ter `s3:DeleteObject` no bucket de backup — ou seja, **quem tomasse o app
 * apagaria os backups**, que é exatamente o cenário do qual eles deveriam
 * proteger.
 *
 * Em vez disso, as camadas são PREFIXOS, e quem expurga é uma regra de ciclo
 * de vida do próprio S3:
 *
 *   horario/   apagado depois de 2 dias
 *   diario/    apagado depois de 30 dias
 *   mensal/    apagado depois de 365 dias
 *
 * Com isso a credencial do app precisa de `s3:PutObject` e **nada mais**: ela
 * escreve e não lê, não lista e não apaga. É a propriedade que o expurgo por
 * job não conseguiria ter.
 *
 * ── O que ainda depende de gente ──────────────────────────────────────────
 *
 * `BACKUP_PUBLIC_KEY` é a metade pública de um par gerado pelo fundador. A
 * metade privada nunca entra na AWS: ela vive no cofre dele, e sem ela não há
 * restauração. Ver `backup-cifra.ts`.
 */
import { spawn } from "node:child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { Clock } from "./clock.ts";
import { safeLog } from "./safe-logger.ts";
import { IS_PRODUCTION } from "./environment.ts";
import { cifrar, chavePublicaDoAmbiente } from "./backup-cifra.ts";

/** As três camadas de retenção. O prefixo é o que a regra do S3 enxerga. */
export const CAMADAS = ["horario", "diario", "mensal"] as const;
export type Camada = (typeof CAMADAS)[number];

export interface ResultadoDaCopia {
  /** Onde a cópia foi gravada. Uma chave por camada. */
  chaves: string[];
  /** Tamanho do arquivo cifrado, em bytes. */
  bytes: number;
}

/**
 * Em quais camadas esta execução grava.
 *
 * Toda hora grava em `horario`. À meia-noite UTC grava também em `diario`, e
 * no primeiro dia do mês também em `mensal`.
 *
 * ── Por que gravar o mesmo arquivo três vezes, e não copiar depois ───────
 *
 * Copiar entre prefixos exigiria ler o objeto de volta — e ler é justamente a
 * permissão que a credencial do app não deve ter. Gravar de novo custa alguns
 * centavos por mês num banco deste tamanho, e mantém a credencial mínima.
 */
export function camadasDoMomento(agora: Date): Camada[] {
  const camadas: Camada[] = ["horario"];
  if (agora.getUTCHours() === 0) camadas.push("diario");
  if (agora.getUTCHours() === 0 && agora.getUTCDate() === 1) camadas.push("mensal");
  return camadas;
}

/**
 * O nome do objeto. Ordenável por nome, legível por gente.
 *
 * Sem `:` no horário: ele é válido no S3 mas atrapalha em nome de arquivo
 * quando alguém baixa a cópia para restaurar no Windows.
 */
export function nomeDaCopia(agora: Date, camada: Camada, prefixo: string): string {
  const carimbo = agora.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const base = prefixo ? `${prefixo.replace(/\/+$/, "")}/` : "";
  return `${base}${camada}/zelo-${carimbo}.dump.zbk`;
}

interface Destino {
  bucket: string;
  region: string;
  prefixo: string;
}

function destinoDoAmbiente(): Destino | null {
  const bucket = process.env.BACKUP_S3_BUCKET?.trim();
  const region = process.env.BACKUP_S3_REGION?.trim() ?? process.env.S3_REGION?.trim();
  if (!bucket || !region) return null;
  return { bucket, region, prefixo: process.env.BACKUP_S3_PREFIX?.trim() ?? "" };
}

/**
 * Roda o `pg_dump` e devolve o despejo.
 *
 * ── Por que os dados de conexão vão separados, e não como URL ────────────
 *
 * `pg_dump "postgresql://usuario:senha@host/banco"` funciona e coloca a SENHA
 * na linha de comando, onde qualquer `ps` do mesmo contêiner a lê. Host, porta,
 * usuário e banco vão como argumentos; a senha vai por `PGPASSWORD`, que não
 * aparece na lista de processos.
 *
 * ── Formato `custom` ─────────────────────────────────────────────────────
 *
 * Comprimido e restaurável com `pg_restore`, inclusive parcialmente. SQL puro
 * seria mais simples de olhar e várias vezes maior — e o que se quer olhar num
 * backup é se ele restaura, não o texto dele.
 */
export async function gerarDespejo(databaseUrl: string): Promise<Buffer> {
  const url = new URL(databaseUrl);

  const argumentos = [
    "--format=custom",
    // Sem dono e sem permissões: o banco restaurado pode ter outro usuário
    // dono, e `pg_restore` falharia tentando atribuir um papel inexistente.
    "--no-owner",
    "--no-privileges",
    "--host", url.hostname,
    "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username),
    "--dbname", url.pathname.replace(/^\//, ""),
  ];

  return await new Promise<Buffer>((resolve, reject) => {
    const processo = spawn("pg_dump", argumentos, {
      env: {
        ...process.env,
        PGPASSWORD: decodeURIComponent(url.password),
        // Sem isto o pg_dump pode parar esperando senha e o job pendura.
        PGCONNECT_TIMEOUT: "10",
      },
    });

    const pedacos: Buffer[] = [];
    const erros: string[] = [];

    processo.stdout.on("data", (b: Buffer) => pedacos.push(b));
    processo.stderr.on("data", (b: Buffer) => erros.push(b.toString()));

    processo.on("error", (e) => {
      reject(
        new Error(
          `pg_dump não pôde ser executado: ${e.message}. ` +
            "A imagem de produção precisa do postgresql-client na mesma versão maior do servidor.",
        ),
      );
    });

    processo.on("close", (codigo) => {
      if (codigo !== 0) {
        // A saída de erro do pg_dump não traz dado de paciente — traz nome de
        // tabela, versão e mensagem de conexão. Mesmo assim ela é devolvida no
        // erro e NÃO registrada em log pelo chamador.
        reject(new Error(`pg_dump terminou com código ${codigo}: ${erros.join("").trim()}`));
        return;
      }
      resolve(Buffer.concat(pedacos));
    });
  });
}

/**
 * Faz a cópia: despeja, cifra e grava nas camadas do momento.
 *
 * Lança em qualquer falha, de propósito: quem chama é a fila, e job que falha
 * é reprocessado e fica visível. Cópia que falha em silêncio é o mesmo que não
 * ter cópia — e é o que o alerta de 3 horas existe para pegar.
 */
export async function fazerCopiaDeSeguranca(): Promise<ResultadoDaCopia> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definido: não há o que copiar");

  const destino = destinoDoAmbiente();
  const chavePublica = chavePublicaDoAmbiente();

  if (!destino || !chavePublica) {
    const faltando = [
      !destino ? "BACKUP_S3_BUCKET+BACKUP_S3_REGION" : null,
      !chavePublica ? "BACKUP_PUBLIC_KEY" : null,
    ].filter(Boolean);

    if (IS_PRODUCTION) {
      /**
       * ═══════════════════════════════════════════════════════════════════
       * EM PRODUÇÃO ISTO É ERRO, E NÃO UM AVISO.
       *
       * Sem chave pública a única alternativa seria gravar o despejo em
       * claro. Um arquivo com o dado de saúde de todas as famílias, sem
       * cifra, num bucket, por meses — é pior do que não ter backup naquela
       * hora, porque parece que se tem.
       * ═══════════════════════════════════════════════════════════════════
       */
      safeLog.error(
        { action: "backup_sem_configuracao", faltando: faltando.join(", ") },
        "[SEGURANCA] Backup nao configurado em producao. NENHUMA copia foi feita.",
      );
      throw new Error(`backup não configurado: faltam ${faltando.join(", ")}`);
    }

    safeLog.warn(
      { action: "backup_ignorado_fora_de_producao", faltando: faltando.join(", ") },
      "Backup sem configuracao: ignorado. Normal em teste e no dev local.",
    );
    return { chaves: [], bytes: 0 };
  }

  const agora = Clock.now();
  const despejo = await gerarDespejo(databaseUrl);
  const pacote = cifrar(despejo, chavePublica);

  const cliente = new S3Client({ region: destino.region });
  const chaves: string[] = [];

  for (const camada of camadasDoMomento(agora)) {
    const chave = nomeDaCopia(agora, camada, destino.prefixo);
    await cliente.send(
      new PutObjectCommand({
        Bucket: destino.bucket,
        Key: chave,
        Body: pacote,
        ContentType: "application/octet-stream",
      }),
    );
    chaves.push(chave);
  }

  /**
   * O log não diz o que está dentro — invariante 3.
   *
   * Tamanho e nome de objeto são operacionais; nome de medicamento, paciente
   * ou condição nunca chegam aqui porque o despejo é um Buffer opaco para
   * este código, e nada dele é interpolado em mensagem.
   */
  safeLog.info(
    { action: "backup_concluido", camadas: chaves.length, bytes: pacote.length },
    "Copia de seguranca gravada",
  );

  return { chaves, bytes: pacote.length };
}

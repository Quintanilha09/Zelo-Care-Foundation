/**
 * Cifragem do despejo de banco — Issue #199.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * UM DESPEJO DE BANCO É O DADO DE SAÚDE INTEIRO NUM ARQUIVO SÓ.
 *
 * Nome de paciente, medicamento, condição, horário de cada dose de cada
 * família — tudo, num arquivo que vai para um bucket e fica lá por meses.
 * Guardá-lo em claro transforma "alguém leu um objeto do S3" em vazamento
 * total, sem etapa intermediária.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que ASSIMÉTRICA, e não uma senha ──────────────────────────────────
 *
 * A Issue pede que a chave "não more na mesma conta AWS". Uma senha simétrica
 * não atende: para cifrar, o app precisa dela — e o app roda com variáveis de
 * ambiente definidas no serviço da AWS. Quem tomar a conta toma a senha junto,
 * e os arquivos com ela.
 *
 * Com par de chaves, o app carrega apenas a **pública**. Ela cifra e não
 * decifra; publicá-la não custa nada. A **privada** vive no cofre de senhas do
 * fundador, fora da AWS, e só é usada na hora de restaurar.
 *
 * Consequência que precisa estar clara: **perder a chave privada é perder
 * todos os backups.** Não há recuperação, por desenho. Ela é o item mais
 * importante do cofre.
 *
 * ── Por que híbrida ───────────────────────────────────────────────────────
 *
 * RSA não cifra dado grande — o limite é o tamanho da chave menos o
 * preenchimento. Então: uma chave AES nova a cada despejo cifra o conteúdo, e
 * o RSA cifra só essa chave. É o desenho padrão, e o AES-GCM ainda dá
 * autenticação: adulterar um byte do arquivo faz a decifragem falhar em vez de
 * devolver lixo.
 */
import crypto from "node:crypto";

/** Marca e versão do formato. Muda se o formato mudar. */
const MARCA = Buffer.from("ZELOBK01", "ascii");

const TAMANHO_DA_MARCA = MARCA.length;
const TAMANHO_DO_CABECALHO = 4;
const TAMANHO_DO_IV = 12;
const TAMANHO_DA_TAG = 16;

/**
 * O formato do pacote, em bytes:
 *
 *   0..7     "ZELOBK01"        marca e versão
 *   8..11    uint32 BE         quantos bytes tem a chave AES cifrada
 *   12..     …                 a chave AES cifrada com RSA-OAEP
 *   …        12 bytes          o IV do AES-GCM
 *   …        16 bytes          a tag de autenticação
 *   …        resto             o conteúdo cifrado
 *
 * Autodescritivo de propósito: quem for restaurar daqui a dois anos não
 * precisa adivinhar nada além de ter a chave privada.
 */
export function cifrar(conteudo: Buffer, chavePublicaPem: string): Buffer {
  const chaveAes = crypto.randomBytes(32);
  const iv = crypto.randomBytes(TAMANHO_DO_IV);

  const cifrador = crypto.createCipheriv("aes-256-gcm", chaveAes, iv);
  const cifrado = Buffer.concat([cifrador.update(conteudo), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  const chaveAesCifrada = crypto.publicEncrypt(
    {
      key: chavePublicaPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    chaveAes,
  );

  const cabecalho = Buffer.alloc(TAMANHO_DO_CABECALHO);
  cabecalho.writeUInt32BE(chaveAesCifrada.length, 0);

  return Buffer.concat([MARCA, cabecalho, chaveAesCifrada, iv, tag, cifrado]);
}

/**
 * Desfaz o que `cifrar` fez. Precisa da chave PRIVADA, que não existe na AWS.
 *
 * Usada pelo script de restauração e pelos testes — nunca pelo servidor. O app
 * cifra e não lê de volta: se ele pudesse decifrar, a chave privada estaria
 * onde ela não deve estar.
 */
export function decifrar(pacote: Buffer, chavePrivadaPem: string): Buffer {
  if (pacote.length < TAMANHO_DA_MARCA + TAMANHO_DO_CABECALHO) {
    throw new Error("pacote de backup truncado: menor que o cabeçalho");
  }
  if (!pacote.subarray(0, TAMANHO_DA_MARCA).equals(MARCA)) {
    throw new Error("pacote de backup não reconhecido: marca ausente ou de outra versão");
  }

  let posicao = TAMANHO_DA_MARCA;
  const tamanhoDaChave = pacote.readUInt32BE(posicao);
  posicao += TAMANHO_DO_CABECALHO;

  const minimo = posicao + tamanhoDaChave + TAMANHO_DO_IV + TAMANHO_DA_TAG;
  if (pacote.length < minimo) {
    throw new Error("pacote de backup truncado: falta chave, IV ou tag");
  }

  const chaveAesCifrada = pacote.subarray(posicao, posicao + tamanhoDaChave);
  posicao += tamanhoDaChave;

  const iv = pacote.subarray(posicao, posicao + TAMANHO_DO_IV);
  posicao += TAMANHO_DO_IV;

  const tag = pacote.subarray(posicao, posicao + TAMANHO_DA_TAG);
  posicao += TAMANHO_DA_TAG;

  const cifrado = pacote.subarray(posicao);

  const chaveAes = crypto.privateDecrypt(
    {
      key: chavePrivadaPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    chaveAesCifrada,
  );

  const decifrador = crypto.createDecipheriv("aes-256-gcm", chaveAes, iv);
  decifrador.setAuthTag(tag);

  // `final()` lança se a tag não bater — é onde adulteração é detectada.
  return Buffer.concat([decifrador.update(cifrado), decifrador.final()]);
}

/**
 * A chave pública que o app usa, vinda do ambiente.
 *
 * Devolve `null` quando não há chave configurada. Quem chama decide o que
 * fazer — e o job de backup RECUSA rodar sem ela, em vez de gravar em claro.
 * Guardar o banco inteiro sem cifra por causa de uma variável esquecida é
 * pior do que não ter backup naquela hora.
 *
 * O valor pode vir com `\n` literais (é o que acontece ao colar um PEM numa
 * variável de ambiente de console web), então eles são normalizados.
 */
export function chavePublicaDoAmbiente(): string | null {
  const bruta = process.env.BACKUP_PUBLIC_KEY?.trim();
  if (!bruta) return null;
  return bruta.replace(/\\n/g, "\n");
}

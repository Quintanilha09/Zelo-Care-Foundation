/**
 * Momentos — QUI-7.
 *
 * O primeiro pedaço do ZELO que não é sobre remédio. Todo o resto responde
 * *"a dose foi tomada?"*; esta seção responde **"como ela está?"**.
 *
 * ── O que esta tela NÃO faz, e é regra ────────────────────────────────────
 *
 * - **Nenhuma contagem.** Sem "12 momentos", sem "3 esta semana", sem
 *   sequência. Nada aqui pode virar placar (CON-012).
 * - **Nenhuma cobrança.** Nunca "faz 5 dias sem foto". Mural vazio é mural
 *   vazio, e o texto do estado vazio é convite, não dívida (CON-011).
 * - **Nenhum vermelho.** Vermelho neste produto é ação destrutiva, nunca
 *   estado. O único vermelho aqui é a confirmação de apagar.
 * - **Nenhuma interpretação da foto.** Sem detectar humor, expressão ou
 *   estado. Quem lê a foto é quem ama a pessoa (CON-004, CON-005).
 *
 * ── Sem consentimento, a seção não existe ─────────────────────────────────
 *
 * Não aparece cinza com cadeado — some. Mostrar um recurso trancado é
 * convite a insistir, e o assunto aqui é fotografar uma pessoa vulnerável.
 * O que aparece no lugar, e só para o cuidador principal, é o pedido de
 * consentimento.
 */
import { useEffect, useRef, useState, type PointerEvent as EventoDePonteiro } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { authFetch, apiUrl } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { comprimirFoto } from "@/lib/comprimir-imagem";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Camera, Trash2, ImagePlus, Bookmark, Heart, Mic, ChevronLeft, ChevronRight, Images, ArrowLeft, X } from "lucide-react";
import { AreaCarregando, EsqueletoDeMomento, BarraDeProgresso } from "@/components/esqueleto";

interface Momento {
  id: number;
  kind: "image" | "video" | "audio";
  caption: string | null;
  criadoEm: string;
  autor: string | null;
  url: string;
  podeApagar: boolean;
  /** QUI-11: guardado não expira. */
  guardado: boolean;
  /** Nulo quando guardado. */
  expiraEm: string | null;
  /**
   * QUI-10 — os nomes de quem reagiu. **Nunca um número.**
   *
   * O servidor não manda total, e a tela não conta: escreve os nomes. É a
   * diferença entre "a Ana e o Bruno viram" e um placar de curtidas — e é
   * uma decisão de produto, não de layout (CON-012).
   */
  quemReagiu: string[];
  euReagi: boolean;
}

interface RespostaDoMural {
  consentido: boolean;
  podeDecidirConsentimento: boolean;
  timezone: string;
  diasDeRetencao: number;
  momentos: Momento[];
  /**
   * QUI-18 — o instante e o id do último momento desta página, ou `null`
   * quando acabou. **Nunca um total**: um número de quantos faltam viraria
   * placar do mural, que é justamente o que este recurso não pode ter.
   */
  proximoCursor: string | null;
}

async function buscarMural(patientId: number, cursor: string | null): Promise<RespostaDoMural | null> {
  const endereco = cursor
    ? `/api/patients/${patientId}/momentos?cursor=${encodeURIComponent(cursor)}`
    : `/api/patients/${patientId}/momentos`;
  const res = await authFetch(endereco);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Data e hora no fuso DO PACIENTE, não no de quem está olhando.
 *
 * "Hoje de manhã" tem que significar a manhã dela. Um filho em Portugal
 * vendo "14:00" quando a mãe tomou café às 9h da manhã em São Paulo é o
 * tipo de detalhe que faz a tela mentir.
 */
function quando(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Quanto o item apagado leva para sumir — Issue #5.
 *
 * **Precisa bater com `--zelo-motion-saida` no index.css.** Se um dos dois
 * mudar sozinho, ou o item some antes de terminar de sair (pisca), ou a lista
 * fica um tempo parada com um buraco invisível no meio.
 */
const MS_DE_SAIDA = 120;

/**
 * Teto de fotos por lote — Issue #64.
 *
 * Casado com o `mediaUploadLimiter` do servidor (100/hora por pessoa): cinco
 * lotes cheios cabem numa hora. Sem teto, escolher a galeria inteira no
 * celular levaria 429 no meio do envio.
 */
const MAX_POR_LOTE = 20;

/**
 * "Ana mandou um coração", "Ana e Bruno", "Ana, Bruno e mais 2" — QUI-10.
 *
 * ── O "e mais 2" não é um contador ────────────────────────────────────────
 *
 * Parece contradição com a regra de nunca contar, e não é. A regra existe
 * para impedir **placar entre momentos** — o número que se compara com o da
 * foto de ontem. Aqui não há número nenhum abaixo de quatro pessoas, e acima
 * disso a alternativa seria uma linha de nomes que estoura a tela do celular.
 *
 * O teto é do TEXTO, não do dado: os nomes todos vêm do servidor e a frase é
 * que escolhe caber.
 */
function fraseDeQuemReagiu(nomes: string[]): string {
  if (nomes.length === 1) return `${nomes[0]} mandou um coração`;
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]} mandaram um coração`;
  if (nomes.length === 3) return `${nomes[0]}, ${nomes[1]} e ${nomes[2]} mandaram um coração`;
  return `${nomes[0]}, ${nomes[1]} e mais ${nomes.length - 2} mandaram um coração`;
}

export function MomentosCard({ patientId, patientName }: { patientId: number; patientName: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const inputArquivo = useRef<HTMLInputElement>(null);
  /**
   * Onde o dedo encostou, para medir o deslize — Issue #51.
   *
   * AQUI EM CIMA, junto dos outros hooks, e não perto do código que o usa.
   * A primeira versão declarou este `useRef` depois do `if (!mural) return
   * null`, o que faz dele um hook CONDICIONAL: nas renderizações em que o
   * mural ainda não chegou, ele não é chamado, e o React derruba o
   * componente inteiro com "rendered more hooks than during the previous
   * render".
   *
   * O typecheck não pega. O que pegou foi o Playwright — e não pelo teste do
   * gesto: pela ficha do paciente inteira parando de renderizar, o que
   * reprovou dezenas de testes que nada tinham a ver com esta Issue.
   */
  const inicioDoGesto = useRef<{ x: number; y: number } | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [legenda, setLegenda] = useState("");
  /**
   * As fotos escolhidas e ainda não publicadas — Issue #64.
   *
   * Era UMA (`previa`). Quem voltava de um passeio com oito fotos repetia
   * oito vezes o ciclo escolher-esperar-publicar.
   */
  const [escolhidas, setEscolhidas] = useState<{ url: string; arquivo: File; nome: string }[]>([]);
  /** Progresso honesto durante o lote: qual está subindo agora. */
  const [enviandoIndice, setEnviandoIndice] = useState(0);
  const [aApagar, setAApagar] = useState<Momento | null>(null);
  const [saindo, setSaindo] = useState<number | null>(null);
  const [consentindo, setConsentindo] = useState(false);
  /**
   * Quantas fotos a ficha do paciente mostra — Issue #63.
   *
   * Um NÚMERO DE ITENS, e não uma fração da janela. A Issue #52 tentou
   * `max-h-[60vh]` e o teto nunca engatou: com 10 fotos em 4 colunas o
   * conteúdo dava ~544px contra ~557px de teto. Oito fotos são oito fotos em
   * qualquer tela — a ficha passa a ter altura constante, com 8 momentos ou
   * com 800.
   */
  const FOTOS_NA_PREVIA = 8;

  /** QUI-18 — índice do momento aberto no visualizador. `null` = fechado. */
  const [aberto, setAberto] = useState<number | null>(null);
  /**
   * A galeria — Issue #63.
   *
   * UM diálogo só, que alterna entre a grade e a foto, em vez de dois
   * aninhados. Radix aninhado embaralha o foco e o clique-fora, e o caminho
   * "estou na galeria, toquei numa foto, volto para a galeria" é o que as
   * galerias de verdade fazem — não é abrir uma janela em cima da outra.
   */
  const [galeriaAberta, setGaleriaAberta] = useState(false);
  const [modoDaGaleria, setModoDaGaleria] = useState<"grade" | "foto">("grade");

  // QUI-18 — paginação por cursor.
  //
  // **Não é feed infinito.** `fetchNextPage` só é chamado por um botão; o
  // mural nunca puxa sozinho enquanto a pessoa rola. Rolagem infinita existe
  // para prender, e este produto não quer prender ninguém.
  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["momentos", patientId],
    queryFn: ({ pageParam }) => buscarMural(patientId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => ultima?.proximoCursor ?? null,
  });

  // A primeira página é quem carrega consentimento, fuso e retenção — eles
  // não mudam entre páginas.
  const mural = data?.pages[0] ?? null;
  const momentos = data?.pages.flatMap((pagina) => pagina?.momentos ?? []) ?? [];
  // Só para o efeito de teclado abaixo: `momentos` é um array novo a cada
  // render, e usá-lo como dependência reinscreveria o listener sem parar.
  const quantos = momentos.length;

  /** O momento sendo olhado agora. `null` quando o visualizador está fechado. */
  const momentoAberto = aberto !== null ? momentos[aberto] ?? null : null;

  // Setas do teclado dentro do visualizador. O Radix já trata Esc; isto
  // completa o gesto que qualquer galeria tem, e sem o qual quem usa teclado
  // teria de fechar e reabrir para ver a foto seguinte.
  useEffect(() => {
    if (aberto === null) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "ArrowLeft") setAberto((i) => (i === null ? null : Math.max(0, i - 1)));
      if (evento.key === "ArrowRight") {
        setAberto((i) => (i === null ? null : Math.min(quantos - 1, i + 1)));
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, quantos]);

  const recarregar = () => queryClient.invalidateQueries({ queryKey: ["momentos", patientId] });

  const escolherArquivos = async (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    setErro("");

    // Teto por lote. Não é capricho: cada foto é uma requisição, e o
    // limitador do servidor é de 100/hora por pessoa. Sem teto aqui, escolher
    // a galeria inteira no celular levaria 429 no meio do caminho — e a
    // pessoa perderia parte do lote sem entender por quê.
    const cabem = MAX_POR_LOTE - escolhidas.length;
    if (cabem <= 0) {
      setErro(`Dá para enviar até ${MAX_POR_LOTE} fotos por vez. Publique estas e escolha as próximas.`);
      return;
    }
    const recortada = Array.from(lista).slice(0, cabem);
    if (recortada.length < lista.length) {
      setErro(`Dá para enviar até ${MAX_POR_LOTE} fotos por vez — as primeiras ${recortada.length} entraram.`);
    }

    // Uma por vez, e não `Promise.all`: comprimir usa canvas e memória, e
    // oito ao mesmo tempo derrubam a aba num celular. Em sequência é mais
    // lento e termina; em paralelo é mais rápido e às vezes não termina.
    //
    // Sequência sozinha não bastou (Issue #53): faltava soltar o canvas de
    // cada foto e ceder a vez ao navegador entre elas. Ver abaixo.
    for (const arquivo of recortada) {
      try {
      // Comprime ANTES de mostrar a prévia: a prévia então mostra exatamente
      // o que vai subir, e não uma versão melhor que a real.
      const comprimida = await comprimirFoto(arquivo);

      // O critério de aceite da QUI-7 exige o ganho MEDIDO, não estimado — e
      // a medição só existe num navegador de verdade, com uma foto de
      // verdade. Este log é como ela é feita: abra o console, escolha uma
      // foto do celular, leia os dois números.
      console.info(
        `[ZELO] Foto comprimida no aparelho: ${(comprimida.bytesAntes / 1024).toFixed(0)} KB → ` +
          `${(comprimida.bytesDepois / 1024).toFixed(0)} KB ` +
          `(${(comprimida.bytesAntes / Math.max(comprimida.bytesDepois, 1)).toFixed(1)}× menor, ` +
          `${comprimida.largura}×${comprimida.altura})`
      );

        // ── Entra na lista JÁ, e não no fim do laço — Issue #53 ───────────
        //
        // Antes, as comprimidas se acumulavam numa variável local e só viravam
        // estado depois que TODAS terminassem. Quando o renderizador morria no
        // meio (ver `comprimir-imagem.ts`), perdiam-se inclusive as que já
        // tinham dado certo. Uma a uma, o pior caso passa a ser perder o que
        // ainda não foi processado — e a pessoa vê a lista crescer, que é o
        // sinal de que o app não travou.
        setEscolhidas((antes) => [
          ...antes,
          {
            url: URL.createObjectURL(comprimida.arquivo),
            arquivo: comprimida.arquivo,
            nome: arquivo.name,
          },
        ]);

        // Devolve o controle ao navegador entre uma foto e outra: sem isto o
        // laço monopoliza a thread, e o navegador não repinta nem tem folga
        // para coletar o que a foto anterior soltou.
        await new Promise((r) => setTimeout(r, 0));
      } catch (e) {
        // Uma foto ilegível não pode derrubar o lote inteiro: as outras
        // sete continuam válidas.
        setErro(
          e instanceof Error
            ? `${arquivo.name}: ${e.message}`
            : `Não conseguimos ler ${arquivo.name}.`
        );
      }
    }

    // Zerar o input: sem isto, escolher o MESMO arquivo de novo não dispara
    // `onChange` e parece que o app ignorou o toque.
    if (inputArquivo.current) inputArquivo.current.value = "";
  };

  /** Tira uma foto do lote antes de publicar. */
  const removerEscolhida = (indice: number) => {
    setEscolhidas((antes) => {
      const alvo = antes[indice];
      if (alvo) URL.revokeObjectURL(alvo.url);
      return antes.filter((_, i) => i !== indice);
    });
  };

  const limparEscolhidas = () => {
    for (const e of escolhidas) URL.revokeObjectURL(e.url);
    setEscolhidas([]);
    setLegenda("");
    if (inputArquivo.current) inputArquivo.current.value = "";
  };

  /**
   * Publica o lote — Issue #64.
   *
   * ── Uma requisição por arquivo, de propósito ────────────────────────────
   *
   * O servidor continua com `upload.single`. Trocar por `upload.array`
   * mudaria de uma vez o teto de tamanho POR ARQUIVO, a validação de MIME e
   * o limitador de taxa — três proteções — para ganhar pouco.
   *
   * ── Falha no meio do lote não pode perder o resto ───────────────────────
   *
   * Se a quinta de sete falhar, as quatro primeiras já estão publicadas. O
   * que falhou CONTINUA na lista para tentar de novo; o que subiu sai. Sumir
   * com o lote inteiro seria perder trabalho — e perder trabalho é a coisa
   * mais cara que este app pode fazer com quem cuida de alguém.
   */
  const publicar = async () => {
    if (escolhidas.length === 0) return;
    setEnviando(true);
    setErro("");

    const legendaDoLote = legenda.trim();
    const falharam: typeof escolhidas = [];
    let ultimoErro = "";

    for (let i = 0; i < escolhidas.length; i++) {
      setEnviandoIndice(i);
      const item = escolhidas[i];
      try {
        const form = new FormData();
        // patientId e caption ANTES do arquivo: o multer preenche req.body na
        // ordem em que as partes chegam, e o servidor precisa dos dois quando
        // o handler roda.
        form.append("patientId", String(patientId));
        if (legendaDoLote) form.append("caption", legendaDoLote);
        form.append("arquivo", item.arquivo);

        const res = await authFetch("/api/media", { method: "POST", body: form });
        if (!res.ok) {
          const corpo = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(corpo.error ?? "Não conseguimos enviar.");
        }
        URL.revokeObjectURL(item.url);
      } catch (e) {
        falharam.push(item);
        ultimoErro = e instanceof Error ? e.message : "Não conseguimos enviar.";
      }
    }

    setEscolhidas(falharam);
    setEnviandoIndice(0);
    if (falharam.length === 0) {
      setLegenda("");
      if (inputArquivo.current) inputArquivo.current.value = "";
    } else {
      setErro(
        falharam.length === escolhidas.length
          ? ultimoErro
          : `${falharam.length} de ${escolhidas.length} não subiram. ${ultimoErro} As outras já estão no mural — toque em Publicar para tentar de novo só o que faltou.`
      );
    }

    setEnviando(false);
    await recarregar();
  };

  /**
   * O coração — QUI-10.
   *
   * ── Por que otimista ──────────────────────────────────────────────────
   *
   * Um coração que só preenche depois da resposta do servidor parece
   * quebrado no celular: a pessoa toca, nada acontece, ela toca de novo. O
   * estado vira na hora e o servidor confirma logo atrás.
   *
   * O nome próprio entra pelo `AuthContext` só para o instante otimista; a
   * lista definitiva vem do servidor. Se dois cuidadores da família tiverem
   * o mesmo nome, o palpite de qual remover pode errar por alguns
   * milissegundos — e some na reconciliação da linha seguinte.
   */
  const alternarCoracao = async (momento: Momento) => {
    const meuNome = user?.caregiver?.name ?? "Você";

    // Com paginação, o cache guarda `{ pages, pageParams }` — a atualização
    // otimista precisa atravessar todas as páginas já carregadas, senão um
    // coração dado numa foto da segunda página não aparece.
    const aplicar = (mudar: (m: Momento) => Momento) =>
      queryClient.setQueryData<InfiniteData<RespostaDoMural | null>>(
        ["momentos", patientId],
        (anterior) =>
          anterior
            ? {
                ...anterior,
                pages: anterior.pages.map((pagina) =>
                  pagina
                    ? {
                        ...pagina,
                        momentos: pagina.momentos.map((m) => (m.id === momento.id ? mudar(m) : m)),
                      }
                    : pagina
                ),
              }
            : anterior
      );

    aplicar((m) => ({
      ...m,
      euReagi: !m.euReagi,
      quemReagiu: m.euReagi
        ? m.quemReagiu.filter((n) => n !== meuNome)
        : [...m.quemReagiu, meuNome],
    }));

    const res = await authFetch(`/api/media/${momento.id}/coracao`, { method: "POST" });
    if (!res.ok) {
      toast({ title: "Não conseguimos registrar isso agora.", variant: "destructive" });
      await recarregar();
      return;
    }

    // A resposta traz a lista de verdade. Sobrescrever em vez de confiar no
    // palpite fecha a janela em que a tela e o banco discordam.
    const corpo = (await res.json()) as { quemReagiu: string[]; euReagi: boolean };
    aplicar((m) => ({ ...m, quemReagiu: corpo.quemReagiu, euReagi: corpo.euReagi }));
  };

  const alternarGuardado = async (momento: Momento) => {
    const res = await authFetch(`/api/media/${momento.id}/guardar`, {
      method: "PATCH",
      body: JSON.stringify({ guardar: !momento.guardado }),
    });
    if (!res.ok) {
      toast({ title: "Não conseguimos mudar isso agora.", variant: "destructive" });
      return;
    }
    await recarregar();
  };

  const apagar = async (momento: Momento) => {
    setAApagar(null);
    // Fecha o visualizador junto: manter aberto deixaria o índice apontando
    // para a foto seguinte, e a tela trocaria de imagem sozinha na cara de
    // quem acabou de apagar.
    setAberto(null);
    const res = await authFetch(`/api/media/${momento.id}`, { method: "DELETE" });
    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: corpo.error ?? "Não conseguimos apagar este momento.", variant: "destructive" });
      return;
    }

    // A animação só começa DEPOIS de o servidor confirmar, e a ordem é
    // deliberada. Animar antes seria a tela mentir: se o DELETE falhasse, a
    // foto já teria sumido do olho de quem apagou, e voltaria do nada.
    //
    // Depois da saída, recarrega ANTES de limpar o `saindo`. Invertido, o
    // item voltaria a aparecer inteiro por um quadro, entre o fim da animação
    // e a chegada da lista nova — um pisco que parece defeito.
    setSaindo(momento.id);
    await new Promise((resolver) => setTimeout(resolver, MS_DE_SAIDA));
    await recarregar();
    setSaindo(null);
  };

  const registrarConsentimento = async () => {
    setConsentindo(true);
    setErro("");
    try {
      const res = await authFetch(`/api/patients/${patientId}/image-consent`, {
        method: "POST",
        body: JSON.stringify({ consentGiven: true, version: "v1.0", givenBy: "legal_representative" }),
      });
      if (!res.ok) throw new Error("Não conseguimos registrar o consentimento.");
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não conseguimos registrar o consentimento.");
    } finally {
      setConsentindo(false);
    }
  };

  // ── Carregando ──────────────────────────────────────────────────────────
  //
  // Antes isto era `return null`: a seção sumia e reaparecia de repente, e a
  // página inteira pulava quando o conteúdo chegava. Para quem lê devagar,
  // página que se reorganiza embaixo do olho obriga a começar de novo.
  //
  // Dois esqueletos, não dez: o suficiente para reservar o espaço e dizer o
  // que vem, sem fingir que já sabemos quantas fotos existem.
  if (isLoading) {
    return (
      <div className="p-4 rounded-xl border space-y-4">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="font-medium">Momentos</p>
        </div>
        {/* Seis quadrados, e não dois retângulos: o esqueleto tem que ter a
            forma do que vem, senão a página pula quando o conteúdo chega —
            que é justamente o que ele existe para evitar. Seis é uma fileira
            no celular e uma e meia no desktop: reserva espaço sem fingir que
            já sabemos quantas fotos existem. */}
        <AreaCarregando rotulo="Carregando os momentos">
          <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: barra cinza sem identidade própria
              <EsqueletoDeMomento key={i} />
            ))}
          </ul>
        </AreaCarregando>
      </div>
    );
  }

  if (!mural) return null;

  /**
   * Uma miniatura da grade — Issue #63.
   *
   * Extraída porque agora ela aparece em DOIS lugares: na prévia da ficha do
   * paciente e dentro da galeria. Duplicar o markup faria as duas divergirem
   * na primeira mudança.
   */
  const miniatura = (momento: Momento, indice: number) => (
    <li
      key={momento.id}
      className={momento.id === saindo ? "zelo-sai" : "zelo-entra"}
    >
      <button
        type="button"
        onClick={() => abrirFoto(indice)}
        className="group relative block w-full aspect-square overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={
          `Abrir ${momento.kind === "audio" ? "o recado" : "a foto"} de ` +
          `${momento.autor ?? patientName}, ${quando(momento.criadoEm, mural.timezone)}`
        }
      >
        {momento.kind === "audio" ? (
          // Recado do paciente (QUI-8). Na grade ele é um bloco com
          // ícone: um player não cabe num quadrado pequeno, e ouvir é
          // uma decisão — não pode disparar por um toque de relance.
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <Mic className="w-6 h-6" aria-hidden />
            <span className="text-xs">Recado</span>
          </span>
        ) : (
          <img
            src={apiUrl(momento.url)}
            // Vazio de propósito: quem carrega o rótulo é o botão que
            // envolve a imagem. Repetir aqui faria o leitor de tela
            // anunciar a mesma coisa duas vezes.
            alt=""
            loading="lazy"
            // Decodificar fora da thread principal: sem isto, uma foto
            // grande chegando trava a rolagem por alguns quadros.
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        )}

        {/* Marcas, não contagens. Dizem "alguém reagiu" e "está
            guardado" — nunca quantos, que é o que separa carinho de
            placar (CON-012). Os nomes de quem reagiu aparecem por
            extenso no visualizador, onde há espaço para eles. */}
        {(momento.quemReagiu.length > 0 || momento.guardado) && (
          <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-full bg-background/85 px-1.5 py-0.5">
            {momento.quemReagiu.length > 0 && (
              <Heart className="w-3 h-3 text-zelo-green-fg" fill="currentColor" aria-hidden />
            )}
            {momento.guardado && (
              <Bookmark className="w-3 h-3 text-zelo-green-fg" fill="currentColor" aria-hidden />
            )}
          </span>
        )}
      </button>
    </li>
  );

  /**
   * Passa de um momento para o outro — Issue #51.
   *
   * Um lugar só, usado pelas setas, pelo teclado e pelo gesto. Antes cada
   * seta tinha seu próprio `setAberto` com o `Math.min`/`Math.max` repetido;
   * com um terceiro caminho de navegação chegando, isso viraria três cópias
   * da mesma regra de borda.
   */
  const irPara = (delta: number) => {
    setAberto((i) => {
      if (i === null) return null;
      const proximo = i + delta;
      // Sem dar a volta: o mural tem ordem cronológica, e pular do fim para
      // o começo desorienta.
      if (proximo < 0 || proximo > quantos - 1) return i;
      return proximo;
    });
  };

  /**
   * O gesto de deslizar — Issue #51.
   *
   * Pointer Events, e não Touch Events: cobre dedo, mouse e caneta com um
   * código só. No celular, que é o público real deste app, deslizar era a
   * única forma de navegar que NÃO existia — sobravam um botão pequeno e as
   * setas do teclado.
   */

  const aoTocar = (e: EventoDePonteiro) => {
    // Se o toque começou num CONTROLE, o gesto não entra — Issue #51.
    //
    // As setas ficam sobrepostas ao palco, então o `pointerdown` delas
    // borbulha até aqui. Capturar o ponteiro nesse caso redireciona o
    // `pointerup` para o palco, o botão nunca recebe o seu, e O CLIQUE NUNCA
    // COMPLETA. Foi assim que a correção do arrasto nativo quebrou as setas —
    // e junto quebrou o teste da QUI-18, que nada tinha a ver com este gesto.
    if ((e.target as HTMLElement).closest("button, a, audio, input")) return;

    inicioDoGesto.current = { x: e.clientX, y: e.clientY };
    // Captura o ponteiro: sem isto, um arrasto que termina FORA do palco não
    // entrega o `pointerup` aqui, e o gesto morre no meio.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const aoSoltar = (e: EventoDePonteiro) => {
    const inicio = inicioDoGesto.current;
    inicioDoGesto.current = null;
    if (!inicio) return;

    const dx = e.clientX - inicio.x;
    const dy = e.clientY - inicio.y;

    // Movimento predominantemente HORIZONTAL. Se o dedo desceu mais do que
    // andou de lado, a pessoa estava rolando a página, não trocando de foto.
    if (Math.abs(dx) <= Math.abs(dy)) return;

    // Limiar por distância: sem ele, um toque com micro-tremor — que é a
    // regra numa mão idosa, não a exceção — trocaria de foto sozinho.
    const largura = (e.currentTarget as HTMLElement).clientWidth || 1;
    const limiar = Math.max(50, largura * 0.15);
    if (Math.abs(dx) < limiar) return;

    // Arrastar para a ESQUERDA avança, como virar página.
    irPara(dx < 0 ? 1 : -1);
  };

  /** Abre o visualizador — pela prévia ou de dentro da galeria. */
  const abrirFoto = (indice: number) => {
    setAberto(indice);
    setModoDaGaleria("foto");
    setGaleriaAberta(true);
  };

  // ── Sem consentimento ───────────────────────────────────────────────────
  if (!mural.consentido) {
    // Para quem não decide, a seção simplesmente não existe.
    if (!mural.podeDecidirConsentimento) return null;

    return (
      <div className="p-4 rounded-xl border space-y-3">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="font-medium">Momentos</p>
        </div>
        <p className="text-sm text-muted-foreground">
          A família pode acompanhar o dia de {patientName} por fotos. Para isso existir, é preciso
          registrar que {patientName}, ou quem responde legalmente por ela, concorda em ser
          fotografada.
        </p>
        <p className="text-xs text-muted-foreground">
          Dá para desfazer quando quiser — e desfazer <strong>apaga as fotos que já existirem</strong>.
        </p>
        {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
        <Button variant="outline" size="sm" onClick={registrarConsentimento} disabled={consentindo}>
          {consentindo ? "Registrando…" : "Registrar consentimento"}
        </Button>
      </div>
    );
  }

  // ── Com consentimento: o mural ──────────────────────────────────────────
  return (
    // `region` com nome: dá à seção um handle estável, e é o que um leitor de
    // tela anuncia ao entrar nela. Sem isto o teste precisaria caçar `div` por
    // texto, que quebra na primeira mudança de markup.
    <div
      className="p-4 rounded-xl border space-y-4"
      role="region"
      aria-label={`Momentos de ${patientName}`}
    >
      <div className="flex items-center gap-2">
        <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="font-medium">Momentos</p>
      </div>

      {/* Publicar */}
      <div className="space-y-3">
        <input
          ref={inputArquivo}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          // `capture` deixado de fora de propósito: forçar a câmera impediria
          // escolher uma foto que já está no aparelho, que é metade dos casos.
          //
          // `multiple` — Issue #64. Quem volta de um passeio com oito fotos
          // não deveria repetir oito vezes o mesmo ciclo.
          multiple
          className="hidden"
          onChange={(e) => void escolherArquivos(e.target.files)}
        />

        {escolhidas.length === 0 ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => inputArquivo.current?.click()}>
            <ImagePlus className="w-4 h-4" /> Adicionar fotos
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border p-3">
            {/* Grade de escolhidas: dá para tirar uma do lote antes de
                publicar. Sem isso, escolher 8 e perceber que uma está ruim
                obrigaria a recomeçar do zero. */}
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {escolhidas.map((item, indice) => (
                <li key={item.url} className="relative">
                  <img
                    src={item.url}
                    alt={`${item.nome}, escolhida e ainda não publicada`}
                    className="aspect-square w-full object-cover rounded-md bg-muted"
                  />
                  {!enviando && (
                    <button
                      type="button"
                      onClick={() => removerEscolhida(indice)}
                      aria-label={`Tirar ${item.nome} do envio`}
                      className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {!enviando && (
              <Button variant="ghost" size="sm" className="gap-2" onClick={() => inputArquivo.current?.click()}>
                <ImagePlus className="w-4 h-4" /> Adicionar mais
              </Button>
            )}

            {/* Uma legenda para o lote. Legenda por foto é outra história, e
                não é esta — oito campos de texto antes de publicar seria pior
                que oito envios. */}
            <Textarea
              value={legenda}
              onChange={(e) => setLegenda(e.target.value.slice(0, 300))}
              placeholder={
                escolhidas.length > 1
                  ? "Escreva alguma coisa sobre estas fotos, se quiser"
                  : "Escreva alguma coisa, se quiser"
              }
              rows={2}
            />
            {/* Enquanto envia, a barra substitui os botoes. Deixar botao
                desabilitado do lado de uma barra e dar duas mensagens sobre a
                mesma coisa — e um deles convida a clicar de novo.

                O rótulo diz QUAL está subindo: a compressão roda por foto e é
                o passo lento, então sem isso um lote de oito parece travado. */}
            {enviando ? (
              <BarraDeProgresso
                rotulo={
                  escolhidas.length > 1
                    ? `Enviando ${enviandoIndice + 1} de ${escolhidas.length}…`
                    : "Enviando a foto…"
                }
              />
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={publicar} className="gap-2">
                  Publicar
                </Button>
                <Button variant="ghost" size="sm" onClick={limparEscolhidas}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        )}

        {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
      </div>

      {/* QUI-11 — avisar ANTES é critério de aceite, não gentileza. O tom é
          informativo: nada de contagem regressiva por foto, nada de âmbar,
          nada que pareça ameaça. Só o fato, e como escapar dele. */}
      {momentos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Os momentos somem sozinhos depois de {mural.diasDeRetencao} dias. Abra um e toque
          no marcador para guardá-lo para sempre.
        </p>
      )}

      {/* ── O mural, em grade — QUI-18 ─────────────────────────────────────
          Era uma coluna de fotos em tamanho grande. Funcionava com cinco;
          com cinquenta virava um rolo sem fim, e achar a foto do Natal
          passado exigia rolar a lista inteira.

          A grade mostra muito mais de uma vez, e quem quiser ver de perto
          abre — que é como qualquer galeria de celular funciona, e portanto
          não precisa ser aprendido.

          O que a grade NÃO tem, e é regra: nenhum número. Sem "12 fotos",
          sem "faltam 30". O coração e o marcador aparecem como marca, nunca
          como contagem (CON-012). */}
      {momentos.length === 0 ? (
        // Convite, nunca cobrança. Nada de "faz X dias sem foto" (CON-011).
        <p className="text-sm text-muted-foreground">
          Ainda não há nenhuma foto aqui. Quando houver, a família toda vê.
        </p>
      ) : (
        <>
          {/* ── A PRÉVIA, não o acervo — Issue #63 ─────────────────────────

              A ficha do paciente mostra as oito mais recentes e para por aí.
              O acervo inteiro vive na galeria, que tem rolagem própria.

              Isto é o que faz a ficha ter ALTURA CONSTANTE. A tentativa
              anterior (#52) capou por `60vh` e o teto nunca engatou — dez
              fotos davam ~544px contra ~557px de teto. Oito fotos são oito
              fotos em qualquer aparelho.

              Sem rolagem aqui de propósito: caixa que rola dentro de página
              que rola é confuso no celular, e agora não precisa existir. */}
          <ul className="grid grid-cols-4 gap-2">
            {momentos.slice(0, FOTOS_NA_PREVIA).map((momento, indice) =>
              miniatura(momento, indice)
            )}
          </ul>

          {/* Só aparece quando há mais do que a prévia mostra. E nada de
              número: "Ver todas as fotos", nunca "ver as outras 42" — a regra
              do CON-012 vale aqui igual. */}
          {(momentos.length > FOTOS_NA_PREVIA || hasNextPage) && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  setModoDaGaleria("grade");
                  setGaleriaAberta(true);
                }}
              >
                <Images className="w-4 h-4" aria-hidden /> Ver todas as fotos
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── A galeria — Issue #63 ──────────────────────────────────────────

          UM diálogo que alterna entre a grade e a foto. Antes, a ficha do
          paciente ERA o acervo: a grade crescia ali dentro e não havia nada
          em que clicar para "ver as fotos".

          Dois diálogos aninhados seriam o caminho óbvio e o errado — Radix
          aninhado embaralha foco e clique-fora. Alternar o conteúdo também é
          o que a pessoa espera: ela está NA galeria e entra numa foto, não
          abre uma janela em cima da outra. */}
      <Dialog
        open={galeriaAberta}
        onOpenChange={(estaAberto) => {
          setGaleriaAberta(estaAberto);
          if (!estaAberto) setAberto(null);
        }}
      >
        {/* ── Altura FIXA no modo foto — Issue #63, segunda tentativa ─────

            Sobrepor as setas à foto não bastou, e o CI mostrou por quê: o
            `DialogContent` é centralizado (`top-[50%]` + `-translate-y-[50%]`),
            então a legenda muda a ALTURA DO DIÁLOGO e o diálogo inteiro se
            desloca — levando junto tudo que está dentro dele, inclusive as
            setas sobrepostas.

            Medido na execução 33465371943: 1,5px no desktop e 16px no
            celular, entre a foto sem legenda e a foto com legenda.

            Com `h-[85vh]` o diálogo para de mudar de tamanho, e a
            re-centralização deixa de existir. O palco fica com altura fixa
            logo abaixo de um cabeçalho de altura fixa; o que sobra vai para
            a legenda, que rola sozinha quando for longa. */}
        <DialogContent
          className={
            modoDaGaleria === "foto"
              ? "sm:max-w-3xl h-[85vh] flex flex-col gap-3"
              : "sm:max-w-3xl"
          }
        >
          {modoDaGaleria === "grade" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Momentos de {patientName}</DialogTitle>
                <DialogDescription>Toque numa foto para ver de perto.</DialogDescription>
              </DialogHeader>

              {/* AQUI a rolagem faz sentido: o que rola é a galeria, e não a
                  ficha do paciente por baixo. */}
              <ul
                className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto pr-1"
                tabIndex={0}
                role="region"
                aria-label={`Todos os momentos de ${patientName}`}
              >
                {momentos.map((momento, indice) => miniatura(momento, indice))}
              </ul>

              {/* Fora da área que rola, para não sumir de vista. */}
              {hasNextPage && (
                <div className="flex justify-center border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? "Carregando…" : "Ver momentos mais antigos"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            momentoAberto && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-base">
                    {momentoAberto.autor ?? "Alguém da família"}
                  </DialogTitle>
                  <DialogDescription>
                    {quando(momentoAberto.criadoEm, mural.timezone)}
                    {momentoAberto.guardado && " · guardado"}
                  </DialogDescription>
                </DialogHeader>

                {/* ── O palco, e as setas SOBRE ele — Issue #63 ────────────

                    A #50 fixou a altura da imagem e deixou as setas embaixo,
                    depois da legenda. Resultado: foto com legenda e foto sem
                    legenda punham as setas em alturas diferentes — o defeito
                    continuou, só mudou de causa.

                    Sobrepostas e ancoradas em `top-1/2`, elas deixam de
                    depender do que vem depois DENTRO do diálogo. É o que toda
                    galeria faz, e era a alternativa que a #50 registrou e
                    descartou por ser maior.

                    Sozinho isso NÃO bastou: faltava travar a altura do próprio
                    diálogo, senão ele se re-centraliza e move o palco inteiro.
                    Ver o comentário no `DialogContent` acima. */}
                {/* `touch-pan-y`: o navegador continua dono da rolagem
                    vertical, e só o horizontal vira gesto nosso. Sem isso, o
                    deslize competiria com a rolagem da página.

                    Só na foto: no áudio, arrastar sobre o player é buscar
                    posição na faixa. */}
                <div
                  className="relative shrink-0 touch-pan-y"
                  onPointerDown={momentoAberto.kind === "audio" ? undefined : aoTocar}
                  onPointerUp={momentoAberto.kind === "audio" ? undefined : aoSoltar}
                  onPointerCancel={() => { inicioDoGesto.current = null; }}
                >
                  {momentoAberto.kind === "audio" ? (
                    // Palco baixo para áudio: um player centralizado em 60vh
                    // de vazio seria pior que o problema que isto corrige.
                    <div className="flex h-32 w-full items-center justify-center rounded-lg bg-muted px-4">
                      <audio controls preload="none" src={apiUrl(momentoAberto.url)} className="w-full">
                        Seu navegador não consegue tocar áudio.
                      </audio>
                    </div>
                  ) : (
                    <div className="flex h-[60vh] w-full items-center justify-center rounded-lg bg-muted">
                      <img
                        src={apiUrl(momentoAberto.url)}
                        alt={momentoAberto.caption ?? `Momento de ${patientName}`}
                        // `draggable={false}` — Issue #51.
                        //
                        // Imagem é arrastável por padrão no navegador. Sem
                        // isto, encostar e puxar inicia um ARRASTO NATIVO de
                        // imagem, que cancela os pointer events e mata o gesto
                        // antes do `pointerup`. Era o que reprovava o teste de
                        // deslizar enquanto o resto passava.
                        draggable={false}
                        className="max-h-full max-w-full object-contain select-none"
                      />
                    </div>
                  )}

                  {quantos > 1 && (
                    <>
                      {/* 44px de alvo de toque: é o mínimo para um app com
                          idosos, e `size="sm"` do shadcn é menor que isso.
                          Fundo semitransparente porque a seta pousa sobre
                          foto clara e sobre foto escura. */}
                      <button
                        type="button"
                        onClick={() => irPara(-1)}
                        disabled={aberto === 0}
                        aria-label="Momento anterior"
                        className="left-2 absolute top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition hover:bg-background disabled:opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => irPara(1)}
                        disabled={aberto === quantos - 1}
                        aria-label="Próximo momento"
                        className="right-2 absolute top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition hover:bg-background disabled:opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Área elástica: é ela que absorve a diferença de tamanho
                    entre uma foto com legenda longa e uma sem legenda. Antes
                    essa diferença ia para a altura do diálogo. */}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                {momentoAberto.caption && <p className="text-sm">{momentoAberto.caption}</p>}
  
                {/* QUI-10 — quem reagiu, por extenso.
                    `quemReagiu.length` existe, mas ninguém o escreve na tela:
                    o caminho fácil aqui é listar os nomes, e é assim que o
                    mural não vira contagem de curtidas (CON-012). */}
                {momentoAberto.quemReagiu.length > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Heart className="w-3 h-3 text-zelo-green-fg shrink-0" fill="currentColor" aria-hidden />
                    {fraseDeQuemReagiu(momentoAberto.quemReagiu)}
                  </p>
                )}
                </div>

                <div className="flex shrink-0 items-center justify-between gap-2 border-t pt-3">
                  <div className="flex items-center gap-1">
                    {/* QUI-10 — o coração.
                        Cheio quando você reagiu, contorno quando não. Sem
                        número ao lado: quem reagiu aparece por extenso logo
                        acima, e essa é a diferença entre carinho e placar. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={momentoAberto.euReagi ? "text-zelo-green-fg" : "text-muted-foreground"}
                      onClick={() => void alternarCoracao(momentoAberto)}
                      aria-pressed={momentoAberto.euReagi}
                      aria-label={momentoAberto.euReagi ? "Tirar seu coração" : "Mandar um coração"}
                      title={momentoAberto.euReagi ? "Você mandou um coração" : "Mandar um coração"}
                    >
                      <Heart className="w-4 h-4" fill={momentoAberto.euReagi ? "currentColor" : "none"} />
                    </Button>
                    {/* Guardar é de QUALQUER cuidador da família: decidir que uma
                        foto é importante não precisa de hierarquia. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={momentoAberto.guardado ? "text-zelo-green-fg" : "text-muted-foreground"}
                      onClick={() => void alternarGuardado(momentoAberto)}
                      aria-label={momentoAberto.guardado ? "Deixar de guardar" : "Guardar para sempre"}
                      title={momentoAberto.guardado ? "Guardado — não expira" : "Guardar para não expirar"}
                    >
                      <Bookmark className="w-4 h-4" fill={momentoAberto.guardado ? "currentColor" : "none"} />
                    </Button>
                    {momentoAberto.podeApagar && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setAApagar(momentoAberto)}
                        aria-label="Apagar este momento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {/* Voltar para a grade sem fechar a galeria. `aberto` volta
                      a `null` junto: senão as setas do teclado continuariam
                      navegando por uma foto que ninguém está vendo. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      setAberto(null);
                      setModoDaGaleria("grade");
                    }}
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden /> Todas as fotos
                  </Button>
                </div>
              </>
            )
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={aApagar !== null} onOpenChange={(aberto) => !aberto && setAApagar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar este momento?</AlertDialogTitle>
            <AlertDialogDescription>
              A foto some para todo mundo da família, e não dá para recuperar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => aApagar && void apagar(aApagar)}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Camera, Trash2, ImagePlus, Bookmark, Heart } from "lucide-react";
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
}

async function buscarMural(patientId: number): Promise<RespostaDoMural | null> {
  const res = await authFetch(`/api/patients/${patientId}/momentos`);
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

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [legenda, setLegenda] = useState("");
  const [previa, setPrevia] = useState<{ url: string; arquivo: File } | null>(null);
  const [aApagar, setAApagar] = useState<Momento | null>(null);
  const [saindo, setSaindo] = useState<number | null>(null);
  const [consentindo, setConsentindo] = useState(false);

  const { data: mural, isLoading } = useQuery({
    queryKey: ["momentos", patientId],
    queryFn: () => buscarMural(patientId),
  });

  const recarregar = () => queryClient.invalidateQueries({ queryKey: ["momentos", patientId] });

  const escolherArquivo = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setErro("");
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

      if (previa) URL.revokeObjectURL(previa.url);
      setPrevia({ url: URL.createObjectURL(comprimida.arquivo), arquivo: comprimida.arquivo });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não conseguimos ler essa foto.");
    }
  };

  const limparPrevia = () => {
    if (previa) URL.revokeObjectURL(previa.url);
    setPrevia(null);
    setLegenda("");
    if (inputArquivo.current) inputArquivo.current.value = "";
  };

  const publicar = async () => {
    if (!previa) return;
    setEnviando(true);
    setErro("");
    try {
      const form = new FormData();
      // patientId e caption ANTES do arquivo: o multer preenche req.body na
      // ordem em que as partes chegam, e o servidor precisa dos dois quando
      // o handler roda.
      form.append("patientId", String(patientId));
      if (legenda.trim()) form.append("caption", legenda.trim());
      form.append("arquivo", previa.arquivo);

      const res = await authFetch("/api/media", { method: "POST", body: form });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? "Não conseguimos enviar a foto.");
      }
      limparPrevia();
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não conseguimos enviar a foto.");
    } finally {
      setEnviando(false);
    }
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

    const aplicar = (mudar: (m: Momento) => Momento) =>
      queryClient.setQueryData<RespostaDoMural | null>(["momentos", patientId], (anterior) =>
        anterior
          ? { ...anterior, momentos: anterior.momentos.map((m) => (m.id === momento.id ? mudar(m) : m)) }
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
        <AreaCarregando rotulo="Carregando os momentos">
          <ul className="space-y-4">
            <EsqueletoDeMomento />
            <EsqueletoDeMomento />
          </ul>
        </AreaCarregando>
      </div>
    );
  }

  if (!mural) return null;

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
    <div className="p-4 rounded-xl border space-y-4">
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
          className="hidden"
          onChange={(e) => void escolherArquivo(e.target.files?.[0])}
        />

        {!previa ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => inputArquivo.current?.click()}>
            <ImagePlus className="w-4 h-4" /> Adicionar uma foto
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border p-3">
            <img
              src={previa.url}
              alt="Foto escolhida, ainda não publicada"
              className="w-full max-h-64 object-contain rounded-md bg-muted"
            />
            <Textarea
              value={legenda}
              onChange={(e) => setLegenda(e.target.value.slice(0, 300))}
              placeholder="Escreva alguma coisa, se quiser"
              rows={2}
            />
            {/* Enquanto envia, a barra substitui os botoes. Deixar botao
                desabilitado do lado de uma barra e dar duas mensagens sobre a
                mesma coisa — e um deles convida a clicar de novo. */}
            {enviando ? (
              <BarraDeProgresso rotulo="Enviando a foto…" />
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={publicar} className="gap-2">
                  Publicar
                </Button>
                <Button variant="ghost" size="sm" onClick={limparPrevia}>
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
      {mural.momentos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Os momentos somem sozinhos depois de {mural.diasDeRetencao} dias. Toque no marcador
          para guardar um para sempre.
        </p>
      )}

      {/* O mural */}
      {mural.momentos.length === 0 ? (
        // Convite, nunca cobrança. Nada de "faz X dias sem foto" (CON-011).
        <p className="text-sm text-muted-foreground">
          Ainda não há nenhuma foto aqui. Quando houver, a família toda vê.
        </p>
      ) : (
        <ul className="space-y-4">
          {mural.momentos.map((momento) => (
            // `zelo-entra` no item, NAO escalonado. Escalonar uma lista
            // inteira ("stagger") faz a ultima foto chegar meio segundo depois
            // da primeira, e quem abriu o mural quer ver tudo, nao assistir a
            // uma sequencia.
            <li
              key={momento.id}
              className={`space-y-2 ${momento.id === saindo ? "zelo-sai" : "zelo-entra"}`}
            >
              {momento.kind === "audio" ? (
                // Recado do paciente (QUI-8). `preload="none"` de propósito: um
                // mural com vários recados não pode baixar todos ao abrir.
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-medium">Recado de {momento.autor ?? patientName}</p>
                  <audio controls preload="none" src={apiUrl(momento.url)} className="w-full">
                    Seu navegador não consegue tocar áudio.
                  </audio>
                </div>
              ) : (
                <img
                  src={apiUrl(momento.url)}
                  alt={momento.caption ?? `Momento de ${patientName}`}
                  loading="lazy"
                  // Decodificar fora da thread principal: sem isto, uma foto
                  // grande chegando trava a rolagem por alguns quadros.
                  decoding="async"
                  // `min-h` reserva o espaço ANTES de a foto chegar, e resolve
                  // duas coisas de uma vez (Issue #5):
                  //
                  //   1. a lista para de pular. Sem altura reservada, o item
                  //      tem 0px, e ao carregar salta para até 26rem —
                  //      empurrando para baixo o que a pessoa estava lendo.
                  //   2. **o `loading="lazy"` volta a funcionar de verdade.**
                  //      Imagem sem altura fica toda dentro da primeira tela
                  //      na conta do navegador, então ele baixa o mural
                  //      inteiro de uma vez — exatamente o que a Issue #5
                  //      queria evitar.
                  //
                  // `max-h` com `object-contain`: sem teto, uma foto em pé
                  // ocupa a tela inteira e empurra autor e legenda para fora
                  // do campo de visão. Relatado pelo fundador em 25/08/2026.
                  className="w-full min-h-[10rem] max-h-[26rem] object-contain rounded-lg border bg-muted"
                />
              )}
              {momento.caption && <p className="text-sm">{momento.caption}</p>}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {momento.autor ?? "Alguém da família"} · {quando(momento.criadoEm, mural.timezone)}
                  {momento.guardado && " · guardado"}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  {/* QUI-10 — o coração.
                      Cheio quando você reagiu, contorno quando não. Sem
                      número ao lado: quem reagiu aparece por extenso logo
                      abaixo, e essa é a diferença entre carinho e placar. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={momento.euReagi ? "text-zelo-green-fg" : "text-muted-foreground"}
                    onClick={() => void alternarCoracao(momento)}
                    aria-pressed={momento.euReagi}
                    aria-label={momento.euReagi ? "Tirar seu coração" : "Mandar um coração"}
                    title={momento.euReagi ? "Você mandou um coração" : "Mandar um coração"}
                  >
                    <Heart className="w-4 h-4" fill={momento.euReagi ? "currentColor" : "none"} />
                  </Button>
                  {/* Guardar é de QUALQUER cuidador da família: decidir que uma
                      foto é importante não precisa de hierarquia. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={momento.guardado ? "text-zelo-green-fg" : "text-muted-foreground"}
                    onClick={() => void alternarGuardado(momento)}
                    aria-label={momento.guardado ? "Deixar de guardar" : "Guardar para sempre"}
                    title={momento.guardado ? "Guardado — não expira" : "Guardar para não expirar"}
                  >
                    <Bookmark className="w-4 h-4" fill={momento.guardado ? "currentColor" : "none"} />
                  </Button>
                  {momento.podeApagar && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setAApagar(momento)}
                      aria-label="Apagar este momento"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
              {/* QUI-10 — quem reagiu, por extenso.
                  `quemReagiu.length` existe, mas ninguém o escreve na tela:
                  o caminho fácil aqui é listar os nomes, e é assim que o
                  mural não vira contagem de curtidas (CON-012). */}
              {momento.quemReagiu.length > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Heart className="w-3 h-3 text-zelo-green-fg shrink-0" fill="currentColor" aria-hidden />
                  {fraseDeQuemReagiu(momento.quemReagiu)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

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

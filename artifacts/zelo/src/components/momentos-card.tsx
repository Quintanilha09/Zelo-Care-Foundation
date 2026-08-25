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
import { comprimirFoto } from "@/lib/comprimir-imagem";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Camera, Trash2, ImagePlus, Loader2 } from "lucide-react";

interface Momento {
  id: number;
  kind: "image" | "video" | "audio";
  caption: string | null;
  criadoEm: string;
  autor: string | null;
  url: string;
  podeApagar: boolean;
}

interface RespostaDoMural {
  consentido: boolean;
  podeDecidirConsentimento: boolean;
  timezone: string;
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

export function MomentosCard({ patientId, patientName }: { patientId: number; patientName: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputArquivo = useRef<HTMLInputElement>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [legenda, setLegenda] = useState("");
  const [previa, setPrevia] = useState<{ url: string; arquivo: File } | null>(null);
  const [aApagar, setAApagar] = useState<Momento | null>(null);
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

  const apagar = async (momento: Momento) => {
    setAApagar(null);
    const res = await authFetch(`/api/media/${momento.id}`, { method: "DELETE" });
    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: corpo.error ?? "Não conseguimos apagar este momento.", variant: "destructive" });
      return;
    }
    await recarregar();
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

  if (isLoading || !mural) return null;

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
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={publicar} disabled={enviando} className="gap-2">
                {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
                {enviando ? "Enviando…" : "Publicar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={limparPrevia} disabled={enviando}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
      </div>

      {/* O mural */}
      {mural.momentos.length === 0 ? (
        // Convite, nunca cobrança. Nada de "faz X dias sem foto" (CON-011).
        <p className="text-sm text-muted-foreground">
          Ainda não há nenhuma foto aqui. Quando houver, a família toda vê.
        </p>
      ) : (
        <ul className="space-y-4">
          {mural.momentos.map((momento) => (
            <li key={momento.id} className="space-y-2">
              <img
                src={apiUrl(momento.url)}
                alt={momento.caption ?? `Momento de ${patientName}`}
                loading="lazy"
                className="w-full rounded-lg border bg-muted"
              />
              {momento.caption && <p className="text-sm">{momento.caption}</p>}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {momento.autor ?? "Alguém da família"} · {quando(momento.criadoEm, mural.timezone)}
                </p>
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

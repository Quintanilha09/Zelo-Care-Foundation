import { useCallback, useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import {
  prepararParaRecorte, recortarQuadrado, FotoPequenaDemais,
  type AreaDeRecorte, type FotoPreparada,
} from "@/lib/recortar-imagem";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ZoomIn } from "lucide-react";

/**
 * Escolher qual pedaço da foto vira o rosto — Issue #137.
 *
 * ── O que isto conserta ───────────────────────────────────────────────────
 *
 * Antes, a foto ia inteira e o avatar mostrava o centro geométrico dela. O
 * centro de uma foto raramente é onde está a cara de alguém: quem manda uma
 * foto de corpo inteiro vira um tronco redondo.
 *
 * A #132 já tinha parado de **esticar** (o `object-cover` que faltava). Isto
 * aqui é o passo seguinte: parar de **cortar no lugar errado**.
 *
 * ── Por que uma biblioteca, e por que esta ────────────────────────────────
 *
 * Decisão do fundador em 10/09/2026. A alternativa era escrever pinça e
 * arrasto à mão sobre o `comprimir-imagem.ts` — viável, e descartada porque
 * gesto de toque correto é bastante código e o público está no celular.
 *
 * `react-easy-crop@6.2.3`, MIT, uma única dependência transitiva
 * (`normalize-wheel`), zero avisos de segurança na auditoria de 10/09/2026.
 *
 * ── Só no avatar ──────────────────────────────────────────────────────────
 *
 * Momentos é memória de família, e a proporção é a que a vida deu. Recortar
 * lá tiraria da foto justamente o que ela tem.
 */

/** Quanto dá para aproximar. Além de 3× uma foto de rosto vira grão. */
const ZOOM_MAXIMO = 3;

export function RecortarFoto({
  arquivo,
  onCancelar,
  onPronto,
  enviando,
}: {
  /** `null` fecha o diálogo. */
  arquivo: File | null;
  onCancelar: () => void;
  onPronto: (recortada: File) => void;
  enviando: boolean;
}) {
  const [preparada, setPreparada] = useState<FotoPreparada | null>(null);
  const [erro, setErro] = useState("");
  const [posicao, setPosicao] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<AreaDeRecorte | null>(null);
  const [cortando, setCortando] = useState(false);

  // Preparar é assíncrono (decodifica e normaliza a orientação), então a
  // imagem só existe depois que o diálogo já abriu. `liberar` na limpeza é
  // obrigatório: sem ele cada foto escolhida deixa um blob preso na memória.
  useEffect(() => {
    if (!arquivo) return;

    let viva = true;
    let atual: FotoPreparada | null = null;
    setErro("");
    setPreparada(null);
    setPosicao({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);

    void (async () => {
      try {
        const pronta = await prepararParaRecorte(arquivo);
        if (!viva) {
          pronta.liberar();
          return;
        }
        atual = pronta;
        setPreparada(pronta);
      } catch (e) {
        if (!viva) return;
        setErro(
          e instanceof FotoPequenaDemais
            ? e.message
            : "Não conseguimos abrir esta foto. Tente outra.",
        );
      }
    })();

    return () => {
      viva = false;
      atual?.liberar();
    };
  }, [arquivo]);

  const aoTerminarDeMover = useCallback((_: unknown, emPixels: AreaDeRecorte) => {
    setArea(emPixels);
  }, []);

  const confirmar = async () => {
    if (!preparada || !area) return;
    setCortando(true);
    setErro("");
    try {
      onPronto(await recortarQuadrado(preparada.url, area, arquivo?.name));
    } catch {
      setErro("Não conseguimos recortar a foto. Tente de novo.");
    } finally {
      setCortando(false);
    }
  };

  const ocupado = cortando || enviando;

  return (
    <Dialog open={arquivo !== null} onOpenChange={(aberto) => { if (!aberto && !ocupado) onCancelar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enquadre o seu rosto</DialogTitle>
          <DialogDescription>
            Arraste para mover e use a barra para aproximar. É assim que a sua
            família vai te ver.
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <Alert variant="destructive">
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {preparada && (
          <>
            {/* `cropShape="round"` mostra o CÍRCULO de verdade. Um quadrado
                aqui faria a pessoa enquadrar uma coisa e receber outra — o
                avatar é redondo em toda tela do app. */}
            <div className="relative h-64 w-full overflow-hidden rounded-xl bg-muted">
              <Cropper
                image={preparada.url}
                crop={posicao}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                minZoom={1}
                maxZoom={ZOOM_MAXIMO}
                onCropChange={setPosicao}
                onZoomChange={setZoom}
                onCropComplete={aoTerminarDeMover}
              />
            </div>

            <div className="flex items-center gap-3">
              <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <Slider
                aria-label="Aproximar"
                value={[zoom]}
                min={1}
                max={ZOOM_MAXIMO}
                step={0.01}
                onValueChange={([v]) => setZoom(v)}
                disabled={ocupado}
              />
            </div>
          </>
        )}

        {!preparada && !erro && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Abrindo a foto…
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={!area || ocupado}>
            {ocupado ? "Enviando…" : "Usar esta foto"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

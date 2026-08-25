/**
 * Mandar um recado — QUI-8, no modo idoso.
 *
 * ── Segurar para falar, soltar para enviar ────────────────────────────────
 *
 * É o gesto do aplicativo de mensagem que essa geração já conhece, e evita o
 * erro mais comum de gravador com dois toques: começar a gravar e esquecer
 * de parar.
 *
 * Funciona com toque e com mouse. `onPointer*` cobre os dois, e o
 * `pointercancel` importa de verdade: se o dedo escorrega para fora do
 * botão, a gravação para em vez de ficar aberta para sempre.
 *
 * ── O que esta tela NÃO faz ───────────────────────────────────────────────
 *
 * - **Nenhuma transcrição.** Processar a fala de uma pessoa vulnerável não é
 *   o recurso; é outro produto, com outras implicações.
 * - **Nenhuma senha.** O aparelho dela já é o fator de autenticação.
 * - **Nenhum texto pequeno.** Tudo aqui está no tamanho do resto do modo
 *   idoso, porque é a mesma pessoa olhando.
 */
import { useRef, useState } from "react";
import { patientFetch } from "@/lib/patient-access";
import { comecarGravacao, gravacaoDisponivel, SEGUNDOS_MAXIMOS, type Gravacao } from "@/lib/gravar-audio";
import { Mic, Check } from "lucide-react";

type Estado = "parado" | "gravando" | "enviando" | "enviado";

export function BotaoRecado() {
  const [estado, setEstado] = useState<Estado>("parado");
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState("");
  const gravacao = useRef<Gravacao | null>(null);
  const cronometro = useRef<ReturnType<typeof setInterval> | null>(null);

  // Aparelho sem microfone, ou navegador que não grava: o botão não aparece.
  // Melhor não existir do que existir e falhar quando a pessoa apertar.
  if (!gravacaoDisponivel()) return null;

  const pararCronometro = () => {
    if (cronometro.current) clearInterval(cronometro.current);
    cronometro.current = null;
  };

  const comecar = async () => {
    if (estado !== "parado" && estado !== "enviado") return;
    setErro("");
    setSegundos(0);
    try {
      gravacao.current = await comecarGravacao();
      setEstado("gravando");
      cronometro.current = setInterval(() => {
        setSegundos((s) => {
          // Chegou no limite: encerra sozinha, exatamente como o gravador já
          // faz por dentro. A tela só precisa acompanhar.
          if (s + 1 >= SEGUNDOS_MAXIMOS) void terminar();
          return s + 1;
        });
      }, 1000);
    } catch {
      setErro("Não consegui usar o microfone. Toque em permitir quando o aparelho perguntar.");
      setEstado("parado");
    }
  };

  const terminar = async () => {
    pararCronometro();
    const atual = gravacao.current;
    if (!atual) return;
    gravacao.current = null;
    setEstado("enviando");

    try {
      const arquivo = await atual.parar();
      const form = new FormData();
      form.append("arquivo", arquivo);
      const res = await patientFetch("/api/patient-access/momento", { method: "POST", body: form });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? "Não consegui enviar seu recado.");
      }
      setEstado("enviado");
      // Volta ao normal sozinho — ninguém precisa fechar nada.
      setTimeout(() => setEstado("parado"), 4000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui enviar seu recado.");
      setEstado("parado");
    }
  };

  const cancelarPorErro = () => {
    pararCronometro();
    gravacao.current?.cancelar();
    gravacao.current = null;
    setEstado("parado");
  };

  if (estado === "enviado") {
    return (
      <div className="flex items-center gap-3 min-h-16 px-8 rounded-2xl bg-zelo-green-bg text-2xl text-zelo-green-fg">
        <Check className="w-8 h-8" strokeWidth={3} /> Recado enviado
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        // Segurar para gravar, soltar para enviar.
        onPointerDown={() => void comecar()}
        onPointerUp={() => void terminar()}
        onPointerLeave={() => estado === "gravando" && void terminar()}
        onPointerCancel={cancelarPorErro}
        // O navegador não pode tratar o toque longo como seleção de texto ou
        // menu de contexto — senão o gesto de segurar é sequestrado.
        onContextMenu={(e) => e.preventDefault()}
        disabled={estado === "enviando"}
        className={
          "flex items-center gap-3 min-h-16 px-8 rounded-2xl border-2 text-2xl select-none touch-none " +
          (estado === "gravando"
            ? "border-zelo-amber bg-zelo-amber-bg text-zelo-amber-fg"
            : "border-[#2D2D2B]/20 text-[#2D2D2B]")
        }
      >
        <Mic className="w-8 h-8" />
        {estado === "gravando"
          ? `Falando… ${SEGUNDOS_MAXIMOS - segundos}s`
          : estado === "enviando"
            ? "Enviando…"
            : "Mandar um recado"}
      </button>

      {estado === "parado" && !erro && (
        <p className="text-lg text-[#6B6B6B]">Segure o botão e fale. Solte quando terminar.</p>
      )}

      {erro && (
        // Âmbar, nunca vermelho: é um aviso, não uma ação destrutiva.
        <div className="rounded-2xl bg-zelo-amber-bg border border-zelo-amber/30 px-5 py-4">
          <p className="text-xl text-zelo-amber-fg leading-snug">{erro}</p>
        </div>
      )}
    </div>
  );
}

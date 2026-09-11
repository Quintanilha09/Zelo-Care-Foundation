/**
 * A tela que liga o segundo fator — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELA EXISTE PARA GARANTIR UMA ORDEM: GERAR OS CÓDIGOS, GUARDAR, E SÓ ENTÃO
 * TRANCAR A PORTA. NÃO É UM FORMULÁRIO — É A ORDEM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O fundador decidiu que o segundo fator é obrigatório. Enquanto era opcional,
 * quem não quisesse simplesmente não ligava; obrigatório, quem perder o acesso
 * ao e-mail perde a conta — e num app de medicamento de idoso isso é cuidador
 * trancado do lado de fora com a dose para registrar.
 *
 * Por isso esta tela **bloqueia**, e por isso ela não tem "fazer depois". Mas
 * bloquear só é aceitável porque ela não depende de nada de fora: nenhum
 * e-mail precisa chegar, nenhum aplicativo precisa ser instalado. São três
 * cliques e trinta segundos, e o aparelho de agora já sai confiável.
 *
 * ── Onde ela NÃO aparece ──────────────────────────────────────────────────
 *
 * Depois do gate do modo idoso, nunca antes. Se aparecesse antes, a tela do
 * paciente idoso seria tomada por um pedido de segurança que não é dele e que
 * ele não tem como cumprir — invariante 6 na forma mais direta que ele tem.
 */
import { useCallback, useEffect, useState } from "react";
import { authFetch, guardarTokenDeAparelho } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";

interface Estado {
  ativoEm: string | null;
  codigosRestantes: number;
  diasDeConfianca: number;
}

type Fase = "carregando" | "convite" | "codigos" | "pronto";

export function AtivacaoDoSegundoFator({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fase, setFase] = useState<Fase>("carregando");
  const [codigos, setCodigos] = useState<string[]>([]);
  const [guardei, setGuardei] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await authFetch("/api/account/segundo-fator");
      if (!res.ok) {
        // A tela não pode ser o motivo de ninguém ficar sem o app. Se o
        // servidor não responde, o certo é deixar passar: o login continua
        // pedindo código de aparelho novo de qualquer forma, que é onde a
        // proteção de verdade acontece.
        setFase("pronto");
        return;
      }
      const dados = (await res.json()) as Estado;
      setEstado(dados);
      setFase(dados.ativoEm ? "pronto" : "convite");
    } catch {
      setFase("pronto");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function gerar() {
    setErro("");
    setOcupado(true);
    try {
      const res = await authFetch("/api/account/segundo-fator/codigos", { method: "POST", body: "{}" });
      const dados = (await res.json()) as { codigos?: string[]; error?: string };
      if (!res.ok || !dados.codigos) {
        setErro(dados.error ?? "Não conseguimos gerar seus códigos. Tente de novo.");
        return;
      }
      setCodigos(dados.codigos);
      setFase("codigos");
    } catch {
      setErro("Não conseguimos falar com o servidor. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }

  async function ativar() {
    setErro("");
    setOcupado(true);
    try {
      const res = await authFetch("/api/account/segundo-fator/ativar", { method: "POST", body: "{}" });
      const dados = (await res.json()) as { deviceToken?: string; error?: string };
      if (!res.ok) {
        setErro(dados.error ?? "Não conseguimos ativar. Tente de novo.");
        return;
      }
      // Sem guardar isto, a próxima entrada NESTE aparelho pediria código — e
      // a pessoa pensaria que a ativação deu errado.
      if (dados.deviceToken) guardarTokenDeAparelho(dados.deviceToken);
      setFase("pronto");
    } catch {
      setErro("Não conseguimos falar com o servidor. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }

  function copiar() {
    void navigator.clipboard?.writeText(codigos.join("\n"));
  }

  function baixar() {
    const texto = [
      "Códigos de recuperação do ZELO",
      "",
      "Cada código serve UMA vez, para entrar quando o código do e-mail não chegar.",
      "Guarde este arquivo, ou imprima e deixe num lugar seguro.",
      "",
      ...codigos,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "zelo-codigos-de-recuperacao.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (fase === "pronto") return <>{children}</>;

  if (fase === "carregando") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-[#2D2D2B]">ZELO</p>
          <p className="text-sm text-[#6B6B6B]">Carregando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-[#6B6B6B]">Segurança da conta</p>
          <h1 className="text-2xl font-bold text-[#2D2D2B]">Vamos proteger o acesso ao ZELO</h1>
          <p className="text-sm text-[#5A5A58]">
            A partir de agora, entrar de um aparelho novo pede um código enviado para o seu e-mail. Sua
            senha, sozinha, deixa de bastar — mesmo que ela vaze em outro site.
          </p>
        </header>

        {erro && (
          <Alert variant="destructive">
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {fase === "convite" && (
          <div className="space-y-4 rounded-xl border bg-white p-5">
            <p className="text-sm text-[#2D2D2B]">
              Antes de ligar, você recebe <strong>10 códigos de recuperação</strong>. Eles são a sua
              chave reserva: servem para entrar no dia em que o e-mail não chegar, ou se você perder o
              acesso a ele.
            </p>
            <p className="text-sm text-[#5A5A58]">
              Este aparelho já fica confiável por {estado?.diasDeConfianca ?? 30} dias, renovando toda
              vez que você usar o app. Na prática, você não vai ver código nenhum no dia a dia.
            </p>
            <Button className="w-full" onClick={gerar} disabled={ocupado}>
              {ocupado ? "Gerando…" : "Gerar meus códigos"}
            </Button>
          </div>
        )}

        {fase === "codigos" && (
          <div className="space-y-4 rounded-xl border bg-white p-5">
            <Alert>
              <AlertDescription>
                <strong>Esta é a única vez que estes códigos aparecem.</strong> Guarde agora — depois
                não há como vê-los de novo, só gerar outros.
              </AlertDescription>
            </Alert>

            <ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="lista-de-codigos">
              {codigos.map((codigo) => (
                <li key={codigo} className="rounded-md border bg-background px-3 py-2 text-center tracking-wider">
                  {codigo}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copiar}>
                Copiar
              </Button>
              <Button variant="outline" size="sm" onClick={baixar}>
                Baixar
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                Imprimir
              </Button>
            </div>

            <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <Checkbox
                checked={guardei}
                onCheckedChange={(v: boolean | "indeterminate") => setGuardei(v === true)}
                aria-label="Guardei meus códigos"
              />
              <span className="text-[#2D2D2B]">
                Guardei meus códigos num lugar seguro, fora deste aparelho.
              </span>
            </label>

            {/* Confirmar que guardou é exigência do fundador, e não teatro:
                exibir e seguir adiante deixaria metade das pessoas com a chave
                reserva perdida sem nunca terem percebido que tinham uma. */}
            <Button className="w-full" onClick={ativar} disabled={!guardei || ocupado}>
              {ocupado ? "Ativando…" : "Ativar e continuar"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

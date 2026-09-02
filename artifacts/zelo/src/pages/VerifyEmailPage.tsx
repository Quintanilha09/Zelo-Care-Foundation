/**
 * Confirmar o e-mail da conta — ZELO.
 *
 * Rota `/verificar-email?token=…`, o destino do link do e-mail de cadastro.
 *
 * ── Por que esta tela existe ──────────────────────────────────────────────
 *
 * `POST /api/auth/verify-email` existe desde o começo e funciona. **Nenhuma
 * tela o chamava.** Só quatro caminhos ficam fora do portão de autenticação em
 * `App.tsx` (`/status`, `/admin`, `/convite`, `/acesso`); qualquer outro, sem
 * sessão, cai em `<AuthPage />` — a tela de login genérica, que ignora a query
 * string. Ou seja: o link do e-mail levava a pessoa para um formulário de login
 * que ela ainda não podia usar, porque entrar exige `emailVerified`, e nada
 * naquela tela verificava coisa alguma. Um beco sem saída silencioso.
 *
 * Isso não incomodava ninguém enquanto e-mail nenhum saía. A Issue #73 ligou o
 * envio de verdade, e o beco passou a ter tráfego.
 *
 * ── Fora do portão de autenticação, de propósito ──────────────────────────
 *
 * Quem chega aqui, por definição, **não consegue** logar ainda: é exatamente a
 * verificação que falta. Exigir sessão para verificar seria circular.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Situacao = "verificando" | "pronto" | "erro";

export default function VerifyEmailPage() {
  const [, setLocation] = useLocation();
  const [situacao, setSituacao] = useState<Situacao>("verificando");
  const [recado, setRecado] = useState("");

  // O token é de uso único: o servidor o marca como usado na primeira chamada.
  // Sem esta trava, qualquer segunda execução do efeito — StrictMode hoje não
  // está ligado, mas ligar é uma linha em `main.tsx` — gastaria o token na ida
  // e mostraria "link inválido" na volta, num fluxo que tinha funcionado.
  const jaPediu = useRef(false);

  const token = new URLSearchParams(window.location.search).get("token");

  useEffect(() => {
    if (jaPediu.current) return;
    jaPediu.current = true;

    if (!token) {
      setSituacao("erro");
      setRecado("Este link está incompleto — falta o código de confirmação. Abra o link direto do e-mail, sem editar o endereço.");
      return;
    }

    void (async () => {
      try {
        const resposta = await fetch(`${BASE}/api/auth/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const dados = (await resposta.json()) as { error?: string; message?: string };

        if (!resposta.ok) {
          setSituacao("erro");
          setRecado(
            dados.error === "Token inválido ou expirado"
              ? "Este link já foi usado ou passou das 24 horas. Se a conta ainda não está confirmada, cadastre-se de novo com o mesmo e-mail."
              : (dados.error ?? "Não foi possível confirmar o e-mail agora."),
          );
          return;
        }

        setSituacao("pronto");
        setRecado(dados.message ?? "E-mail confirmado.");
      } catch {
        setSituacao("erro");
        setRecado("Não foi possível falar com o servidor. Verifique sua conexão e abra o link de novo.");
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F7F5] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle
            className="text-2xl font-semibold"
            style={{ fontFamily: "DM Sans, system-ui, sans-serif" }}
          >
            Confirmação de e-mail
          </CardTitle>
          <CardDescription>ZELO — cuidado compartilhado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {situacao === "verificando" && (
            <p className="text-sm text-muted-foreground">Confirmando seu e-mail…</p>
          )}

          {situacao === "pronto" && (
            <>
              <Alert>
                <AlertDescription>{recado}</AlertDescription>
              </Alert>
              <Button className="w-full" onClick={() => setLocation("/")}>
                Entrar agora
              </Button>
            </>
          )}

          {situacao === "erro" && (
            <>
              {/* Sem `variant="destructive"`: erro de link expirado não é
                  emergência, e o vermelho neste app carrega significado de
                  dose. Ver o invariante 5 no CLAUDE.md. */}
              <Alert>
                <AlertDescription>{recado}</AlertDescription>
              </Alert>
              <Button variant="outline" className="w-full" onClick={() => setLocation("/")}>
                Ir para a tela de entrada
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

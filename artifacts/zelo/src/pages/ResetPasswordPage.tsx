/**
 * Criar uma senha nova — ZELO.
 *
 * Rota `/redefinir-senha?token=…`, o destino do link do e-mail de recuperação.
 *
 * ── Por que esta tela existe ──────────────────────────────────────────────
 *
 * Mesma história de `VerifyEmailPage`: `POST /api/auth/password-reset/confirm`
 * existe e funciona; nenhuma tela o chamava. O `AuthPage` tem a metade que
 * **pede** o link ("esqueci minha senha"), e nunca teve a metade que o
 * **consome**. Quem clicasse no link caía no formulário de login sem nenhuma
 * indicação do que fazer — com um token válido na barra de endereço, ignorado.
 *
 * ── Duas decisões de tela ─────────────────────────────────────────────────
 *
 * 1. **Campo de confirmação.** Errar a digitação de uma senha que você não vê,
 *    num token de uso único, custa um novo pedido de e-mail inteiro. O segundo
 *    campo é barato perto disso.
 * 2. **A regra aparece antes do erro.** "Pelo menos 8 caracteres" fica escrito
 *    embaixo do campo desde o início, e não só depois que o servidor recusa —
 *    ver `validatePasswordStrength` em `lib/password.ts`, que é a fonte da
 *    regra.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CampoLabel } from "@/components/campo-label";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Espelha `validatePasswordStrength` do servidor. Ele continua sendo a fronteira. */
const MINIMO_DE_CARACTERES = 8;

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token");

  async function aoEnviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }
    if (senha.length < MINIMO_DE_CARACTERES) {
      setErro(`A senha precisa ter pelo menos ${MINIMO_DE_CARACTERES} caracteres.`);
      return;
    }

    setEnviando(true);
    try {
      const resposta = await fetch(`${BASE}/api/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: senha }),
      });

      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => ({}))) as { error?: string };
        setErro(
          dados.error === "Link inválido ou expirado"
            ? "Este link já foi usado ou passou de 1 hora. Peça um novo em “Esqueci minha senha”."
            : (dados.error ?? "Não foi possível trocar a senha agora."),
        );
        return;
      }

      setPronto(true);
    } catch {
      setErro("Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  // Link sem token não é erro de digitação de senha: é um endereço quebrado, e
  // mostrar o formulário só levaria a pessoa a preencher tudo para falhar no
  // fim.
  if (!token) {
    return (
      <Moldura>
        <Alert>
          <AlertDescription>
            Este link está incompleto — falta o código. Abra o link direto do e-mail, sem editar o
            endereço.
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="w-full" onClick={() => setLocation("/")}>
          Ir para a tela de entrada
        </Button>
      </Moldura>
    );
  }

  if (pronto) {
    return (
      <Moldura>
        <Alert>
          <AlertDescription>
            Senha trocada. Por segurança, as sessões abertas nos outros aparelhos foram encerradas —
            entre de novo com a senha nova.
          </AlertDescription>
        </Alert>
        <Button className="w-full" onClick={() => setLocation("/")}>
          Entrar
        </Button>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <form onSubmit={aoEnviar} className="space-y-4 text-left">
        <div className="space-y-2">
          <CampoLabel htmlFor="senha-nova" obrigatorio>
            Senha nova
          </CampoLabel>
          <Input
            id="senha-nova"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Pelo menos {MINIMO_DE_CARACTERES} caracteres.
          </p>
        </div>

        <div className="space-y-2">
          <CampoLabel htmlFor="senha-confirmacao" obrigatorio>
            Repita a senha nova
          </CampoLabel>
          <Input
            id="senha-confirmacao"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            required
          />
        </div>

        {erro && (
          <Alert>
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={enviando}>
          {enviando ? "Trocando…" : "Trocar a senha"}
        </Button>
      </form>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F7F5] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle
            className="text-2xl font-semibold"
            style={{ fontFamily: "DM Sans, system-ui, sans-serif" }}
          >
            Nova senha
          </CardTitle>
          <CardDescription>ZELO — cuidado compartilhado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">{children}</CardContent>
      </Card>
    </div>
  );
}

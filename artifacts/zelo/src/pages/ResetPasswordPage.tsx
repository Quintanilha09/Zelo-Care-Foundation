/**
 * Criar uma senha nova — ZELO.
 *
 * Rota `/redefinir-senha`.
 *
 * ── Por que esta tela existe ──────────────────────────────────────────────
 *
 * Mesma história de `VerifyEmailPage`: `POST /api/auth/password-reset/confirm`
 * existe e funciona; nenhuma tela o chamava. O `AuthPage` tem a metade que
 * **pede** a recuperação, e nunca teve a metade que a **consome**.
 *
 * ── Era link, virou código — Issue #102 ───────────────────────────────────
 *
 * Em 03/09/2026 o fundador ficou sem conseguir trocar a senha: o e-mail chegou
 * perfeito e o link levava a uma página de erro do Replit, porque `APP_URL`
 * apontava para um app que nunca foi publicado. Terceiro tropeço na mesma
 * variável em dois dias.
 *
 * Agora o e-mail traz um **código de 6 dígitos**, e esta tela o pede. Quem
 * chega aqui vindo da aba "Recuperar" já está com a tela aberta — não troca de
 * aparelho, não caça link, não depende de endereço nenhum estar certo.
 *
 * ── Os dois modos, e por que o segundo ainda existe ───────────────────────
 *
 * Com `?token=` na URL, a tela pede só a senha: é o caminho dos **links que já
 * estavam na caixa de entrada de alguém** quando isto subiu. Eles valem uma
 * hora, e recusá-los transformaria a melhoria em quebra para quem pediu a
 * senha cinco minutos antes do deploy.
 *
 * Esse modo se apaga sozinho — nenhum token novo é emitido.
 *
 * ── Duas decisões de tela que sobreviveram às duas versões ────────────────
 *
 * 1. **Campo de confirmação.** Errar a digitação de uma senha que você não vê,
 *    num código de uso único, custa um pedido inteiro de novo.
 * 2. **A regra aparece antes do erro.** "Pelo menos 8 caracteres" fica escrito
 *    embaixo do campo desde o início, e não só depois que o servidor recusa —
 *    ver `validatePasswordStrength` em `lib/password.ts`, que é a fonte da
 *    regra.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { CampoLabel } from "@/components/campo-label";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Espelha `validatePasswordStrength` do servidor. Ele continua sendo a fronteira. */
const MINIMO_DE_CARACTERES = 8;

/** Espelha `DIGITOS` de `lib/codigo-de-verificacao.ts`. */
const DIGITOS = 6;

/**
 * Onde a aba "Recuperar" deixa o e-mail para esta tela.
 *
 * `sessionStorage`, e não a URL: e-mail em barra de endereço vira histórico do
 * navegador e linha de log de servidor. Mesmo padrão do `CHAVE_DO_EMAIL` da
 * confirmação de conta.
 */
export const CHAVE_DO_EMAIL_DA_SENHA = "zelo:email-da-senha";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token");

  // Preenche o e-mail que a aba "Recuperar" acabou de usar. Redigitar o
  // endereço na tela seguinte é um passo sem função, e é onde a pessoa erra.
  useEffect(() => {
    if (token) return;
    try {
      const guardado = sessionStorage.getItem(CHAVE_DO_EMAIL_DA_SENHA);
      if (guardado) setEmail(guardado);
    } catch {
      // Armazenamento bloqueado: a pessoa digita o e-mail, e nada quebra.
    }
  }, [token]);

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
    if (!token && codigo.length < DIGITOS) {
      setErro("Digite os 6 dígitos do código que chegou no seu e-mail.");
      return;
    }
    if (!token && !email.trim()) {
      setErro("Digite o e-mail que você usou no cadastro.");
      return;
    }

    setEnviando(true);
    try {
      const resposta = await fetch(`${BASE}/api/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          token
            ? { token, newPassword: senha }
            : { email: email.trim(), codigo, newPassword: senha },
        ),
      });

      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => ({}))) as { error?: string };
        setErro(dados.error ?? "Não foi possível trocar a senha agora.");
        // O código morre na quinta tentativa errada. Limpar o campo deixa
        // claro que é para digitar de novo, e não para editar o que está lá.
        setCodigo("");
        return;
      }

      try {
        sessionStorage.removeItem(CHAVE_DO_EMAIL_DA_SENHA);
      } catch {
        // Sem armazenamento não há o que limpar.
      }
      setPronto(true);
    } catch {
      setErro("Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.");
    } finally {
      setEnviando(false);
    }
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
        {/* Sem token, a pessoa precisa se identificar e provar que recebeu o
            e-mail. Com token, o próprio token já faz as duas coisas. */}
        {!token && (
          <>
            <div className="space-y-2">
              <CampoLabel htmlFor="email-da-senha" obrigatorio>
                E-mail do cadastro
              </CampoLabel>
              <Input
                id="email-da-senha"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <CampoLabel htmlFor="codigo-da-senha" obrigatorio>
                Código
              </CampoLabel>
              <InputOTP
                id="codigo-da-senha"
                maxLength={DIGITOS}
                value={codigo}
                onChange={(valor: string) => {
                  setCodigo(valor);
                  setErro("");
                }}
                // `one-time-code` faz o teclado do celular oferecer o
                // preenchimento do código que acabou de chegar.
                autoComplete="one-time-code"
                disabled={enviando}
              >
                <InputOTPGroup className="gap-2">
                  {Array.from({ length: DIGITOS }, (_, i) => (
                    <InputOTPSlot key={i} index={i} className="h-14 w-11 rounded-md border text-xl" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <p className="text-xs text-muted-foreground">
                Pode colar o código inteiro de uma vez. Ele vale 10 minutos.
              </p>
            </div>
          </>
        )}

        {/* Diferente da tela de confirmação de conta, aqui NÃO dá para enviar
            sozinho ao sexto dígito: falta a senha nova, que é o motivo de a
            pessoa estar aqui. */}
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

      {!token && (
        <div className="pt-2 border-t">
          <Button variant="ghost" className="w-full" onClick={() => setLocation("/")}>
            Não recebi o código — voltar e pedir de novo
          </Button>
        </div>
      )}
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
          <CardDescription>
            Escolha uma senha que você vai lembrar. Trocar encerra as sessões nos outros aparelhos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">{children}</CardContent>
      </Card>
    </div>
  );
}

/**
 * Confirmar a conta com o código de 6 dígitos — ZELO, Issue #77.
 *
 * Rota `/verificar-email`, fora do portão de autenticação: quem chega aqui, por
 * definição, **ainda não consegue entrar** — é justamente a confirmação que
 * falta. Exigir sessão para confirmar seria circular.
 *
 * ── Era link, virou código ────────────────────────────────────────────────
 *
 * Até 02/09/2026 esta tela lia um token da URL e o mandava ao servidor: a
 * pessoa não fazia nada além de olhar. Agora ela digita — ou cola — seis
 * dígitos. Pedido do fundador, e melhor para o público deste app: o link
 * obrigava a sair do e-mail, às vezes trocando de aparelho no meio; o código
 * mantém tudo na mesma tela.
 *
 * ── Colar é requisito, não conveniência ───────────────────────────────────
 *
 * O fundador pediu explicitamente para poder copiar e colar. O `InputOTP`
 * (`components/ui/input-otp.tsx`, que estava instalado e sem uso desde sempre)
 * distribui sozinho um "123456" colado pelas seis casas. Vale para o código
 * colado com espaço no meio também — o servidor normaliza.
 *
 * ── De onde vem o e-mail ──────────────────────────────────────────────────
 *
 * O servidor precisa saber de quem é o código: com seis dígitos, o valor
 * sozinho não identifica ninguém. Quem acabou de se cadastrar chega com o
 * endereço em `sessionStorage`; quem voltou depois digita. **Nunca pela URL** —
 * endereço de e-mail em query string vaza para histórico, log de servidor e
 * cabeçalho `Referer`.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CampoLabel } from "@/components/campo-label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Onde o cadastro deixa o endereço para esta tela. */
export const CHAVE_DO_EMAIL = "zelo:email-a-confirmar";

const DIGITOS = 6;

export default function VerifyEmailPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(CHAVE_DO_EMAIL);
      if (guardado) setEmail(guardado);
    } catch {
      // Navegador com armazenamento bloqueado: a pessoa digita o e-mail. Não é
      // motivo para a tela deixar de funcionar.
    }
  }, []);

  async function confirmar(codigoParaEnviar: string) {
    if (enviando) return;
    setErro("");

    if (!email.trim()) {
      setErro("Digite o e-mail que você usou no cadastro.");
      return;
    }

    setEnviando(true);
    try {
      const resposta = await fetch(`${BASE}/api/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), codigo: codigoParaEnviar }),
      });

      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => ({}))) as { error?: string };
        setErro(dados.error ?? "Não foi possível confirmar agora.");
        // Limpa o campo: deixar o código errado ali convida a apertar de novo
        // sem mudar nada, e cada tentativa conta contra o limite de cinco.
        setCodigo("");
        return;
      }

      try {
        sessionStorage.removeItem(CHAVE_DO_EMAIL);
      } catch {
        /* idem */
      }
      setPronto(true);
    } catch {
      setErro("Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.");
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <Moldura>
        <Alert>
          <AlertDescription>
            E-mail confirmado. Agora é só entrar com seu e-mail e senha.
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
      <p className="text-sm text-muted-foreground">
        Enviamos um código de {DIGITOS} dígitos para o seu e-mail. Ele vale 10 minutos.
      </p>

      <form
        className="space-y-4 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmar(codigo);
        }}
      >
        <div className="space-y-2">
          <CampoLabel htmlFor="email-a-confirmar" obrigatorio>
            E-mail do cadastro
          </CampoLabel>
          <Input
            id="email-a-confirmar"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <CampoLabel htmlFor="codigo" obrigatorio>
            Código
          </CampoLabel>
          <InputOTP
            id="codigo"
            maxLength={DIGITOS}
            value={codigo}
            onChange={(valor: string) => {
              setCodigo(valor);
              setErro("");
              // Assim que o sexto dígito entra, confirma sozinho. Colar o
              // código e ainda ter que procurar um botão é um passo a mais sem
              // função nenhuma.
              if (valor.length === DIGITOS) void confirmar(valor);
            }}
            // `one-time-code` faz o teclado do celular oferecer o preenchimento
            // do código que acabou de chegar.
            autoComplete="one-time-code"
            disabled={enviando}
          >
            <InputOTPGroup className="gap-2">
              {Array.from({ length: DIGITOS }, (_, i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-14 w-11 rounded-md border text-xl"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <p className="text-xs text-muted-foreground">
            Pode colar o código inteiro de uma vez.
          </p>
        </div>

        {erro && (
          <Alert>
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={enviando || codigo.length < DIGITOS}>
          {enviando ? "Confirmando…" : "Confirmar"}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Não recebeu? Confira a caixa de spam. Se o prazo passou, cadastre-se de novo com o mesmo
        e-mail.
      </p>
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
            Confirmação de e-mail
          </CardTitle>
          <CardDescription>ZELO — cuidado compartilhado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">{children}</CardContent>
      </Card>
    </div>
  );
}

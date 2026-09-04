/**
 * E-mail de recuperação — Ajustes › Sua conta, Issue #87.
 *
 * ── Por que isto existe ───────────────────────────────────────────────────
 *
 * Para dar a quem perde o acesso ao e-mail um caminho de volta. É o único que
 * existe para **quem cuida sozinho** — e esse é o caso mais comum no começo: a
 * pessoa se cadastra, cadastra a mãe como paciente, e passa semanas sendo a
 * única cuidadora. Família com um cuidador só não tem resgate pela família.
 *
 * Fica em componente próprio, e não dentro de `SettingsAccountPage`, porque
 * aquela página já tem 960 linhas e três seções com estado próprio. Uma quarta
 * ali dentro tornaria o arquivo ilegível e o diff impossível de revisar.
 *
 * ── O texto da tela carrega o limite, de propósito ────────────────────────
 *
 * A pessoa precisa saber que este endereço **não entra na conta e não troca a
 * senha** — por duas razões opostas e igualmente importantes:
 *
 * 1. quem hesitaria em dar um segundo endereço fica tranquilo ao ler que ele
 *    não é uma segunda chave da mesma porta
 * 2. quem esperava que ele resolvesse tudo descobre agora, e não no dia em que
 *    perder o e-mail
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { CampoLabel } from "@/components/campo-label";

/** Espelha `DIGITOS` de `lib/codigo-de-verificacao.ts`. */
const DIGITOS = 6;

interface Estado {
  atual: string | null;
  desde: string | null;
  pendente: { email: string; expiraEm: string } | null;
}

export function EmailDeRecuperacao() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [senhaParaRemover, setSenhaParaRemover] = useState("");
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    try {
      const res = await authFetch("/api/account/recovery-email");
      if (res.ok) setEstado((await res.json()) as Estado);
    } catch {
      // Sem conexão a seção simplesmente não aparece. Não vale um alerta:
      // a página inteira já vai estar quebrada, e dois avisos não ajudam.
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  async function pedir(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    setEnviando(true);
    try {
      const res = await authFetch("/api/account/recovery-email", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      const dados = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setErro(dados.error ?? "Não foi possível cadastrar agora.");
        return;
      }
      setAviso(dados.message ?? "Código enviado.");
      setEmail("");
      await carregar();
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar(valor: string) {
    setErro("");
    setEnviando(true);
    try {
      const res = await authFetch("/api/account/recovery-email/confirm", {
        method: "POST",
        body: JSON.stringify({ codigo: valor }),
      });
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(dados.error ?? "Código inválido.");
        setCodigo("");
        return;
      }
      setAviso("Endereço de recuperação confirmado.");
      setCodigo("");
      await carregar();
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setEnviando(false);
    }
  }

  async function remover(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    setEnviando(true);
    try {
      const res = await authFetch("/api/account/recovery-email", {
        method: "DELETE",
        body: JSON.stringify({ senhaAtual: senhaParaRemover }),
      });
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(dados.error ?? "Não foi possível remover.");
        return;
      }
      setAviso("Endereço de recuperação removido.");
      setSenhaParaRemover("");
      setRemovendo(false);
      await carregar();
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setEnviando(false);
    }
  }

  if (!estado) return null;

  return (
    <section className="space-y-4 pt-2 border-t">
      <div>
        <h2 className="font-medium">E-mail de recuperação</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Um segundo endereço, para você voltar caso perca o acesso ao principal.
          {/* O limite escrito na tela, e não só no código. */}{" "}
          <strong>Ele não entra na sua conta e não troca a sua senha</strong> — serve só
          para provar que é você quando faltar o outro.
        </p>
      </div>

      {estado.atual && !estado.pendente && (
        <div className="space-y-3">
          <Alert>
            <AlertDescription>
              Seu endereço de recuperação é <strong>{estado.atual}</strong>.
            </AlertDescription>
          </Alert>

          {removendo ? (
            <form onSubmit={remover} className="space-y-3">
              <div className="space-y-2">
                <CampoLabel htmlFor="senha-remover-recuperacao" obrigatorio>
                  Sua senha atual
                </CampoLabel>
                <Input
                  id="senha-remover-recuperacao"
                  type="password"
                  autoComplete="current-password"
                  value={senhaParaRemover}
                  onChange={(ev) => setSenhaParaRemover(ev.target.value)}
                  required
                />
                {/* A assimetria com o cadastro merece explicação, senão parece
                    burocracia à toa. */}
                <p className="text-xs text-muted-foreground">
                  Pedimos a senha para remover, e não para cadastrar, porque remover tira
                  uma proteção sua — e é o que alguém faria antes de tentar tomar a conta.
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" size="sm" disabled={enviando}>
                  {enviando ? "Removendo…" : "Remover"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRemovendo(false);
                    setSenhaParaRemover("");
                    setErro("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setRemovendo(true)}>
              Remover ou trocar
            </Button>
          )}
        </div>
      )}

      {estado.pendente && (
        <div className="space-y-3">
          <Alert>
            <AlertDescription>
              Enviamos um código para <strong>{estado.pendente.email}</strong>. Digite abaixo
              para confirmar. Até lá, esse endereço ainda não vale.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <CampoLabel htmlFor="codigo-recuperacao" obrigatorio>
              Código
            </CampoLabel>
            <InputOTP
              id="codigo-recuperacao"
              maxLength={DIGITOS}
              value={codigo}
              onChange={(valor: string) => {
                setCodigo(valor);
                setErro("");
                // Assim que o sexto dígito entra, confirma sozinho — mesmo
                // comportamento da confirmação de conta.
                if (valor.length === DIGITOS) void confirmar(valor);
              }}
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
              Pode colar o código inteiro. Ele vale 10 minutos.
            </p>
          </div>
        </div>
      )}

      {!estado.pendente && (
        <form onSubmit={pedir} className="space-y-3">
          <div className="space-y-2">
            <CampoLabel htmlFor="email-de-recuperacao" obrigatorio>
              {estado.atual ? "Trocar para outro endereço" : "E-mail de recuperação"}
            </CampoLabel>
            <Input
              id="email-de-recuperacao"
              type="email"
              autoComplete="email"
              placeholder="outro-endereco@exemplo.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Precisa ser diferente do e-mail da sua conta — se fosse o mesmo, não ajudaria
              em nada no dia em que você perdesse o acesso a ele.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar código de confirmação"}
          </Button>
        </form>
      )}

      {erro && (
        <Alert>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
      {aviso && !erro && (
        <Alert>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}

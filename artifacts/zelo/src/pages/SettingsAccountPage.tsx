/**
 * Ajustes — Sua conta — ZELO (Issue #45).
 *
 * ── Por que esta tela precisou existir ────────────────────────────────────
 *
 * Até 01/09/2026 **não havia como mudar nada da própria conta**. Quem digitou
 * o nome errado no cadastro convivia com ele para sempre. Quem queria trocar
 * de senha precisava deslogar e fingir que esqueceu — num fluxo que depende de
 * e-mail e que **hoje não funciona em produção**, porque não há provedor de
 * e-mail configurado.
 *
 * É a primeira coisa que qualquer pessoa procura depois de criar conta, e a
 * ausência dela aparece numa auditoria de comprador antes de qualquer recurso
 * bonito.
 *
 * ── O e-mail não está aqui, e é de propósito ──────────────────────────────
 *
 * Trocar e-mail exige verificar o endereço novo antes de valer — senão um XSS
 * ou uma sessão esquecida vira sequestro permanente de conta: quem trocar o
 * e-mail passa a receber os próprios links de recuperação.
 *
 * Verificar exige provedor de e-mail, que depende do domínio, que depende do
 * nome definitivo. Está na Issue #46, bloqueada. Nome e senha não dependem de
 * nada — por isso vieram primeiro.
 */
import { useState } from "react";
import { Link } from "wouter";
import { authFetch, setTokens } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Check } from "lucide-react";

export default function SettingsAccountPage() {
  const { user, recarregarUsuario } = useAuth();

  const [nome, setNome] = useState(user?.name ?? "");
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [erroDoNome, setErroDoNome] = useState("");
  const [nomeSalvo, setNomeSalvo] = useState(false);

  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaRepetida, setSenhaRepetida] = useState("");
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [erroDaSenha, setErroDaSenha] = useState("");
  const [senhaTrocada, setSenhaTrocada] = useState(false);

  const salvarNome = async () => {
    setSalvandoNome(true);
    setErroDoNome("");
    setNomeSalvo(false);
    try {
      const res = await authFetch("/api/account/me", {
        method: "PATCH",
        body: JSON.stringify({ name: nome }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? "Não conseguimos salvar o nome.");
      }
      // O nome aparece no cabeçalho e em "quem registrou a dose" — a tela
      // inteira precisa saber que mudou.
      await recarregarUsuario();
      setNomeSalvo(true);
    } catch (e) {
      setErroDoNome(e instanceof Error ? e.message : "Não conseguimos salvar o nome.");
    } finally {
      setSalvandoNome(false);
    }
  };

  const trocarSenha = async () => {
    setErroDaSenha("");
    setSenhaTrocada(false);

    // Conferida aqui e no servidor. Aqui é para o erro chegar na hora de
    // digitar; lá é porque o cliente não é fronteira de segurança.
    if (senhaNova !== senhaRepetida) {
      setErroDaSenha("A nova senha e a repetição não conferem.");
      return;
    }

    setTrocandoSenha(true);
    try {
      const res = await authFetch("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: senhaAtual, newPassword: senhaNova }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? "Não conseguimos trocar a senha.");
      }

      // O servidor derrubou TODAS as sessões, inclusive esta, e devolveu um
      // par novo. Sem guardar aqui, a pessoa que acabou de trocar a senha
      // seria deslogada — que é o oposto do que ela pediu.
      const tokens = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
      setTokens(tokens);

      setSenhaAtual("");
      setSenhaNova("");
      setSenhaRepetida("");
      setSenhaTrocada(true);
    } catch (e) {
      setErroDaSenha(e instanceof Error ? e.message : "Não conseguimos trocar a senha.");
    } finally {
      setTrocandoSenha(false);
    }
  };

  const nomeMudou = nome.trim() !== (user?.name ?? "").trim();
  const podeTrocarSenha =
    senhaAtual.length > 0 && senhaNova.length > 0 && senhaRepetida.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href="/ajustes">
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Ajustes
          </a>
        </Link>

        <div>
          <h2 className="text-2xl font-semibold">Sua conta</h2>
          <p className="text-muted-foreground text-[17px]">
            Seu nome e sua senha.
          </p>
        </div>

        {/* ── Nome ─────────────────────────────────────────────────────── */}
        <section className="p-4 rounded-xl border bg-card shadow-sm space-y-3">
          <div>
            <h3 className="font-medium">Seu nome</h3>
            <p className="text-sm text-muted-foreground">
              É o que a família vê em “quem registrou a dose”.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="conta-nome">Nome</Label>
            <Input
              id="conta-nome"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setNomeSalvo(false);
              }}
              maxLength={100}
              autoComplete="name"
            />
          </div>

          {erroDoNome && (
            <Alert variant="destructive">
              <AlertDescription>{erroDoNome}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!nomeMudou || salvandoNome || nome.trim().length < 2}
              onClick={() => void salvarNome()}
            >
              {salvandoNome ? "Salvando…" : "Salvar"}
            </Button>
            {nomeSalvo && (
              <span className="text-sm text-zelo-green-fg inline-flex items-center gap-1.5">
                <Check className="w-4 h-4" aria-hidden /> Nome salvo
              </span>
            )}
          </div>
        </section>

        {/* ── Senha ────────────────────────────────────────────────────── */}
        <section className="p-4 rounded-xl border bg-card shadow-sm space-y-3">
          <div>
            <h3 className="font-medium">Sua senha</h3>
            <p className="text-sm text-muted-foreground">
              Ao trocar, todos os outros aparelhos são desconectados. Este
              continua.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha-atual">Senha atual</Label>
            <Input
              id="senha-atual"
              type="password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha-nova">Nova senha</Label>
            <Input
              id="senha-nova"
              type="password"
              value={senhaNova}
              onChange={(e) => setSenhaNova(e.target.value)}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">Pelo menos 8 caracteres.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha-repetida">Repita a nova senha</Label>
            <Input
              id="senha-repetida"
              type="password"
              value={senhaRepetida}
              onChange={(e) => setSenhaRepetida(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {erroDaSenha && (
            <Alert variant="destructive">
              <AlertDescription>{erroDaSenha}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!podeTrocarSenha || trocandoSenha}
              onClick={() => void trocarSenha()}
            >
              {trocandoSenha ? "Trocando…" : "Trocar a senha"}
            </Button>
            {senhaTrocada && (
              <span className="text-sm text-zelo-green-fg inline-flex items-center gap-1.5">
                <Check className="w-4 h-4" aria-hidden /> Senha trocada
              </span>
            )}
          </div>
        </section>

        {/* Dito, e não escondido: quem procura trocar o e-mail precisa saber
            por que não acha, senão procura para sempre. */}
        <p className="text-sm text-muted-foreground">
          Trocar o e-mail ainda não está disponível — ele é o seu login, e a
          troca só é segura com confirmação no endereço novo.
        </p>
      </main>
    </div>
  );
}

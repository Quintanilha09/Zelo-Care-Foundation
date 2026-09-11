/**
 * Aparelhos confiáveis — Ajustes › Sua conta, Issue #79.
 *
 * ── Lista sem botão de revogar é enfeite ──────────────────────────────────
 *
 * A frase é da própria Issue, e é o motivo de este componente existir em vez
 * de uma listagem estática. Ver "Chrome no Windows" e não poder desligá-lo não
 * ajuda ninguém: quem olha esta tela está desconfiado, e desconfiança sem ação
 * é só ansiedade.
 *
 * ── Os códigos ficam aqui também, e não em outra tela ─────────────────────
 *
 * Quantos ainda restam é a informação que decide se a pessoa está protegida ou
 * a um passo de perder a conta. Separar disto o lugar onde ela vê os aparelhos
 * faria com que ela só descobrisse o número no dia em que fosse usar o último.
 */
import { useCallback, useEffect, useState } from "react";
import { authFetch, esquecerTokenDeAparelho } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CampoLabel } from "@/components/campo-label";

interface Aparelho {
  id: number;
  label: string;
  createdIp: string | null;
  lastUsedAt: string;
  expiresAt: string;
}

interface Estado {
  ativoEm: string | null;
  codigosRestantes: number;
  poucosCodigos: boolean;
  diasDeConfianca: number;
}

function quando(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function AparelhosConfiaveis() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aparelhos, setAparelhos] = useState<Aparelho[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [regerando, setRegerando] = useState(false);
  const [senha, setSenha] = useState("");
  const [novosCodigos, setNovosCodigos] = useState<string[]>([]);

  const carregar = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        authFetch("/api/account/segundo-fator"),
        authFetch("/api/account/aparelhos"),
      ]);
      if (s.ok) setEstado((await s.json()) as Estado);
      if (a.ok) setAparelhos((await a.json()) as Aparelho[]);
    } catch {
      setErro("Não conseguimos carregar seus aparelhos.");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function revogar(id: number) {
    setErro("");
    setOcupado(true);
    try {
      const res = await authFetch(`/api/account/aparelhos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setErro("Não conseguimos desligar esse aparelho.");
        return;
      }
      setAviso("Aparelho desligado. A próxima entrada dele vai pedir código.");
      await carregar();
    } finally {
      setOcupado(false);
    }
  }

  async function sairDeTodos() {
    setErro("");
    setOcupado(true);
    try {
      const res = await authFetch("/api/account/aparelhos/sair-de-todos", { method: "POST", body: "{}" });
      if (!res.ok) {
        setErro("Não conseguimos desligar os aparelhos.");
        return;
      }
      // Inclusive este. Guardar o token de um aparelho que o servidor acabou
      // de revogar faria a tela mentir na próxima entrada.
      esquecerTokenDeAparelho();
      setAviso("Todos os aparelhos foram desligados, inclusive este. A próxima entrada vai pedir código.");
      await carregar();
    } finally {
      setOcupado(false);
    }
  }

  async function gerarNovos(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setNovosCodigos([]);
    setOcupado(true);
    try {
      const res = await authFetch("/api/account/segundo-fator/codigos", {
        method: "POST",
        body: JSON.stringify({ senhaAtual: senha }),
      });
      const dados = (await res.json()) as { codigos?: string[]; error?: string };
      if (!res.ok || !dados.codigos) {
        setErro(dados.error ?? "Não conseguimos gerar códigos novos.");
        return;
      }
      setNovosCodigos(dados.codigos);
      setSenha("");
      setRegerando(false);
      await carregar();
    } finally {
      setOcupado(false);
    }
  }

  // Enquanto o segundo fator não estiver ativo nesta conta não há aparelho
  // confiável nenhum, e a seção não teria o que dizer.
  if (!estado?.ativoEm) return null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-[#2D2D2B]">Aparelhos confiáveis</h3>
        <p className="text-sm text-[#5A5A58]">
          Estes aparelhos entram sem pedir código, por {estado.diasDeConfianca} dias, renovando a cada
          uso. Se você não reconhece algum, desligue.
        </p>
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
      {aviso && (
        <Alert>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      {aparelhos.length === 0 ? (
        <p className="text-sm text-[#6B6B6B]">Nenhum aparelho confiável no momento.</p>
      ) : (
        <ul className="space-y-2">
          {aparelhos.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#2D2D2B]">{a.label}</p>
                <p className="text-xs text-[#6B6B6B]">
                  Último uso em {quando(a.lastUsedAt)}
                  {a.createdIp ? ` · registrado de ${a.createdIp}` : ""}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void revogar(a.id)} disabled={ocupado}>
                Desligar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {aparelhos.length > 0 && (
        <Button variant="outline" size="sm" onClick={() => void sairDeTodos()} disabled={ocupado}>
          Desligar todos, inclusive este
        </Button>
      )}

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-base font-semibold text-[#2D2D2B]">Códigos de recuperação</h3>
        <p className="text-sm text-[#5A5A58]">
          Você tem <strong>{estado.codigosRestantes}</strong>{" "}
          {estado.codigosRestantes === 1 ? "código" : "códigos"} ainda válidos.
        </p>

        {estado.poucosCodigos && (
          <Alert>
            <AlertDescription>
              Seus códigos estão acabando. Gere um jogo novo enquanto ainda consegue entrar — depois de
              acabarem, não há como gerar sem estar dentro da conta.
            </AlertDescription>
          </Alert>
        )}

        {novosCodigos.length > 0 && (
          <div className="space-y-2 rounded-md border bg-white p-3">
            <p className="text-sm font-medium text-[#2D2D2B]">
              Guarde agora — esta é a única vez que eles aparecem. Os antigos deixaram de valer.
            </p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
              {novosCodigos.map((c) => (
                <li key={c} className="rounded-md border bg-muted px-3 py-2 text-center tracking-wider">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {regerando ? (
          <form onSubmit={gerarNovos} className="space-y-3">
            {/* A senha só é pedida aqui, e não na primeira geração: gerar de
                novo invalida o jogo antigo, e uma sessão sequestrada usaria
                isso para trocar as chaves reservas da conta. Mesma assimetria
                do e-mail de recuperação (#87). */}
            <div className="space-y-2">
              <CampoLabel htmlFor="senha-para-codigos" obrigatorio>
                Sua senha atual
              </CampoLabel>
              <Input
                id="senha-para-codigos"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={ocupado}>
                Gerar jogo novo
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRegerando(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setRegerando(true)}>
            Gerar códigos novos
          </Button>
        )}
      </div>
    </div>
  );
}


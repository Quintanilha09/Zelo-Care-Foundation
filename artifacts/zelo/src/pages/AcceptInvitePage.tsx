/**
 * Aceitar convite de cuidador — ZELO.
 *
 * Rota /convite?token=... — nunca existiu antes (só o endpoint de backend
 * POST /api/invites/accept existia; clicar o link caía em 404 ou, sem
 * sessão, na tela de login genérica sem preservar o token nenhum).
 *
 * Funciona autenticado ou não:
 * - Sem sessão: mostra o motivo e embute a AuthPage. Antes disso, grava o
 *   token em sessionStorage (ver lib/pending-redirect) porque "Entrar com
 *   Google" tira o navegador da SPA de verdade — o backend sempre
 *   redireciona de volta pra "/" (ver google-auth.ts), não pra cá.
 *   AuthContext lê essa gravação depois da troca do oauth_code e navega de
 *   volta sozinho.
 * - Com sessão: aceita na hora.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { authFetch, setTokens } from "@/lib/auth-client";
import { setPendingRedirect } from "@/lib/pending-redirect";
import AuthPage from "./AuthPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Status = "accepting" | "accepted" | "error";

export default function AcceptInvitePage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("accepting");
  const [message, setMessage] = useState("");

  const token = new URLSearchParams(window.location.search).get("token");

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      if (token) setPendingRedirect(`/convite?token=${token}`);
      return;
    }

    if (!token) {
      setStatus("error");
      setMessage("Link de convite inválido — falta o token.");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch("/api/invites/accept", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as {
          error?: string; message?: string;
          accessToken?: string; refreshToken?: string; expiresIn?: number;
        };
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setMessage(data.error ?? "Não foi possível aceitar o convite.");
          return;
        }
        setStatus("accepted");
        setMessage(data.message ?? "Convite aceito!");
        // A família aceita agora É a família ativa da sessão (ver
        // POST /invites/accept) — precisa trocar o token local pro mesmo
        // valor, senão a tela inicial recarrega ainda presa na família
        // antiga. Recarrega de verdade (não só navega) pelo mesmo motivo
        // do switchFamily em AuthContext: todo cache do React Query
        // pertence à família anterior.
        if (data.accessToken && data.refreshToken && data.expiresIn) {
          setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn });
        }
        setTimeout(() => { window.location.href = "/"; }, 2500);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Erro de conexão ao aceitar o convite. Tente novamente.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [isLoading, isAuthenticated, token, setLocation]);

  if (isLoading) return null;

  if (!isAuthenticated) {
    return (
      <div>
        <div className="max-w-md mx-auto pt-8 px-4">
          <Alert>
            <AlertDescription>
              Você foi convidado(a) para cuidar em família no ZELO. Entre ou crie uma conta pra aceitar o convite.
            </AlertDescription>
          </Alert>
        </div>
        <AuthPage />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F7F5] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-semibold" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
            Convite de cuidador
          </CardTitle>
          <CardDescription>ZELO — cuidado compartilhado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {status === "accepting" && <p className="text-sm text-muted-foreground">Aceitando convite…</p>}
          {status === "accepted" && (
            <Alert><AlertDescription>{message} Redirecionando…</AlertDescription></Alert>
          )}
          {status === "error" && (
            <>
              <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>
              <Button onClick={() => setLocation("/")}>Ir para o início</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

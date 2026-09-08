import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useLocation } from 'wouter';
import {
  setTokens,
  clearTokens,
  refreshSession,
  getStoredRefreshToken,
  authFetch,
  lerTokenDeAparelho,
  guardarTokenDeAparelho,
} from '@/lib/auth-client';
import { consumePendingRedirect } from '@/lib/pending-redirect';
import type { PlanView } from '@/lib/plan-limits-client';

interface AuthUser {
  userId: number;
  name: string;
  email: string;
  emailVerified: boolean;
  caregiver?: {
    id: number;
    name: string;
    role: string;
    familyId: number;
    selectedPatientId: number | null;
  };
  family?: {
    name: string;
    retroactiveWindowHours: number;
    showMedicationInPush: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
  // ZELO-38: "estado do plano visível no perfil, sem martelar no dia a dia".
  // ZELO-56: com mais de um tier pago, `isPaid` deixou de bastar — `tier` e
  // `label` vêm junto, e `isPaid` fica por compatibilidade com telas antigas.
  plan?: PlanView | null;
}

/** O par de tokens que o servidor devolve, mais o do aparelho (#79). */
type SessaoDoServidor = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  deviceToken?: string;
};

/**
 * O que acontece depois de a senha estar certa — Issue #79.
 *
 * O login deixou de ter um só desfecho. Modelar isso como retorno, e não
 * como exceção, é de propósito: pedir código **não é erro**, e tratá-lo como
 * erro faria a tela mostrar um alerta vermelho para o caminho normal de quem
 * acabou de trocar de celular.
 */
export type ResultadoDoLogin =
  | { precisaDeCodigo: false }
  | { precisaDeCodigo: true; desafio: string; codigoEnviado: boolean; mensagem: string };

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<ResultadoDoLogin>;
  /** Confirma o código de aparelho novo e abre a sessão (#79). */
  confirmarAparelho: (
    desafio: string,
    chave: { codigo?: string; codigoDeRecuperacao?: string },
  ) => Promise<void>;
  /** "Não chegou" — pede outro código para o mesmo desafio (#79). */
  reenviarCodigoDeAparelho: (desafio: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  /**
   * Relê `/account/me` — Issue #45.
   *
   * O usuário NÃO vive no React Query: quem o carrega é o `loadMe` daqui.
   * Sem expor isto, trocar o próprio nome salvava no banco e a tela continuava
   * mostrando o antigo até o próximo carregamento da página.
   */
  recarregarUsuario: () => Promise<void>;
  /** Troca a família ativa. O token carrega familyId/caregiverId/role, então
   *  trocar de família é necessariamente trocar de token (ver active-family.ts). */
  switchFamily: (familyId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  const loadMe = useCallback(async () => {
    try {
      const res = await authFetch('/api/account/me');
      if (res.ok) {
        setUser(await res.json());
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  /**
   * O que fazer com um par de tokens recém-emitido — Issue #79.
   *
   * Três caminhos passam por aqui: o login direto, a confirmação do código de
   * aparelho novo e a volta do Google. Antes eram cópias de `setTokens` +
   * `loadMe`, e o `deviceToken` precisaria entrar em duas delas. Esquecê-lo
   * num dos caminhos faria a pessoa ver código toda vez, sem nenhum erro na
   * tela para explicar por quê.
   */
  const abrirSessao = useCallback(async (dados: SessaoDoServidor) => {
    if (dados.deviceToken) guardarTokenDeAparelho(dados.deviceToken);
    setTokens(dados);
    await loadMe();
  }, [loadMe]);

  // Ao montar: tenta restaurar sessão — inclui troca de oauth_code do Google
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);

      // Verifica se o Google redirecionou de volta com um login code
      const params = new URLSearchParams(window.location.search);
      const oauthCode = params.get("oauth_code");

      if (oauthCode) {
        // Remove o code da URL imediatamente (não fica no histórico do navegador)
        window.history.replaceState({}, "", window.location.pathname);
        try {
          const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
          const res = await fetch(`${BASE}/api/auth/google/exchange`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: oauthCode }),
          });
          if (res.ok) {
            const tokens = await res.json() as { accessToken: string; refreshToken: string; expiresIn: number };
            setTokens(tokens);
            await loadMe();
            // O backend do OAuth do Google sempre redireciona pra "/" (ver
            // res.redirect em google-auth.ts) — não importa de onde a SPA
            // saiu (ex: /convite?token=... ao aceitar convite). Sem isto,
            // qualquer fluxo que dependa de "voltar pra onde estava" depois
            // de logar com Google se perde.
            const pending = consumePendingRedirect();
            if (pending) setLocation(pending);
          } else {
            // Nunca falhar em silêncio aqui — sem isto, o cuidador via a
            // tela de login de novo sem entender o que aconteceu (o Google
            // "funcionou", mas a troca pelo token ZELO falhou). Reaproveita
            // a exibição de erro que já existe em AuthPage para ?auth_error.
            window.location.href = `${window.location.pathname}?auth_error=google_exchange_failed`;
          }
        } catch {
          window.location.href = `${window.location.pathname}?auth_error=google_exchange_failed`;
        }
      } else if (getStoredRefreshToken()) {
        const ok = await refreshSession();
        if (ok) await loadMe();
      }

      setIsLoading(false);
    };
    void init();
  }, [loadMe]);

  // Escuta evento de sessão expirada (disparado por authFetch)
  useEffect(() => {
    const handler = () => { setUser(null); };
    window.addEventListener('zelo:session-expired', handler);
    return () => window.removeEventListener('zelo:session-expired', handler);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<ResultadoDoLogin> => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // O token do aparelho vai junto. Ausente na primeira entrada, e
      // ausente para sempre em conta que não ativou o segundo fator — o
      // servidor simplesmente não olha.
      body: JSON.stringify({ email, password, deviceToken: lerTokenDeAparelho() ?? undefined }),
    });

    if (!res.ok) {
      const err = await res.json() as {
        error?: string; code?: string; desafio?: string; codigoEnviado?: boolean;
      };
      if (err.code === 'device_verification_required' && typeof err.desafio === 'string') {
        return {
          precisaDeCodigo: true,
          desafio: err.desafio,
          codigoEnviado: err.codigoEnviado !== false,
          mensagem: err.error ?? '',
        };
      }
      throw new Error(err.error ?? 'Erro ao fazer login');
    }

    await abrirSessao(await res.json() as SessaoDoServidor);
    return { precisaDeCodigo: false };
  }, [abrirSessao]);

  const confirmarAparelho = useCallback(async (
    desafio: string,
    chave: { codigo?: string; codigoDeRecuperacao?: string },
  ) => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${BASE}/api/auth/login/aparelho`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desafio, ...chave }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? 'Código inválido ou expirado.');
    }
    await abrirSessao(await res.json() as SessaoDoServidor);
  }, [abrirSessao]);

  // Sem tratamento de erro de propósito: a resposta é sempre a mesma, e não
  // diz se havia algo para reenviar. Ver a rota em routes/auth.ts.
  const reenviarCodigoDeAparelho = useCallback(async (desafio: string) => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
    await fetch(`${BASE}/api/auth/login/aparelho/reenviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desafio }),
    });
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken();
    try {
      await authFetch('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch { /* ignora — limpa tokens de qualquer forma */ }
    clearTokens();
    setUser(null);
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout-all', { method: 'POST' });
    } catch { /* ignora */ }
    clearTokens();
    setUser(null);
  }, []);

  const switchFamily = useCallback(async (familyId: number) => {
    const res = await authFetch('/api/account/switch-family', {
      method: 'POST',
      body: JSON.stringify({ familyId }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? 'Não foi possível trocar de família');
    }
    setTokens(await res.json() as { accessToken: string; refreshToken: string; expiresIn: number });
    await loadMe();
    // Recarrega a página: o paciente selecionado, as listas e todo cache do
    // React Query pertencem à família anterior — recarregar é mais honesto
    // (e mais simples) do que tentar invalidar cada consulta uma a uma.
    window.location.href = '/';
  }, [loadMe]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, confirmarAparelho, reenviarCodigoDeAparelho, logout, logoutAll, switchFamily, recarregarUsuario: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  setTokens,
  clearTokens,
  refreshSession,
  getStoredRefreshToken,
  authFetch,
} from '@/lib/auth-client';

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
  family?: { name: string; retroactiveWindowHours: number; showMedicationInPush: boolean };
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const login = useCallback(async (email: string, password: string) => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? 'Erro ao fazer login');
    }
    const tokens = await res.json() as { accessToken: string; refreshToken: string; expiresIn: number };
    setTokens(tokens);
    await loadMe();
  }, [loadMe]);

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

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout, logoutAll }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}

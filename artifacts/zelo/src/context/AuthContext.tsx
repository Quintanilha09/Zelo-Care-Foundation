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
  };
  family?: { name: string };
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

  // Ao montar: tenta restaurar sessão via refresh token
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      if (getStoredRefreshToken()) {
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

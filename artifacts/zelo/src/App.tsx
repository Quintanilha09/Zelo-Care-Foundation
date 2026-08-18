import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import DesignReference from '@/pages/design-reference';
import AuthPage from '@/pages/AuthPage';
import ConsentPage from '@/pages/ConsentPage';
import HomePage from '@/pages/HomePage';
import PatientsPage from '@/pages/PatientsPage';
import PatientDetailPage from '@/pages/PatientDetailPage';
import CaregiversPage from '@/pages/CaregiversPage';
import SettingsPage from '@/pages/SettingsPage';
import IOSInstallGuidePage from '@/pages/IOSInstallGuidePage';
import AdminPage from '@/pages/AdminPage';
import StatusPage from '@/pages/StatusPage';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { usePendingDoseActions } from '@/hooks/use-pending-dose-actions';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading, user } = useAuth();

  // ZELO-32: /status (público) e /admin (autenticação própria de operador)
  // não têm nada a ver com sessão de cuidador — checados ANTES do gate de
  // auth abaixo, que senão engoliria as duas sempre pra tela de login.
  if (location === '/status') {
    return (
      <RoutedErrorBoundary>
        <StatusPage />
      </RoutedErrorBoundary>
    );
  }
  if (location.startsWith('/admin')) {
    return (
      <RoutedErrorBoundary>
        <AdminPage />
      </RoutedErrorBoundary>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F7F5]">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-[#2D2D2B]">ZELO</p>
          <p className="text-sm text-[#6B6B6B]">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <RoutedErrorBoundary>
        <AuthPage />
      </RoutedErrorBoundary>
    );
  }

  // Nota: o consentimento de dado de saúde não é mais um passo de conta
  // separado (ver planning/phases/03-.../03-CONTEXT.md) — é capturado
  // inline no cadastro de cada paciente. /consentimento fica de pé só como
  // referência de texto legal, sem gate nenhum no fluxo.
  void user;

  // ZELO-28: só drena/escuta ações de dose vindas da notificação quando
  // autenticado — authFetch precisa de sessão válida de qualquer forma.
  usePendingDoseActions();

  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/pacientes" component={PatientsPage} />
        <Route path="/pacientes/:id" component={PatientDetailPage} />
        <Route path="/cuidadores" component={CaregiversPage} />
        <Route path="/ajustes" component={SettingsPage} />
        <Route path="/notificacoes/ios" component={IOSInstallGuidePage} />
        <Route path="/design" component={DesignReference} />
        <Route path="/consentimento" component={() => <ConsentPage onComplete={() => window.location.href = '/'} />} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

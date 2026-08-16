import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import DesignReference from '@/pages/design-reference';
import AuthPage from '@/pages/AuthPage';
import ConsentPage from '@/pages/ConsentPage';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();

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

  // Verificação de consentimento de dados de saúde após login
  const hasHealthConsent = user?.caregiver; // simplificado — a verificação real é via API

  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={DesignReference} />
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

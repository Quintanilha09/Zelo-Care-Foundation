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
import TodaySummaryPage from '@/pages/TodaySummaryPage';
import PatientDetailPage from '@/pages/PatientDetailPage';
import AdherenceCalendarPage from '@/pages/AdherenceCalendarPage';
import AppointmentsPage from '@/pages/AppointmentsPage';
import RoutinePage from '@/pages/RoutinePage';
import CaregiversPage from '@/pages/CaregiversPage';
import SettingsPage from '@/pages/SettingsPage';
import SettingsNotificationsPage from '@/pages/SettingsNotificationsPage';
import SettingsRetroactivePage from '@/pages/SettingsRetroactivePage';
import SettingsDataPage from '@/pages/SettingsDataPage';
import SettingsAccountPage from '@/pages/SettingsAccountPage';
import PlansPage from '@/pages/PlansPage';
import IOSInstallGuidePage from '@/pages/IOSInstallGuidePage';
import AdminPage from '@/pages/AdminPage';
import StatusPage from '@/pages/StatusPage';
import AcceptInvitePage from '@/pages/AcceptInvitePage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import ElderModePage from '@/pages/ElderModePage';
import PatientAccessActivationPage from '@/pages/PatientAccessActivationPage';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { getElderModePatientId } from '@/lib/elder-mode';
import { getPatientAccessToken } from '@/lib/patient-access';
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

  // ZELO-28: drena/escuta ações de dose vindas da notificação — chamado
  // incondicional aqui (regra dos hooks: Router tem vários `return` abaixo,
  // então nenhum hook pode ficar depois deles) e o próprio hook decide
  // internamente se faz algo, via `enabled` (só quando autenticado —
  // authFetch precisa de sessão válida de qualquer forma).
  usePendingDoseActions(isAuthenticated);

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
  // /convite também precisa ficar fora do gate de auth abaixo: a página
  // funciona tanto sem sessão (mostra login) quanto com sessão (aceita na
  // hora) — ver AcceptInvitePage.
  if (location.startsWith('/convite')) {
    return (
      <RoutedErrorBoundary>
        <AcceptInvitePage />
      </RoutedErrorBoundary>
    );
  }

  // Issue #73: os dois destinos dos links de e-mail. Ficam aqui em cima pela
  // mesma razão do /convite, mas o caso é ainda mais forte — quem chega nestas
  // duas telas está, por definição, IMPEDIDO de logar: numa falta verificar o
  // e-mail, na outra falta a senha. Cair no portão de autenticação abaixo era
  // um beco sem saída perfeito, e foi o que aconteceu até 02/09/2026, quando o
  // envio de e-mail passou a existir de verdade e o beco ganhou tráfego.
  if (location.startsWith('/verificar-email')) {
    return (
      <RoutedErrorBoundary>
        <VerifyEmailPage />
      </RoutedErrorBoundary>
    );
  }
  if (location.startsWith('/redefinir-senha')) {
    return (
      <RoutedErrorBoundary>
        <ResetPasswordPage />
      </RoutedErrorBoundary>
    );
  }

  // ZELO-58: as duas telas do PACIENTE ficam fora do gate de autenticação
  // de cuidador — e é o ponto central da história: o aparelho do paciente
  // nunca tem sessão de cuidador, então passar pelo gate abaixo o jogaria
  // pra tela de login pra sempre. A credencial dele é o token próprio.
  if (location.startsWith('/acesso')) {
    return (
      <RoutedErrorBoundary>
        <PatientAccessActivationPage />
      </RoutedErrorBoundary>
    );
  }
  if (getPatientAccessToken()) {
    return (
      <RoutedErrorBoundary>
        <ElderModePage patientId={null} />
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

  // ZELO-40: checado ANTES do Switch, DEPOIS do gate de autenticação — o
  // modo idoso reaproveita a sessão do cuidador que o ativou neste
  // aparelho. Uma vez travado, NENHUM caminho (URL digitada, botão voltar,
  // notificação) escapa disto — é por isto que a checagem intercepta aqui,
  // não como mais uma <Route>.
  const elderModePatientId = getElderModePatientId();
  if (elderModePatientId !== null) {
    return (
      <RoutedErrorBoundary>
        <ElderModePage patientId={elderModePatientId} />
      </RoutedErrorBoundary>
    );
  }

  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/hoje" component={TodaySummaryPage} />
        <Route path="/pacientes" component={PatientsPage} />
        <Route path="/pacientes/:id/historico" component={AdherenceCalendarPage} />
        <Route path="/pacientes/:id/consultas" component={AppointmentsPage} />
        <Route path="/pacientes/:id/rotina" component={RoutinePage} />
        <Route path="/pacientes/:id" component={PatientDetailPage} />
        <Route path="/cuidadores" component={CaregiversPage} />
        <Route path="/ajustes" component={SettingsPage} />
        <Route path="/ajustes/notificacoes" component={SettingsNotificationsPage} />
        <Route path="/ajustes/registro-retroativo" component={SettingsRetroactivePage} />
        <Route path="/ajustes/conta" component={SettingsAccountPage} />
        <Route path="/ajustes/seus-dados" component={SettingsDataPage} />
        <Route path="/planos" component={PlansPage} />
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

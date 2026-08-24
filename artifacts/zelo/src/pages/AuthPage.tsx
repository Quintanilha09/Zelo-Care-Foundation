/**
 * Página de autenticação — ZELO.
 * Abas: Login | Cadastro | Recuperar senha
 * Opção adicional: Entrar com Google (desabilitada se credenciais não configuradas)
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

// ── Botão Google ───────────────────────────────────────────────────────────

function GoogleButton() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/auth/google/status`)
      .then((r) => r.json())
      .then((d: { configured: boolean }) => setConfigured(d.configured))
      .catch(() => setConfigured(false));
  }, []);

  const handleClick = () => {
    window.location.href = `${BASE}/api/auth/google`;
  };

  if (configured === null) return null; // aguardando

  return (
    <div className="space-y-2">
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-border" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">ou</span>
        <div className="flex-1 border-t border-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full flex items-center gap-2"
        disabled={!configured}
        onClick={configured ? handleClick : undefined}
        title={configured ? undefined : 'Login com Google ainda não está configurado neste ambiente'}
      >
        {/* Google "G" logo SVG */}
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
          <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332Z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58Z" fill="#EA4335"/>
        </svg>
        {configured ? 'Entrar com Google' : 'Entrar com Google (não configurado)'}
      </Button>
      {!configured && (
        <p className="text-xs text-muted-foreground text-center">
          Configure <code className="font-mono">GOOGLE_CLIENT_ID</code> e <code className="font-mono">GOOGLE_CLIENT_SECRET</code> para habilitar.
        </p>
      )}
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────────────────

function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="space-y-2">
          <Label htmlFor="login-email">E-mail</Label>
          <Input id="login-email" type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="login-password">Senha</Label>
          <Input id="login-password" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      <GoogleButton />
    </div>
  );
}

// ── Cadastro ───────────────────────────────────────────────────────────────

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentHealth, setConsentHealth] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  // Existe provedor de e-mail? Mesmo contrato do /auth/google/status.
  // Sem ele, o cadastro por e-mail e senha cria uma conta que nunca poderá
  // ser verificada — então o formulário não é oferecido.
  const [emailConfigurado, setEmailConfigurado] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/auth/email/status`)
      .then((r) => r.json())
      .then((d: { configured: boolean }) => setEmailConfigurado(d.configured))
      .catch(() => setEmailConfigurado(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!consentTerms || !consentHealth) {
      setError('É necessário aceitar os dois termos para criar a conta');
      return;
    }
    setLoading(true);
    try {
      // Quando o cadastro acontece dentro do fluxo de convite (/convite?token=…),
      // o token vai junto: a conta nasce já na família de quem convidou, em vez
      // de criar uma família própria vazia que a pessoa nunca quis.
      const inviteToken = new URLSearchParams(window.location.search).get('token');
      const res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, password, consentTerms, consentHealthData: consentHealth,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? 'Erro ao criar conta');
      // A mensagem vem do servidor: ele é quem sabe se a conta já ficou ativa
      // (desenvolvimento) ou se falta confirmar o e-mail. O texto fixo que
      // estava aqui dizia 'em desenvolvimento a conta já está ativa' para
      // qualquer pessoa, inclusive em produção.
      setMensagemSucesso(data.message ?? 'Conta criada.');
      setSuccess(true);
      setTimeout(() => onSuccess(), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Alert>
        <AlertDescription>{mensagemSucesso}</AlertDescription>
      </Alert>
    );
  }

  if (emailConfigurado === null) return null; // aguardando

  if (!emailConfigurado) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            <p className="font-medium">Por enquanto, a entrada é pelo Google.</p>
            <p className="mt-1">
              Criar conta com e-mail e senha exige um e-mail de confirmação, e ele ainda
              não está disponível. Entrar com o Google é um toque, e a conta já vem
              confirmada.
            </p>
          </AlertDescription>
        </Alert>
        <GoogleButton />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="space-y-2">
          <Label htmlFor="reg-name">Nome completo</Label>
          <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reg-email">E-mail</Label>
          <Input id="reg-email" type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reg-password">Senha (mínimo 8 caracteres)</Label>
          <Input id="reg-password" type="password" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>

        <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
          <p className="text-sm font-medium">Consentimentos obrigatórios</p>
          <div className="flex items-start gap-3">
            <Checkbox id="consent-terms" checked={consentTerms}
              onCheckedChange={(v) => setConsentTerms(v === true)} />
            <Label htmlFor="consent-terms" className="text-sm leading-relaxed cursor-pointer">
              Li e aceito os{' '}
              <a href="/termos" className="underline" target="_blank" rel="noopener">Termos de Uso</a>
              {' '}e a{' '}
              <a href="/privacidade" className="underline" target="_blank" rel="noopener">Política de Privacidade</a>
              {' '}(versão v1.0)
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="consent-health" checked={consentHealth}
              onCheckedChange={(v) => setConsentHealth(v === true)} />
            <Label htmlFor="consent-health" className="text-sm leading-relaxed cursor-pointer">
              Consinto com o tratamento de <strong>dados de saúde do paciente</strong>{' '}
              (medicamentos, doses, aferições) conforme a{' '}
              <a href="/consentimento-saude" className="underline" target="_blank" rel="noopener">
                política de dados de saúde
              </a>
              {' '}(versão v1.0 — rascunho, pendente de revisão jurídica)
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            O titular dos dados é o <strong>paciente</strong>. Ao cadastrar um paciente,
            confirme se você está consentindo como o próprio titular ou como representante legal.
          </p>
        </div>

        <Button type="submit" className="w-full" disabled={loading || !consentTerms || !consentHealth}>
          {loading ? 'Criando conta…' : 'Criar conta'}
        </Button>
      </form>
      <GoogleButton />
    </div>
  );
}

// ── Recuperar senha ────────────────────────────────────────────────────────

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await fetch(`${BASE}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <Alert>
        <AlertDescription>
          Se esse e-mail estiver cadastrado, você receberá um link de recuperação em breve.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Seu e-mail cadastrado</Label>
        <Input id="forgot-email" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Enviando…' : 'Enviar link de recuperação'}
      </Button>
    </form>
  );
}

// ── Página principal ───────────────────────────────────────────────────────

export default function AuthPage() {
  const [tab, setTab] = useState<'login' | 'register' | 'forgot'>('login');
  const [authError, setAuthError] = useState('');

  // Exibe erros vindos do redirect OAuth (ex: ?auth_error=google_failed)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) {
      const messages: Record<string, string> = {
        google_failed: 'Não foi possível autenticar com o Google. Tente novamente.',
        google_unverified: 'O e-mail da conta Google não está verificado.',
        google_no_caregiver: 'Conta encontrada, mas sem vínculo familiar. Contate o suporte.',
        google_exchange_failed: 'O login com Google demorou demais ou o código expirou. Tente novamente.',
      };
      setAuthError(messages[err] ?? 'Erro ao autenticar. Tente novamente.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F7F5] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-semibold" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
            ZELO
          </CardTitle>
          <CardDescription>Cuidado compartilhado para famílias</CardDescription>
        </CardHeader>
        <CardContent>
          {authError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="w-full mb-6">
              <TabsTrigger value="login" className="flex-1">Entrar</TabsTrigger>
              <TabsTrigger value="register" className="flex-1">Criar conta</TabsTrigger>
              <TabsTrigger value="forgot" className="flex-1">Recuperar</TabsTrigger>
            </TabsList>
            <TabsContent value="login"><LoginForm /></TabsContent>
            <TabsContent value="register">
              <RegisterForm onSuccess={() => setTab('login')} />
            </TabsContent>
            <TabsContent value="forgot"><ForgotPasswordForm /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

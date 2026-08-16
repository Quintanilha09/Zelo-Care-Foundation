/**
 * Página de autenticação — ZELO.
 * Abas: Login | Cadastro | Recuperar senha
 */
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

// ── Login ─────────────────────────────────────────────────────────────────

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
  );
}

// ── Cadastro ──────────────────────────────────────────────────────────────

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentHealth, setConsentHealth] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!consentTerms || !consentHealth) {
      setError('É necessário aceitar os dois termos para criar a conta');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, consentTerms, consentHealthData: consentHealth }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? 'Erro ao criar conta');
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
        <AlertDescription>
          Conta criada! Verifique seu e-mail para ativar a conta antes de entrar.
        </AlertDescription>
      </Alert>
    );
  }

  return (
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

      {/* Consentimento 1: Termos de Uso — separado do consentimento de saúde */}
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

        {/* Consentimento 2: Dados de saúde — SEPARADO, com contexto diferente */}
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
  );
}

// ── Recuperar senha ───────────────────────────────────────────────────────

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

// ── Página principal ──────────────────────────────────────────────────────

export default function AuthPage() {
  const [tab, setTab] = useState<'login' | 'register' | 'forgot'>('login');

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

/**
 * Página de detalhes do consentimento LGPD — ZELO.
 * Exibida antes de cadastrar o primeiro paciente.
 *
 * DOIS consentimentos separados e distintos:
 * 1. Conta: Termos de Uso + Política de Privacidade
 * 2. Dados de saúde: tratamento de dados clínicos do paciente
 *
 * O titular dos dados é o PACIENTE — não quem cuida dele.
 * Quando o paciente não pode consentir, o cuidador age como representante legal.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { authFetch } from '@/lib/auth-client';

interface ConsentPageProps {
  onComplete: () => void;
}

export default function ConsentPage({ onComplete }: ConsentPageProps) {
  const [representative, setRepresentative] = useState<'self' | 'legal_representative'>('legal_representative');
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!accepted) return;
    setLoading(true);
    setError('');
    try {
      const res = await authFetch('/api/consent', {
        method: 'POST',
        body: JSON.stringify({
          consentType: 'health_data_processing',
          consentGiven: true,
          version: 'v1.0',
          representative,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Erro ao registrar consentimento');
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F7F5] p-4 flex items-start justify-center pt-8">
      <div className="w-full max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Dados de saúde do paciente</h1>
          <p className="text-muted-foreground mt-1">
            Antes de cadastrar um paciente, precisamos do seu consentimento.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Quem é o titular dos dados?</CardTitle>
            </div>
            <CardDescription>
              O titular dos dados é sempre o <strong>paciente</strong> — a pessoa que está
              sendo cuidada. Você, como cuidador, está gerenciando esses dados em nome dela.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={representative}
              onValueChange={(v) => setRepresentative(v as typeof representative)}
              className="space-y-3"
            >
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-background">
                <RadioGroupItem value="legal_representative" id="rep-legal" className="mt-0.5" />
                <Label htmlFor="rep-legal" className="cursor-pointer leading-relaxed">
                  <span className="font-medium">Sou representante legal</span>
                  <br />
                  <span className="text-sm text-muted-foreground">
                    O paciente não pode consentir sozinho (idoso, pessoa com deficiência cognitiva,
                    menor de idade). Você consente como responsável legal.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-background">
                <RadioGroupItem value="self" id="rep-self" className="mt-0.5" />
                <Label htmlFor="rep-self" className="cursor-pointer leading-relaxed">
                  <span className="font-medium">Sou o próprio titular</span>
                  <br />
                  <span className="text-sm text-muted-foreground">
                    Você é o paciente e está gerenciando seus próprios dados.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">
                Consentimento para tratamento de dados de saúde
              </CardTitle>
              <Badge variant="outline" className="text-xs font-normal">
                Rascunho — aguardando revisão jurídica
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-2 text-muted-foreground bg-muted/30 rounded-lg p-4">
              <p><strong>Dados coletados:</strong> medicamentos em uso, horários de dose, registros de tomada ou não tomada, aferições (pressão arterial, glicemia, peso), consultas médicas.</p>
              <p><strong>Finalidade:</strong> coordenação do cuidado compartilhado entre os cuidadores autorizados da família.</p>
              <p><strong>Base legal:</strong> Art. 11, II, a da LGPD — proteção da vida e incolumidade física do titular.</p>
              <p><strong>Acesso:</strong> apenas cuidadores da família. Nenhum dado é compartilhado com terceiros.</p>
              <p><strong>Direitos:</strong> exportar, corrigir ou excluir seus dados a qualquer momento em Configurações → Dados.</p>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg border">
              <Checkbox
                id="consent-health-data"
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
              />
              <Label htmlFor="consent-health-data" className="text-sm leading-relaxed cursor-pointer">
                Consinto com o tratamento dos dados de saúde do paciente conforme descrito acima.
                Versão <strong>v1.0</strong> — rascunho, pendente de revisão jurídica.
              </Label>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              onClick={handleConfirm}
              disabled={!accepted || loading}
            >
              {loading ? 'Registrando…' : 'Confirmar consentimento e continuar'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

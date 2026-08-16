import { injectPWAManifest } from "@/components/pwa-manifest";
import { useEffect } from "react";
import { DoseCard } from "@/components/dose-card";
import { CaregiverCard } from "@/components/caregiver-card";
import { CaregiverBadge } from "@/components/caregiver-badge";
import { CheckCircle2, Clock, AlertTriangle, XCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function DesignReference() {
  const { toast } = useToast();

  useEffect(() => {
    injectPWAManifest();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 font-sans selection:bg-primary/20 selection:text-primary">
      <header className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl">
            Z
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-none">ZELO</h1>
            <p className="text-sm text-muted-foreground">Sistema de Design</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-10 space-y-16">
        
        <section className="space-y-4">
          <h2 className="text-3xl font-semibold text-foreground tracking-tight">Fundação Visual</h2>
          <p className="text-[18px] text-muted-foreground leading-relaxed max-w-2xl">
            ZELO é um espaço tranquilo de cuidado compartilhado. O produto reduz culpa, não amplifica. 
            É íntimo, confiável e feito para pessoas de 30 a 60 anos que frequentemente configuram o celular pensando no pai ou mãe idoso.
          </p>
        </section>

        <section className="space-y-6">
          <div className="border-b pb-2">
            <h3 className="text-2xl font-semibold">1. Paleta de Cores</h3>
            <p className="text-[17px] text-muted-foreground">Tons calmantes, sem alertas vermelhos para o dia a dia.</p>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <ColorChip name="Calm Green" varName="bg-zelo-green" hex="#659A76" usage="Tudo em dia, doses tomadas" />
            <ColorChip name="Calm Amber" varName="bg-zelo-amber" hex="#E9AD51" usage="Doses pendentes, aguardando" />
            <ColorChip name="Background" varName="bg-background" hex="#F8F7F5" usage="Fundo principal quente" border />
            <ColorChip name="Surface" varName="bg-card" hex="#FFFFFF" usage="Cards e modais" border />
            <ColorChip name="Text Principal" varName="bg-foreground" hex="#32302D" usage="Títulos e textos fortes" />
            <ColorChip name="Text Muted" varName="bg-muted-foreground" hex="#7A7670" usage="Apoio e metadados" />
          </div>
        </section>

        <section className="space-y-6">
          <div className="border-b pb-2">
            <h3 className="text-2xl font-semibold">2. Tipografia & Espaçamento</h3>
            <p className="text-[17px] text-muted-foreground">Feito para presbiopia: textos maiores e áreas de toque generosas.</p>
          </div>

          <div className="bg-card p-6 rounded-2xl border space-y-8">
            <div className="space-y-4">
              <div className="flex items-baseline justify-between border-b pb-2">
                <span className="text-muted-foreground text-sm">H1 (24px / Semibold)</span>
                <h1 className="text-2xl font-semibold">Dona Maria Teste</h1>
              </div>
              <div className="flex items-baseline justify-between border-b pb-2">
                <span className="text-muted-foreground text-sm">H2 (20px / Semibold)</span>
                <h2 className="text-xl font-semibold">Rotina de hoje</h2>
              </div>
              <div className="flex items-baseline justify-between border-b pb-2">
                <span className="text-muted-foreground text-sm">H3 (18px / Medium)</span>
                <h3 className="text-[18px] font-medium">Histórico recente</h3>
              </div>
              <div className="flex items-baseline justify-between border-b pb-2">
                <span className="text-muted-foreground text-sm">Corpo (18px / Regular)</span>
                <p className="text-[18px]">O RemédioInventado foi tomado às 8h.</p>
              </div>
              <div className="flex items-baseline justify-between border-b pb-2">
                <span className="text-muted-foreground text-sm">Legenda (15px / Regular)</span>
                <span className="text-[15px] text-muted-foreground">Registrado por João</span>
              </div>
            </div>

            <div className="bg-secondary/50 p-5 rounded-xl border">
              <h4 className="text-[17px] font-medium mb-4">Área de toque generosa (Mínimo 48px)</h4>
              <div className="flex flex-wrap gap-4 items-center">
                <Button className="h-12 px-6 text-[17px]">Botão Primário (48px)</Button>
                <Button variant="outline" className="h-12 px-6 text-[17px]">Ação Secundária</Button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="border-b pb-2">
            <h3 className="text-2xl font-semibold">3. Componentes Base</h3>
            <p className="text-[17px] text-muted-foreground">Elementos fundamentais de interação da interface.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h4 className="text-[17px] font-medium text-muted-foreground">Estados do Card de Dose</h4>
              <DoseCard 
                medicationName="Cardiolex 25mg" 
                dosage="1 comprimido" 
                time="08:00" 
                status="taken" 
                takenBy="João Teste" 
                takenAt="08:03" 
              />
              <DoseCard 
                medicationName="Vitazan B" 
                dosage="1 cápsula" 
                time="14:00" 
                status="pending" 
              />
            </div>

            <div className="space-y-4">
              <h4 className="text-[17px] font-medium text-muted-foreground">Cuidadores e Papéis</h4>
              <CaregiverCard name="Maria Silva" role="primary_caregiver" />
              <div className="flex flex-wrap gap-2 pt-2">
                <CaregiverBadge role="primary_caregiver" />
                <CaregiverBadge role="caregiver" />
                <CaregiverBadge role="hired_caregiver" />
                <CaregiverBadge role="observer" />
              </div>
            </div>

            <div className="space-y-4 md:col-span-2">
              <h4 className="text-[17px] font-medium text-muted-foreground">Inputs & Notificações</h4>
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="h-12 pl-10 text-[17px]" placeholder="Buscar medicamento..." />
                </div>
                <Button 
                  className="h-12 px-6"
                  onClick={() => {
                    toast({
                      title: "Dose registrada",
                      description: "Cardiolex marcado como tomado às 08:05.",
                      className: "bg-zelo-green-bg border-zelo-green/20"
                    })
                  }}
                >
                  Testar Toast
                </Button>
              </div>
            </div>

            <div className="space-y-4 md:col-span-2">
              <h4 className="text-[17px] font-medium text-muted-foreground">Estado Vazio</h4>
              <div className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center text-center gap-3">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-2">
                  <CheckCircle2 className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-medium">Nenhuma dose para hoje</h3>
                <p className="text-[17px] text-muted-foreground max-w-md">
                  A rotina de hoje está limpa. Aproveite o dia com tranquilidade.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="border-b pb-2">
            <h3 className="text-2xl font-semibold">4. Decisões de Tom</h3>
            <p className="text-[17px] text-muted-foreground">O que fazemos e o que evitamos.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-red-50 p-6 rounded-xl border border-red-100 flex flex-col gap-4 opacity-70">
              <div className="flex items-center gap-2 text-red-700 font-semibold">
                <XCircle className="w-5 h-5" />
                O que NÃO fazemos
              </div>
              <div className="bg-white p-4 rounded-lg border border-red-200 shadow-sm">
                <div className="flex items-center gap-2 text-red-600 font-bold">
                  <AlertTriangle className="w-5 h-5" /> Dose Atrasada!
                </div>
                <p className="mt-1 text-[17px] text-gray-800">Prexoral 10mg não foi tomado. Risco à saúde.</p>
              </div>
              <p className="text-[15px] text-red-800/80">Evitamos tons de alarme, vermelho e linguagem que gera culpa.</p>
            </div>

            <div className="bg-zelo-amber-bg p-6 rounded-xl border border-zelo-amber/20 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-zelo-amber-fg font-semibold">
                <CheckCircle2 className="w-5 h-5" />
                O que fazemos
              </div>
              <div className="bg-white p-4 rounded-lg border shadow-sm">
                <div className="flex items-center gap-2 text-zelo-amber-fg font-medium">
                  <Clock className="w-5 h-5" /> Pendente
                </div>
                <p className="mt-1 text-[17px] text-foreground">Prexoral 10mg estava agendado para 10:00.</p>
              </div>
              <p className="text-[15px] text-zelo-amber-fg">Usamos cores acolhedoras (âmbar) e foco descritivo do estado.</p>
            </div>
          </div>
        </section>

        <section className="space-y-6 pt-4">
          <div className="border-b pb-2">
            <h3 className="text-2xl font-semibold">5. Exemplo de Layout Integrado</h3>
            <p className="text-[17px] text-muted-foreground">Como as peças se juntam em uma tela típica (simulação).</p>
          </div>

          <div className="border bg-background rounded-2xl overflow-hidden shadow-sm max-w-sm mx-auto flex flex-col">
            <div className="bg-card p-5 border-b flex flex-col gap-1">
              <div className="text-sm font-medium text-muted-foreground">Família Teste</div>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold tracking-tight">Dona Maria Teste</h2>
                <div className="w-10 h-10 bg-primary/10 text-primary font-bold rounded-full flex items-center justify-center shrink-0">
                  M
                </div>
              </div>
              <div className="text-[15px] text-muted-foreground mt-1">78 anos • 3 cuidadores</div>
            </div>

            <div className="p-5 flex-1 bg-secondary/30 space-y-6">
              <div>
                <h3 className="text-[18px] font-medium mb-3">Rotina da Manhã</h3>
                <div className="space-y-3">
                  <DoseCard 
                    medicationName="Cardiolex 25mg" 
                    dosage="1 comprimido" 
                    time="08:00" 
                    status="taken" 
                    takenBy="João (Filho)" 
                    takenAt="08:15" 
                  />
                  <DoseCard 
                    medicationName="Prexoral 10mg" 
                    dosage="Gotas (5ml)" 
                    time="10:00" 
                    status="pending" 
                  />
                </div>
              </div>
              
              <div>
                <h3 className="text-[18px] font-medium mb-3">Rotina da Tarde</h3>
                <div className="space-y-3">
                  <DoseCard 
                    medicationName="Vitazan B" 
                    dosage="1 cápsula" 
                    time="14:00" 
                    status="pending" 
                  />
                </div>
              </div>
            </div>
            
            <div className="bg-card p-4 border-t flex gap-2">
              <Button className="flex-1 h-12 text-[17px]">Registrar Dose Extra</Button>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}

function ColorChip({ name, varName, hex, usage, border }: { name: string, varName: string, hex: string, usage: string, border?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("h-24 w-full rounded-xl shadow-sm", varName, border && "border")} />
      <div>
        <div className="font-semibold text-[17px]">{name}</div>
        <div className="text-[15px] text-muted-foreground font-mono mt-0.5">{hex}</div>
        <div className="text-[14px] leading-snug mt-1 text-muted-foreground">{usage}</div>
      </div>
    </div>
  );
}
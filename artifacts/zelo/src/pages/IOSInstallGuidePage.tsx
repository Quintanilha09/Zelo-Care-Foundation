/**
 * Guia de instalação no iPhone/iPad — ZELO (ZELO-26).
 *
 * Web Push no iOS só entrega notificação se o site estiver adicionado à
 * Tela de Início E aberto nesse modo (não numa aba do Safari) — sem isso o
 * pedido de permissão nem aparece, ou aparece e nunca funciona de verdade.
 * Essa tela existe pra explicar o passo intermediário que o iOS exige.
 */
import { Link } from "wouter";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Share, SquarePlus, Smartphone, ArrowLeft } from "lucide-react";
import { isStandalone } from "@/lib/push-client";

const STEPS = [
  {
    icon: Share,
    title: "Toque em Compartilhar",
    description: "Na barra do Safari (embaixo, no meio), toque no ícone de compartilhar — o quadrado com a seta pra cima.",
  },
  {
    icon: SquarePlus,
    title: "Adicionar à Tela de Início",
    description: 'Role a lista de opções e toque em "Adicionar à Tela de Início".',
  },
  {
    icon: Smartphone,
    title: "Abra o ZELO pela Tela de Início",
    description: 'Toque em "Adicionar" e depois abra o app pelo novo ícone na Tela de Início — não mais pelo Safari.',
  },
];

export default function IOSInstallGuidePage() {
  const alreadyInstalled = isStandalone();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href="/ajustes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Ajustes
        </Link>

        <div>
          <h2 className="text-2xl font-semibold">Ativar lembretes no iPhone</h2>
          <p className="text-muted-foreground text-[15px]">
            No iPhone e iPad, o Safari só entrega lembretes depois que o ZELO é adicionado à Tela de Início.
          </p>
        </div>

        {alreadyInstalled ? (
          <div className="p-4 rounded-xl border bg-zelo-green-bg/40 text-[15px]">
            Você já está usando o ZELO como app instalado. Pode voltar para{" "}
            <Link href="/ajustes" className="underline font-medium">Ajustes</Link> e ativar os lembretes por lá.
          </div>
        ) : (
          <div className="space-y-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="flex gap-4 p-4 rounded-xl border bg-card">
                <div className="shrink-0 w-9 h-9 rounded-full bg-zelo-green-bg flex items-center justify-center text-zelo-green-fg font-semibold text-[15px]">
                  {i + 1}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <step.icon className="w-4 h-4 text-muted-foreground" />
                    <h3 className="font-medium">{step.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Isso é uma exigência do próprio iPhone (iOS), não do ZELO — todo site funciona assim.
        </p>

        <Button asChild variant="outline">
          <Link href="/ajustes">Voltar para Ajustes</Link>
        </Button>
      </main>
    </div>
  );
}

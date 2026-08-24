import { Link } from 'wouter';
import { Compass } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Página 404 — ZELO.
 *
 * Era o template do shadcn, em inglês, com texto de desenvolvedor vazando para
 * quem usa: "404 Page Not Found" e "Did you forget to add the page to the
 * router?". Achado da auditoria §10 (23/08/2026).
 *
 * O tom segue a régua do produto: quem chega aqui geralmente clicou num link
 * velho ou digitou errado — não fez nada de errado, e o texto não sugere que
 * fez. Sem vermelho e sem alarme: 404 não é falha do cuidador, é só um endereço
 * que não existe. E toda tela precisa oferecer o próximo passo, então há um
 * caminho de volta.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-3">
            <Compass className="h-8 w-8 text-muted-foreground shrink-0" />
            <h1 className="text-2xl font-semibold text-foreground">
              Página não encontrada
            </h1>
          </div>

          <p className="text-muted-foreground">
            Este endereço não existe no ZELO. Talvez o link esteja velho, ou
            tenha faltado uma letra.
          </p>

          <Button asChild className="w-full">
            <Link href="/">Voltar para o início</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

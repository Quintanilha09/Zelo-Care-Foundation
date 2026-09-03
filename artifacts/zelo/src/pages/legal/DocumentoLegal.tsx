/**
 * Moldura dos três documentos legais — Issue #76.
 *
 * ── Por que estas telas precisaram existir ────────────────────────────────
 *
 * O cadastro **já obrigava** a aceitar Termos de Uso, Política de Privacidade e
 * a política de dados de saúde, com três links. Os três levavam a lugar nenhum:
 * as rotas não existiam, e quem clicava caía na tela de login.
 *
 * Aceitar documento que não dá para ler não é consentimento — é um checkbox. E
 * num produto que trata **dado de saúde de pessoa vulnerável**, o consentimento
 * é a base legal inteira (art. 11 da LGPD).
 *
 * ── Fora do portão de autenticação, de propósito ──────────────────────────
 *
 * Quem lê estes documentos está, quase sempre, **decidindo se cria a conta**.
 * Exigir sessão para ler o que se aceita ao criar a sessão é circular.
 *
 * ── O texto vive aqui, e não em `docs/legal/` ─────────────────────────────
 *
 * `docs/legal/*.md` é a cópia de **revisão**: tem os marcadores `[DECIDIR]` e as
 * anotações para o advogado. Este é o texto **vigente**, o que a pessoa lê.
 *
 * São documentos diferentes, com públicos diferentes — não é duplicação. Ao
 * mudar um, olhe o outro.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export function DocumentoLegal({
  titulo,
  versao,
  rascunho = false,
  children,
}: {
  titulo: string;
  /** A mesma string que o cadastro registra em `consent_records`. */
  versao: string;
  /**
   * Marca o documento como pendente de revisão jurídica.
   *
   * Dizer isso na cara do leitor é desconfortável e é o certo: o cadastro já
   * escreve "rascunho, pendente de revisão jurídica" ao lado do consentimento
   * de dados de saúde. Esconder aqui o que já se admite lá seria pior.
   */
  rascunho?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href="/">
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden /> Voltar ao ZELO
          </a>
        </Link>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "DM Sans, system-ui, sans-serif" }}>
            {titulo}
          </h1>
          <p className="text-sm text-muted-foreground">Versão {versao}</p>
        </header>

        {rascunho && (
          <p className="text-sm rounded-lg border p-3 bg-muted/40">
            Este texto ainda passará por revisão jurídica. Ele descreve fielmente o que o
            aplicativo faz hoje — se algo mudar depois da revisão, avisaremos por e-mail
            antes de valer.
          </p>
        )}

        {/* Sem `prose` do Tailwind de propósito: a largura de leitura já vem
            do `max-w-2xl` do main, e o `prose` traria um segundo teto de
            largura que, somado a este, deixa a coluna estreita demais no
            celular. */}
        <article className="space-y-5 text-[15px] leading-relaxed">{children}</article>
      </main>
    </div>
  );
}

/**
 * Link de um documento legal para outro.
 *
 * É o `Link` do wouter, e não um `<a href>` cru, por duas razões: ele respeita
 * o `base` do Router (o app é servido sob um subcaminho no Replit) e navega sem
 * recarregar — quem está lendo os Termos e clica na Privacidade continua na
 * mesma aba, que é para onde o link do cadastro já abriu.
 */
export function LinkInterno({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href}>
      <a className="underline">{children}</a>
    </Link>
  );
}

/** Título de seção. Numerado porque documento legal se cita por número. */
export function Secao({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[17px] font-semibold pt-3">
        {numero}. {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Bloco de destaque — para o que a pessoa precisa ler mesmo se pular o resto. */
export function Destaque({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border-l-[3px] border-primary bg-primary/5 px-4 py-3 space-y-2">
      {children}
    </div>
  );
}

/**
 * Tabela que rola sozinha quando não cabe.
 *
 * Sem o `overflow-x-auto` no envelope, uma tabela de três colunas empurra a
 * página inteira no celular — o mesmo defeito da Issue #88, por outro caminho.
 */
export function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {cabecalho.map((c) => (
              <th key={c} className="text-left font-medium text-muted-foreground border-b py-2 pr-4 align-top">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.join("|")}>
              {linha.map((celula, i) => (
                <td key={i} className="border-b py-2 pr-4 align-top">
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Ajustes — Seus dados — ZELO (QUI-17).
 *
 * ── Por que esta tela precisou existir ────────────────────────────────────
 *
 * As duas metades da LGPD — **levar os dados embora** e **sumir do sistema**
 * — estavam prontas no servidor desde a REQ-006, com teste
 * (`export-deletion.test.ts`) e tudo. E **nenhuma tela chamava**.
 *
 * Direito que só existe no servidor não é direito do titular: é uma rota.
 * Ninguém consegue exercê-lo sem `curl`.
 *
 * ── As duas ações não são simétricas, e a tela não finge que são ──────────
 *
 * Exportar é reversível, barato e não pede confirmação nenhuma — no máximo,
 * gera um arquivo que ninguém abre.
 *
 * Excluir apaga a família inteira: paciente, tratamento, histórico de dose,
 * consulta, aferição e foto. Por isso são **sete dias de janela**, com aviso
 * a todos os cuidadores e com a chance de cancelar até o último minuto. É a
 * escolha do produto, não uma limitação técnica — e a tela diz isso em vez
 * de esconder atrás de um "tem certeza?".
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Download, Trash2, ShieldAlert, FileText } from "lucide-react";

interface PedidoDeExclusao {
  scheduledDeletionAt: string;
  requestedAt: string;
  /** Quem decide se a janela fechou é o relógio do SERVIDOR, nunca o do aparelho. */
  canExecuteNow: boolean;
}

async function lerPedidoDeExclusao(): Promise<PedidoDeExclusao | null> {
  const res = await authFetch("/api/account/deletion");
  if (!res.ok) return null;
  return ((await res.json()) as { pending: PedidoDeExclusao | null }).pending;
}

/** "3 dias" / "hoje" — a distância até a exclusão, em português de gente. */
function faltam(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "a qualquer momento";
  const dias = Math.ceil(ms / 86_400_000);
  return dias === 1 ? "amanhã" : `em ${dias} dias`;
}

function dataLonga(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

export default function SettingsDataPage() {
  const { user } = useAuth();
  const ehPrincipal = user?.caregiver?.role === "primary_caregiver";
  const queryClient = useQueryClient();

  const [exportando, setExportando] = useState(false);
  const [linkDoArquivo, setLinkDoArquivo] = useState("");
  const [linkDoPdf, setLinkDoPdf] = useState("");
  const [erroDaExportacao, setErroDaExportacao] = useState("");

  const [janelaAberta, setJanelaAberta] = useState(false);
  const [nomeConfirmado, setNomeConfirmado] = useState("");
  const [erroDaExclusao, setErroDaExclusao] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);

  const { data: pedido } = useQuery({
    queryKey: ["pedido-de-exclusao"],
    queryFn: lerPedidoDeExclusao,
  });

  const nomeDaFamilia = user?.family?.name ?? "";

  const exportar = async () => {
    setExportando(true);
    setErroDaExportacao("");
    setLinkDoArquivo("");
    try {
      const res = await authFetch("/api/export", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErroDaExportacao(data.error ?? "Não foi possível gerar o arquivo agora.");
        return;
      }
      const { downloadUrl, downloadUrlPdf } = (await res.json()) as {
        downloadUrl: string;
        downloadUrlPdf: string;
      };
      // O link é de USO ÚNICO e vale uma hora. Por isso a tela o mostra em
      // vez de baixar sozinha: um download disparado por script pode ser
      // engolido por bloqueador de pop-up e queimar o link em silêncio, e a
      // pessoa ficaria olhando para uma tela que diz "pronto" sem arquivo
      // nenhum. Clicar é do usuário, e falha visível é melhor que sucesso
      // invisível.
      setLinkDoArquivo(downloadUrl);
      setLinkDoPdf(downloadUrlPdf);
    } catch {
      setErroDaExportacao("Sem conexão agora. Tente de novo.");
    } finally {
      setExportando(false);
    }
  };

  const chamar = async (caminho: string, aoDarCerto: () => void) => {
    setTrabalhando(true);
    setErroDaExclusao("");
    try {
      const res = await authFetch(caminho, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErroDaExclusao(data.error ?? "Não foi possível concluir agora.");
        return;
      }
      aoDarCerto();
      void queryClient.invalidateQueries({ queryKey: ["pedido-de-exclusao"] });
    } catch {
      setErroDaExclusao("Sem conexão agora. Tente de novo.");
    } finally {
      setTrabalhando(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href="/ajustes">
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Ajustes
          </a>
        </Link>

        <div>
          <h2 className="text-2xl font-semibold">Seus dados</h2>
          <p className="text-muted-foreground text-[17px]">
            Levar uma cópia de tudo, ou sair de vez.
          </p>
        </div>

        {/* ── Exportar ────────────────────────────────────────────────── */}
        <section className="p-4 rounded-xl border bg-card shadow-sm space-y-3">
          <div>
            <p className="font-medium">Baixar uma cópia de tudo</p>
            <p className="text-sm text-muted-foreground">
              Sua conta, os cuidadores, os consentimentos, os pacientes, os
              tratamentos, o histórico de doses, as consultas, as aferições e os
              momentos. Cada link vale por uma hora e serve uma vez só.
            </p>
          </div>

          <Button onClick={() => void exportar()} disabled={exportando} className="gap-2">
            <Download className="w-4 h-4" />
            {exportando ? "Preparando…" : "Gerar o arquivo"}
          </Button>

          {linkDoArquivo && (
            <Alert>
              <AlertDescription className="space-y-3">
                <p>Está pronto. São dois formatos, e os dois trazem o mesmo conteúdo.</p>

                {/* O PDF vem primeiro: é o que a pessoa quer 9 em 10 vezes.
                    O JSON continua porque portabilidade também é levar os
                    dados para OUTRO SISTEMA, e para isso o PDF não serve. */}
                <div className="space-y-2">
                  <a
                    href={linkDoPdf}
                    className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
                    download
                  >
                    <FileText className="w-4 h-4" /> Baixar em PDF, para ler
                  </a>
                  <p className="text-xs text-muted-foreground">
                    Legível, com o nome dos remédios e as datas no fuso do paciente.
                  </p>
                </div>

                <div className="space-y-2">
                  <a
                    href={linkDoArquivo}
                    className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
                    download
                  >
                    <Download className="w-4 h-4" /> Baixar em JSON, para outro sistema
                  </a>
                  <p className="text-xs text-muted-foreground">
                    Todos os campos como estão guardados, para importar em outro
                    lugar.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {erroDaExportacao && (
            <Alert variant="destructive"><AlertDescription>{erroDaExportacao}</AlertDescription></Alert>
          )}
        </section>

        {/* ── Excluir ─────────────────────────────────────────────────── */}
        <section className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Excluir a conta e todos os dados</p>
              <p className="text-sm text-muted-foreground">
                Apaga a família inteira: pacientes, tratamentos, histórico de doses,
                consultas, aferições e fotos. Não tem como recuperar depois.
              </p>
            </div>
          </div>

          {pedido ? (
            <div className="space-y-3">
              <Alert>
                <AlertDescription>
                  <strong className="font-medium">A exclusão já está marcada.</strong>{" "}
                  Pedida em {dataLonga(pedido.requestedAt)}, acontece{" "}
                  {faltam(pedido.scheduledDeletionAt)} — em{" "}
                  {dataLonga(pedido.scheduledDeletionAt)}. Dá para cancelar até lá.
                </AlertDescription>
              </Alert>

              {ehPrincipal && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={trabalhando}
                    onClick={() => void chamar("/api/account/deletion/cancel", () => setErroDaExclusao(""))}
                  >
                    Cancelar a exclusão
                  </Button>

                  {/* Só depois que a janela de sete dias fecha — e quem diz
                      que fechou é o servidor, não o relógio do aparelho. */}
                  {pedido.canExecuteNow && (
                    <Button
                      variant="destructive"
                      className="gap-2"
                      disabled={trabalhando}
                      onClick={() =>
                        void chamar("/api/account/deletion/execute", () => {
                          // A sessão morre junto com a família. Recarregar é o
                          // caminho honesto: qualquer tela que continuasse
                          // aberta estaria mostrando dados que não existem mais.
                          window.location.replace(import.meta.env.BASE_URL || "/");
                        })
                      }
                    >
                      <Trash2 className="w-4 h-4" /> Excluir agora, de vez
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            ehPrincipal ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Ao pedir, todos os cuidadores da família são avisados e você tem{" "}
                    <strong className="text-foreground">sete dias</strong> para mudar de ideia.
                    Nada é apagado antes disso.
                  </p>
                  <Button variant="destructive" className="gap-2" onClick={() => setJanelaAberta(true)}>
                    <Trash2 className="w-4 h-4" /> Pedir a exclusão
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Só o cuidador principal da família pode pedir a exclusão.
                </p>
              )
          )}

          {erroDaExclusao && (
            <Alert variant="destructive"><AlertDescription>{erroDaExclusao}</AlertDescription></Alert>
          )}
        </section>
      </main>

      {/* Digitar o nome da família, mesmo padrão de excluir paciente. Não é
          burocracia: é o intervalo entre a intenção e o toque, que é onde o
          arrependimento cabe. */}
      <AlertDialog
        open={janelaAberta}
        onOpenChange={(aberto) => { setJanelaAberta(aberto); if (!aberto) setNomeConfirmado(""); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pedir a exclusão de {nomeDaFamilia}?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os cuidadores serão avisados. Depois de sete dias, tudo é apagado
              e não tem como recuperar. Até lá, dá para cancelar aqui mesmo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirmar-familia">
              Digite <span className="font-semibold">{nomeDaFamilia}</span> para confirmar
            </Label>
            <Input
              id="confirmar-familia"
              value={nomeConfirmado}
              onChange={(e) => setNomeConfirmado(e.target.value)}
              autoComplete="off"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Deixar como está</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={trabalhando || nomeConfirmado !== nomeDaFamilia}
              onClick={() =>
                void chamar("/api/account/deletion/request", () => {
                  setJanelaAberta(false);
                  setNomeConfirmado("");
                })
              }
            >
              Pedir a exclusão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

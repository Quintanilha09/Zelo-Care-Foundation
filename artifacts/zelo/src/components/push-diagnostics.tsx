/**
 * "Seus lembretes estão funcionando?" — ZELO (ZELO-26).
 * Estado da permissão, dos dispositivos assinados e um botão de teste real.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, CircleCheck, CircleAlert } from "lucide-react";
import {
  isPushSupported, needsIOSInstallGuide, getCurrentEndpoint,
  subscribeToPush, unsubscribeFromPush, sendTestPush, listSubscriptions,
} from "@/lib/push-client";

function permissionLabel(permission: NotificationPermission): string {
  if (permission === "granted") return "Concedida";
  if (permission === "denied") return "Negada — reative nas configurações do navegador";
  return "Ainda não perguntada";
}

export function PushDiagnostics() {
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string>("");

  const supported = isPushSupported();
  const iosGuide = needsIOSInstallGuide();

  const { data: subscriptions } = useQuery({
    queryKey: ["push-subscriptions"],
    queryFn: listSubscriptions,
    enabled: supported,
  });

  useEffect(() => {
    if (!supported) return;
    void getCurrentEndpoint().then(setCurrentEndpoint);
  }, [supported]);

  const thisDeviceActive = !!currentEndpoint && subscriptions?.some((s) => s.endpoint === currentEndpoint && s.active);

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ["push-subscriptions"] });
    void getCurrentEndpoint().then(setCurrentEndpoint);
  };

  const handleActivate = async () => {
    setBusy(true);
    setTestResult("");
    const result = await subscribeToPush();
    setPermission(typeof Notification !== "undefined" ? Notification.permission : "denied");
    setBusy(false);
    if (result.ok) refetch();
  };

  const handleDeactivate = async () => {
    setBusy(true);
    await unsubscribeFromPush();
    setBusy(false);
    refetch();
  };

  const handleTest = async () => {
    setBusy(true);
    setTestResult("");
    const result = await sendTestPush();
    setBusy(false);
    if (result.sent > 0) setTestResult("Teste enviado — a notificação deve chegar em instantes.");
    else if (result.expired > 0) setTestResult("A assinatura deste dispositivo expirou. Ative de novo abaixo.");
    else setTestResult("Não foi possível enviar agora. Tente de novo em alguns instantes.");
    refetch();
  };

  return (
    <div className="p-4 rounded-xl border bg-card space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Seus lembretes estão funcionando?</h3>
      </div>

      {!supported && (
        <p className="text-sm text-muted-foreground">Este navegador não é compatível com notificações push.</p>
      )}

      {supported && (
        <>
          <dl className="text-[17px] space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Permissão</dt>
              <dd>{permissionLabel(permission)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Este dispositivo</dt>
              <dd className="flex items-center gap-1">
                {thisDeviceActive ? (
                  <><CircleCheck className="w-4 h-4 text-zelo-green-fg" /> Ativo</>
                ) : (
                  <><BellOff className="w-4 h-4 text-muted-foreground" /> Não ativado</>
                )}
              </dd>
            </div>
          </dl>

          {iosGuide ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/notificacoes/ios">Como ativar no iPhone</Link>
            </Button>
          ) : thisDeviceActive ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void handleTest()} disabled={busy}>
                {busy ? "Enviando…" : "Enviar teste"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void handleDeactivate()} disabled={busy}>
                Desativar neste dispositivo
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => void handleActivate()} disabled={busy}>
              {busy ? "Ativando…" : "Ativar neste dispositivo"}
            </Button>
          )}

          {testResult && (
            <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
              <CircleAlert className="w-3.5 h-3.5 shrink-0" /> {testResult}
            </p>
          )}

          {subscriptions && subscriptions.length > 0 && (
            <details className="pt-1">
              <summary className="text-sm text-muted-foreground cursor-pointer select-none">
                Dispositivos cadastrados ({subscriptions.length})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {subscriptions.map((s) => (
                  <li key={s.id} className="flex justify-between text-sm">
                    <span className={s.active ? "" : "text-muted-foreground line-through"}>
                      {s.deviceLabel ?? "Dispositivo"}
                    </span>
                    <span className="text-muted-foreground">
                      {s.active
                        ? s.lastDeliveredAt
                          ? `último push: ${new Date(s.lastDeliveredAt).toLocaleString("pt-BR")}`
                          : "sem push confirmado ainda"
                        : "expirado"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

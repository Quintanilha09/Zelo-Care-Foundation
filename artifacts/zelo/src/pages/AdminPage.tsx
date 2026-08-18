/**
 * Painel operacional — ZELO (ZELO-32).
 *
 * Superfície DELIBERADAMENTE separada do resto do app: sem AppHeader, sem
 * nav de cuidador, visual distinto (escuro), autenticação própria
 * (lib/admin-client.ts, nunca o token de cuidador). Nenhum dado aqui pode
 * ser nome de paciente/cuidador/medicamento — só número agregado (ver
 * routes/admin.ts).
 */
import { useEffect, useState } from "react";
import { adminFetch, getAdminToken, setAdminToken, clearAdminToken } from "@/lib/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Metrics {
  periodDays: number;
  totalSent: number;
  totalDelivered: number;
  totalActed: number;
  deliveryRate: number | null;
  actionRate: number | null;
  avgLatencySeconds: number | null;
  byPlatform: Array<{ platform: string; delivered: number }>;
  failuresByReason: Array<{ reason: string; count: number }>;
  byDay: Array<{ date: string; sent: number; delivered: number }>;
  byHour: Array<{ hour: string; sent: number; delivered: number }>;
  subscriptions: { active: number; inactive: number };
}

interface AlertRow {
  id: number;
  type: string;
  message: string;
  metricValue: number | null;
  thresholdValue: number | null;
  triggeredAt: string;
  resolvedAt: string | null;
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  delivery_rate: "Taxa de entrega",
  queue_stuck: "Fila travada",
  no_send_window: "Janela sem envio",
};

const FAILURE_REASON_LABELS: Record<string, string> = {
  not_configured: "Push não configurado",
  no_keys: "Assinatura sem chaves",
  expired: "Assinatura expirada",
  rate_limited: "Limite de taxa (429)",
  error: "Erro de envio",
};

function formatPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}
function formatSeconds(v: number | null): string {
  if (v === null) return "—";
  if (v < 60) return `${Math.round(v)}s`;
  return `${(v / 60).toFixed(1)}min`;
}
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-semibold text-slate-50 mt-1">{value}</p>
    </div>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      if (!res.ok) {
        setError("Senha incorreta");
        return;
      }
      const data = (await res.json()) as { token: string };
      setAdminToken(data.token);
      onSuccess();
    } catch {
      setError("Erro ao entrar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-6 rounded-xl border border-slate-800 bg-slate-900">
        <div>
          <h1 className="text-lg font-semibold">ZELO — Painel Operacional</h1>
          <p className="text-sm text-slate-400">Acesso restrito à operação.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="admin-password" className="text-slate-300">Senha</Label>
          <Input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="bg-slate-950 border-slate-700 text-slate-50"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={loading || !password} className="w-full">
          {loading ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [alerts, setAlerts] = useState<{ active: AlertRow[]; recent: AlertRow[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [metricsRes, alertsRes] = await Promise.all([
        adminFetch("/api/admin/metrics?days=30"),
        adminFetch("/api/admin/alerts"),
      ]);
      if (metricsRes.status === 401 || alertsRes.status === 401) {
        onLogout();
        return;
      }
      if (!metricsRes.ok || !alertsRes.ok) throw new Error("Erro ao carregar métricas");
      setMetrics((await metricsRes.json()) as Metrics);
      setAlerts((await alertsRes.json()) as { active: AlertRow[]; recent: AlertRow[] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleLogout = () => {
    clearAdminToken();
    onLogout();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">ZELO — Painel Operacional</h1>
          <p className="text-xs text-slate-400">Últimos {metrics?.periodDays ?? "…"} dias — agregado, sem dado pessoal</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="border-slate-700 text-slate-200">
            {loading ? "Atualizando…" : "Atualizar"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-400">Sair</Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {alerts && alerts.active.length > 0 && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 p-4 space-y-2">
            <p className="text-sm font-medium text-red-300">{alerts.active.length} alerta(s) ativo(s)</p>
            {alerts.active.map((a) => (
              <p key={a.id} className="text-sm text-red-200">
                <span className="font-medium">{ALERT_TYPE_LABELS[a.type] ?? a.type}</span> — {a.message}
                <span className="text-red-400"> (desde {formatDateTime(a.triggeredAt)})</span>
              </p>
            ))}
          </div>
        )}
        {alerts && alerts.active.length === 0 && (
          <div className="rounded-lg border border-emerald-900 bg-emerald-950/40 p-4">
            <p className="text-sm text-emerald-300">Nenhum alerta ativo — operação normal.</p>
          </div>
        )}

        {metrics && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Taxa de entrega" value={formatPct(metrics.deliveryRate)} />
              <StatTile label="Taxa de ação" value={formatPct(metrics.actionRate)} />
              <StatTile label="Latência média (nível 0)" value={formatSeconds(metrics.avgLatencySeconds)} />
              <StatTile label="Assinaturas ativas" value={`${metrics.subscriptions.active} (${metrics.subscriptions.inactive} inativas)`} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h2 className="text-sm font-medium mb-3">Por plataforma (entregues)</h2>
                {metrics.byPlatform.length === 0 && <p className="text-sm text-slate-500">Sem dado no período.</p>}
                <ul className="space-y-1">
                  {metrics.byPlatform.map((p) => (
                    <li key={p.platform} className="flex justify-between text-sm">
                      <span className="text-slate-300 capitalize">{p.platform}</span>
                      <span className="text-slate-400">{p.delivered}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h2 className="text-sm font-medium mb-3">Falhas por motivo</h2>
                {metrics.failuresByReason.length === 0 && <p className="text-sm text-slate-500">Nenhuma falha no período.</p>}
                <ul className="space-y-1">
                  {metrics.failuresByReason.map((f) => (
                    <li key={f.reason} className="flex justify-between text-sm">
                      <span className="text-slate-300">{FAILURE_REASON_LABELS[f.reason] ?? f.reason}</span>
                      <span className="text-slate-400">{f.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-medium mb-3">Por dia</h2>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="font-normal pb-1">Dia</th>
                      <th className="font-normal pb-1 text-right">Enviados</th>
                      <th className="font-normal pb-1 text-right">Entregues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...metrics.byDay].reverse().map((d) => (
                      <tr key={d.date} className="border-t border-slate-800">
                        <td className="py-1 text-slate-300">{new Date(d.date).toLocaleDateString("pt-BR")}</td>
                        <td className="py-1 text-right text-slate-400">{d.sent}</td>
                        <td className="py-1 text-right text-slate-400">{d.delivered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {alerts && alerts.recent.length > 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h2 className="text-sm font-medium mb-3">Histórico de alertas</h2>
                <ul className="space-y-2">
                  {alerts.recent.map((a) => (
                    <li key={a.id} className="text-sm border-t border-slate-800 pt-2 first:border-0 first:pt-0">
                      <span className="text-slate-300">{ALERT_TYPE_LABELS[a.type] ?? a.type}</span>{" "}
                      <span className="text-slate-500">
                        {formatDateTime(a.triggeredAt)}
                        {a.resolvedAt ? ` → resolvido ${formatDateTime(a.resolvedAt)}` : " (ativo)"}
                      </span>
                      <p className="text-slate-400">{a.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => !!getAdminToken());

  if (!authed) {
    return <AdminLogin onSuccess={() => setAuthed(true)} />;
  }
  return <AdminDashboard onLogout={() => setAuthed(false)} />;
}

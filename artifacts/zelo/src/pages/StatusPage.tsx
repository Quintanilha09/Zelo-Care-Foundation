/**
 * Página pública de status — ZELO (ZELO-32). Sem autenticação, sem PII —
 * só a palavra do estado atual, pra equipe (ou qualquer um) consultar rápido.
 */
import { useEffect, useState } from "react";

interface StatusResponse {
  status: "operational" | "degraded";
  checkedAt: string;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/status`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d) => setData(d as StatusResponse))
      .catch(() => setError(true));
  }, []);

  const operational = data?.status === "operational";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <div className="text-center space-y-3">
        <p className="text-sm text-muted-foreground">ZELO</p>
        {error && <p className="text-lg">Não foi possível consultar o status agora.</p>}
        {!error && !data && <p className="text-lg text-muted-foreground">Consultando…</p>}
        {data && (
          <>
            <div className="flex items-center justify-center gap-2">
              <span className={`inline-block w-3 h-3 rounded-full ${operational ? "bg-zelo-green" : "bg-zelo-amber"}`} />
              <p className="text-xl font-medium">{operational ? "Serviço operando normalmente" : "Serviço com degradação"}</p>
            </div>
            <p className="text-sm text-muted-foreground">Verificado em {new Date(data.checkedAt).toLocaleString("pt-BR")}</p>
          </>
        )}
      </div>
    </div>
  );
}

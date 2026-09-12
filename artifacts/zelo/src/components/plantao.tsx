/**
 * O plantão na tela — Issue #177.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DE QUEM É A VEZ, E NUNCA QUEM PODE.
 *
 * Nada aqui esconde, desabilita ou restringe coisa alguma. O cuidador que não
 * está de plantão continua vendo todos os pacientes, todas as doses e todos
 * os botões — exatamente como antes desta tela existir. A escala responde uma
 * pergunta de combinação, não de permissão.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Família que não reveza não vê nada disto ─────────────────────────────
 *
 * Sem escala cadastrada, `LinhaDoPlantao` não desenha nada e a seção da ficha
 * fica fechada atrás de um link discreto. Transformar a escala em cadastro
 * obrigatório cobraria de toda família o preço de um caso que é de algumas.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { authFetch } from "@/lib/auth-client";
import { nomeCurto } from "@workspace/nomes";

export interface PlantaoDeHoje {
  patientId: number;
  patientName: string;
  caregiverId: number;
  caregiverName: string;
  startTime: string;
  endTime: string;
  troca: boolean;
  souEu: boolean;
}

const DIAS = [
  { valor: "0", nome: "Domingo" },
  { valor: "1", nome: "Segunda" },
  { valor: "2", nome: "Terça" },
  { valor: "3", nome: "Quarta" },
  { valor: "4", nome: "Quinta" },
  { valor: "5", nome: "Sexta" },
  { valor: "6", nome: "Sábado" },
];

/** "00:00–23:59" é o dia inteiro, e dizer isso em números seria ruído. */
function periodo(inicio: string, fim: string): string {
  if (inicio === "00:00" && fim === "23:59") return "";
  return ` das ${inicio} às ${fim}`;
}

/**
 * A linha da tela inicial: uma frase, no máximo uma por paciente.
 *
 * "Hoje é a sua vez" vem antes de qualquer nome, porque é a informação que
 * muda o que a pessoa vai fazer nos próximos minutos.
 */
export function LinhaDoPlantao({
  plantoes,
  varios,
}: {
  plantoes: PlantaoDeHoje[];
  /** Com mais de um paciente, cada linha precisa dizer de quem. */
  varios: boolean;
}) {
  if (plantoes.length === 0) return null;

  return (
    <div className="space-y-1">
      {plantoes.map((p) => (
        <p
          key={p.patientId}
          className="text-sm text-muted-foreground flex items-center gap-1.5"
        >
          <CalendarClock className="w-3.5 h-3.5 shrink-0" />
          <span>
            {p.souEu ? (
              <>
                <strong className="text-foreground font-medium">Hoje é a sua vez</strong>
                {varios && ` com ${nomeCurto(p.patientName)}`}
              </>
            ) : (
              <>
                Hoje é a vez de {nomeCurto(p.caregiverName)}
                {varios && ` com ${nomeCurto(p.patientName)}`}
              </>
            )}
            {periodo(p.startTime, p.endTime)}
            {/* A troca pontual é dita com todas as letras: quem combinou de
                trocar precisa ver que o app entendeu, senão vai conferir no
                WhatsApp — que é o que esta funcionalidade veio evitar. */}
            {p.troca && " (troca combinada)"}
          </span>
        </p>
      ))}
    </div>
  );
}

interface Turno {
  id: number;
  caregiverId: number;
  caregiverName: string;
  weekday: number | null;
  onDate: string | null;
  startTime: string;
  endTime: string;
}

interface Escala {
  turnos: Turno[];
  agora: { caregiverName: string; startTime: string; endTime: string; troca: boolean } | null;
  cuidadores: Array<{ id: number; name: string; role: string }>;
}

/**
 * A seção da ficha, onde a escala é montada.
 *
 * Fechada por padrão quando não há turno nenhum: a maioria das famílias não
 * reveza, e um bloco de escala sempre aberto na ficha seria mais uma coisa
 * para ignorar numa tela que já tem muitas.
 */
export function EscalaDePlantao({
  patientId,
  somenteLeitura = false,
}: {
  patientId: number;
  somenteLeitura?: boolean;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [cuidador, setCuidador] = useState("");
  const [tipo, setTipo] = useState<"semanal" | "data">("semanal");
  const [dia, setDia] = useState("1");
  const [data, setData] = useState("");
  const [inicio, setInicio] = useState("00:00");
  const [fim, setFim] = useState("23:59");

  const { data: escala } = useQuery({
    queryKey: ["plantao", patientId],
    queryFn: async (): Promise<Escala> => {
      const res = await authFetch(`/api/patients/${patientId}/plantao`);
      if (!res.ok) throw new Error("Erro ao carregar a escala");
      return res.json();
    },
  });

  const turnos = escala?.turnos ?? [];
  const temEscala = turnos.length > 0;

  const recarregar = () => void qc.invalidateQueries({ queryKey: ["plantao", patientId] });

  const adicionar = async () => {
    setErro("");
    if (!cuidador) { setErro("Escolha quem fica de plantão."); return; }
    if (tipo === "data" && !data) { setErro("Escolha a data da troca."); return; }
    setSalvando(true);
    try {
      const res = await authFetch(`/api/patients/${patientId}/plantao`, {
        method: "POST",
        body: JSON.stringify({
          caregiverId: Number(cuidador),
          ...(tipo === "semanal" ? { weekday: Number(dia) } : { onDate: data }),
          startTime: inicio,
          endTime: fim,
        }),
      });
      if (!res.ok) {
        const dados = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(dados.error ?? "Não foi possível salvar o turno.");
      }
      setData("");
      recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o turno.");
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (id: number) => {
    setErro("");
    try {
      const res = await authFetch(`/api/patients/${patientId}/plantao/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Não foi possível remover o turno.");
      recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível remover o turno.");
    }
  };

  if (!temEscala && !aberto) {
    return (
      <button
        type="button"
        className="text-sm text-muted-foreground underline text-left"
        onClick={() => setAberto(true)}
      >
        Combinar de quem é a vez (plantão)
      </button>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">De quem é a vez</h3>
        {escala?.agora && (
          <span className="text-sm">
            Agora: {nomeCurto(escala.agora.caregiverName)}
            {periodo(escala.agora.startTime, escala.agora.endTime)}
          </span>
        )}
      </div>

      {/* A frase que impede o mal-entendido inteiro. Sem ela, alguém vai
          achar que ficar fora da escala tira o acesso — e não tira. */}
      <p className="text-xs text-muted-foreground">
        A escala diz de quem é a vez, e só. Ninguém perde acesso a nada por não
        estar de plantão, e o aviso continua indo para a família toda se a dose
        não for registrada.
      </p>

      {turnos.length > 0 && (
        <ul className="space-y-1">
          {turnos.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-[17px]">
              <span className="min-w-0 truncate">
                {t.weekday !== null
                  ? DIAS[t.weekday].nome
                  : t.onDate?.split("-").reverse().join("/")}
                {periodo(t.startTime, t.endTime)} · {nomeCurto(t.caregiverName)}
              </span>
              {!somenteLeitura && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover o turno de ${nomeCurto(t.caregiverName)}`}
                  onClick={() => void remover(t.id)}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!somenteLeitura && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pl-quem">Quem</Label>
              <Select value={cuidador} onValueChange={setCuidador}>
                <SelectTrigger id="pl-quem"><SelectValue placeholder="Escolher" /></SelectTrigger>
                <SelectContent>
                  {/* TODOS os cuidadores, sem filtro de papel: o observador
                      não registra dose, mas pode perfeitamente ser quem está
                      com a pessoa naquele turno. */}
                  {(escala?.cuidadores ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pl-tipo">Quando</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as "semanal" | "data")}>
                <SelectTrigger id="pl-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="semanal">Toda semana</SelectItem>
                  <SelectItem value="data">Um dia só (troca)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipo === "semanal" ? (
              <div className="space-y-1">
                <Label htmlFor="pl-dia">Dia da semana</Label>
                <Select value={dia} onValueChange={setDia}>
                  <SelectTrigger id="pl-dia"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIAS.map((d) => (
                      <SelectItem key={d.valor} value={d.valor}>{d.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="pl-data">Data</Label>
                <Input id="pl-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="pl-inicio">Das</Label>
                <Input id="pl-inicio" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pl-fim">Às</Label>
                <Input id="pl-fim" type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
              </div>
            </div>
          </div>

          {/* O turno da noite é o caso mais comum de plantão, e ele vira a
              meia-noite. Dizer isso evita que alguém desista achando que o
              app não aceita. */}
          <p className="text-xs text-muted-foreground">
            Das 00:00 às 23:59 é o dia inteiro. Para o turno da noite, use
            22:00 às 06:00 — ele atravessa a madrugada.
          </p>

          {erro && <p className="text-sm text-zelo-amber-fg">{erro}</p>}

          <Button type="button" size="sm" onClick={() => void adicionar()} disabled={salvando}>
            {salvando ? "Salvando…" : "Adicionar turno"}
          </Button>
        </div>
      )}
    </div>
  );
}

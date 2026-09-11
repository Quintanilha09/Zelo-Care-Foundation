/**
 * O dono único de "registrar uma dose" — Issue #162.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ISTO EXISTIA TRÊS VEZES, E CADA CÓPIA FICOU COM METADE DO PRODUTO.
 *
 * Medido em 11/09/2026: `HomePage`, `PatientDetailPage` e `ElderModePage`
 * tinham cada uma o seu `handleRegister`. Elas divergiram, e o resultado foi
 * um produto pela metade em cada tela:
 *
 *   | o que existe                      | inicial | ficha |
 *   |-----------------------------------|---------|-------|
 *   | escolher o horário real           | sim     | NÃO   |
 *   | justificativa quando o servidor pede | sim  | NÃO   |
 *   | mostrar o erro quando falha       | sim     | NÃO   |
 *   | perguntar antes de dose que não chegou | NÃO | sim  |
 *   | corrigir depois do minuto         | NÃO     | sim   |
 *
 * `ANTECIPACAO_REQUERIDA` era tratado em 1 das 3 telas. `CorrigirDose` era
 * importado em 1 arquivo.
 *
 * O fundador bateu de frente com isso: registrou pela tela inicial, o
 * desfazer venceu, e ali **não havia como corrigir**.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que este arquivo decide, e o que ele NÃO decide ────────────────────
 *
 * Ele decide **como se conversa com o servidor** sobre uma dose: o corpo da
 * requisição, os três códigos que voltam, o que cada um significa na tela.
 *
 * Ele **não** decide como isso aparece. Quem desenha é `AcoesDaDose`, e o
 * modo idoso continua com a tela própria dele (ZELO-40: uma dose por vez, um
 * botão gigante) — consumindo este mesmo hook.
 *
 * ── Os três códigos que o servidor devolve ──────────────────────────────
 *
 * 1. `ANTECIPACAO_REQUERIDA` (#134) — a dose está a mais de uma hora de
 *    distância. **O cliente não sabe qual é a janela, de propósito:** ele
 *    tenta, e o servidor responde. Duplicar "uma hora" aqui criaria dois
 *    donos do mesmo número e um dia em que discordam.
 * 2. `JUSTIFICATION_REQUIRED` — registro antigo demais pede uma linha sobre
 *    o que houve.
 * 3. Corrida perdida — outro cuidador registrou primeiro. **Não é erro**, é
 *    informação: a dose está registrada, que era o objetivo.
 */
import { useState } from "react";
import { authFetch } from "@/lib/auth-client";
import type { DoseParaCorrigir } from "@/components/corrigir-dose";

export type Desfecho = "taken" | "skipped";

/**
 * O mínimo que uma dose precisa ter para ser registrável.
 *
 * As telas têm tipos próprios e mais largos (`HomeDose`, `ScheduledDose`).
 * Este é o recorte comum, e é de propósito o menor possível: quanto menos
 * este módulo exigir, menos ele amarra quem o usa.
 */
export interface DoseRegistravel {
  id: number;
  scheduledAt: string;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late";
  recordId: number | null;
  desfazerAte: string | null;
}

export interface OpcoesDeRegistro {
  /**
   * O horário real, em ISO.
   *
   * **Só mande quando a pessoa escolheu um.** No caminho comum "registrar
   * agora", quem decide a hora é o relógio do SERVIDOR — o do aparelho pode
   * estar fora de sincronia e derrubar o registro como dose no futuro. A
   * armadilha está escrita no `CLAUDE.md`.
   */
  takenAt?: string;
  justification?: string;
  confirmarAntecipacao?: boolean;
}

interface Antecipacao {
  doseId: number;
  desfecho: Desfecho;
  /** "19:00" — vem do servidor, no fuso do paciente. */
  horario: string;
}

export interface ControladorDeDose {
  // ── estado que a interface desenha ──────────────────────────────────────
  /** Não-nulo enquanto a pergunta da #134 está aberta. */
  antecipacao: Antecipacao | null;
  /** A dose cujo editor de horário está aberto. */
  editandoHorarioDe: number | null;
  /** A dose para a qual o servidor exigiu justificativa. */
  precisaJustificar: number | null;
  /** A dose cuja correção está aberta (#136). */
  aCorrigir: DoseParaCorrigir | null;
  horario: string;
  justificativa: string;
  /** A dose com requisição em voo — trava o botão e evita registro duplo. */
  emVoo: number | null;
  erro: string | null;
  /** Corrida perdida: informação, nunca erro. */
  aviso: string | null;

  // ── ações ───────────────────────────────────────────────────────────────
  registrar: (doseId: number, desfecho: Desfecho, opcoes?: OpcoesDeRegistro) => Promise<void>;
  desfazer: (recordId: number) => Promise<void>;
  abrirEditorDeHorario: (doseId: number, sugestao: Date) => void;
  fecharEditor: () => void;
  confirmarHorarioEscolhido: (doseId: number, desfecho: Desfecho) => Promise<void>;
  abrirCorrecao: (dose: DoseParaCorrigir) => void;
  fecharCorrecao: () => void;
  aoCorrigir: () => void;
  responderAntecipacao: (sim: boolean, comHorario?: boolean) => void;
  setHorario: (v: string) => void;
  setJustificativa: (v: string) => void;
}

/** "YYYY-MM-DDTHH:mm" no fuso do NAVEGADOR — o formato do `datetime-local`. */
export function paraCampoDeHorario(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function useRegistrarDose({
  patientId,
  aoMudar,
  otimista,
}: {
  patientId: number | string;
  /** Chamado depois de toda mudança — as telas invalidam as queries delas. */
  aoMudar: () => void;
  /**
   * Pinta o resultado antes da resposta chegar. Opcional: a tela que não
   * passa nada apenas espera o `aoMudar`.
   */
  otimista?: (doseId: number, desfecho: Desfecho) => void;
}): ControladorDeDose {
  const [antecipacao, setAntecipacao] = useState<Antecipacao | null>(null);
  const [editandoHorarioDe, setEditandoHorarioDe] = useState<number | null>(null);
  const [precisaJustificar, setPrecisaJustificar] = useState<number | null>(null);
  const [aCorrigir, setACorrigir] = useState<DoseParaCorrigir | null>(null);
  const [horario, setHorario] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [emVoo, setEmVoo] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const registrar = async (doseId: number, desfecho: Desfecho, opcoes: OpcoesDeRegistro = {}) => {
    setErro(null);
    setAviso(null);
    setEmVoo(doseId);
    otimista?.(doseId, desfecho);

    let res: Response;
    try {
      res = await authFetch(`/api/patients/${patientId}/dose-records`, {
        method: "POST",
        body: JSON.stringify({
          scheduledDoseId: doseId,
          outcome: desfecho,
          takenAt: opcoes.takenAt,
          justification: opcoes.justification?.trim() || undefined,
          ...(opcoes.confirmarAntecipacao ? { confirmarAntecipacao: true } : {}),
        }),
      });
    } catch (e) {
      // Duas coisas chegam aqui, e elas pedem frases diferentes: o `fetch`
      // rejeitando por falta de rede, e o `authFetch` lançando "Sessão
      // expirada" quando o refresh falha.
      //
      // A versão anterior desta lógica na ficha do paciente deixava a exceção
      // subir — o botão voltava ao normal e a tela não dizia nada. Falha
      // silenciosa é a pior classe de defeito neste produto: não parece
      // defeito, parece que a pessoa errou.
      setEmVoo(null);
      aoMudar();
      const motivo = e instanceof Error && e.message ? e.message : null;
      setErro(motivo ?? "Sem conexão agora. A dose não foi registrada — tente de novo em instantes.");
      return;
    }

    const corpo = (await res.json().catch(() => null)) as
      | { id: number; wonRace: boolean; message?: string }
      | { error?: string; code?: string; scheduledLocalTime?: string }
      | null;

    setEmVoo(null);
    // Sempre: no sucesso traz o estado novo, no erro desfaz o otimismo.
    aoMudar();

    if (!res.ok) {
      const err = corpo as { error?: string; code?: string; scheduledLocalTime?: string } | null;

      if (err?.code === "ANTECIPACAO_REQUERIDA") {
        setAntecipacao({ doseId, desfecho, horario: err.scheduledLocalTime ?? "" });
        return;
      }
      if (err?.code === "JUSTIFICATION_REQUIRED") {
        setPrecisaJustificar(doseId);
        setEditandoHorarioDe(doseId);
        if (!horario) setHorario(paraCampoDeHorario(new Date()));
        return;
      }
      setErro(err?.error ?? "Não foi possível registrar essa dose.");
      return;
    }

    setAntecipacao(null);
    setEditandoHorarioDe(null);
    setPrecisaJustificar(null);
    setJustificativa("");

    const ok = corpo as { wonRace: boolean; message?: string };
    if (ok && ok.wonRace === false) {
      setAviso(ok.message ?? "Essa dose já foi registrada por outra pessoa.");
    }
  };

  const desfazer = async (recordId: number) => {
    setErro(null);
    setAviso(null);
    const res = await authFetch(`/api/patients/${patientId}/dose-records/${recordId}/undo`, {
      method: "POST",
    }).catch(() => null);

    if (!res || !res.ok) {
      const corpo = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      setErro(corpo.error ?? "Não deu pra desfazer agora.");
    }
    aoMudar();
  };

  return {
    antecipacao,
    editandoHorarioDe,
    precisaJustificar,
    aCorrigir,
    horario,
    justificativa,
    emVoo,
    erro,
    aviso,

    registrar,
    desfazer,

    abrirEditorDeHorario: (doseId, sugestao) => {
      setErro(null);
      setAviso(null);
      setJustificativa("");
      setPrecisaJustificar(null);
      // A sugestão é o horário AGENDADO, não o agora: é o que a pessoa
      // combinou com o médico, e na maioria das vezes é a resposta certa.
      setHorario(paraCampoDeHorario(sugestao));
      setEditandoHorarioDe(doseId);
    },
    fecharEditor: () => {
      setEditandoHorarioDe(null);
      setPrecisaJustificar(null);
      setErro(null);
    },
    confirmarHorarioEscolhido: async (doseId, desfecho) => {
      const quando = new Date(horario);
      if (Number.isNaN(quando.getTime())) {
        setErro("Escolha um horário válido.");
        return;
      }
      await registrar(doseId, desfecho, {
        takenAt: quando.toISOString(),
        justification: justificativa,
      });
    },

    abrirCorrecao: (dose) => { setErro(null); setACorrigir(dose); },
    fecharCorrecao: () => setACorrigir(null),
    aoCorrigir: () => { setACorrigir(null); aoMudar(); },

    /**
     * A resposta à pergunta da #134.
     *
     * `sim` sem `comHorario` registra agora — é o "Sim, agora". Com
     * `comHorario`, fecha a pergunta e abre o editor: é o "Dei em outro
     * horário" que faltava, e que era o pedido do fundador (#163).
     */
    responderAntecipacao: (sim, comHorario) => {
      const pedido = antecipacao;
      setAntecipacao(null);
      if (!sim || !pedido) return;

      if (comHorario) {
        setJustificativa("");
        setPrecisaJustificar(null);
        setHorario(paraCampoDeHorario(new Date()));
        setEditandoHorarioDe(pedido.doseId);
        return;
      }
      void registrar(pedido.doseId, pedido.desfecho, { confirmarAntecipacao: true });
    },

    setHorario,
    setJustificativa,
  };
}

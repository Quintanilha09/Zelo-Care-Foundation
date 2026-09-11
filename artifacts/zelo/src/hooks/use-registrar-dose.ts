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
import { enqueueAction } from "@/lib/offline-queue";
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
  /**
   * De quem é esta dose — Issue #178.
   *
   * Antes o paciente vinha do hook, um só para a tela inteira. A tela
   * inicial passou a mostrar as doses de **todos** os pacientes de uma vez,
   * e aí o paciente deixou de ser propriedade da tela: ele é propriedade da
   * dose, e sempre foi.
   */
  patientId: number;
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

/** A dose que a correção está editando, mais de quem ela é. */
export interface CorrecaoAberta extends DoseParaCorrigir {
  patientId: number;
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
  aCorrigir: CorrecaoAberta | null;
  horario: string;
  justificativa: string;
  /** A dose com requisição em voo — trava o botão e evita registro duplo. */
  emVoo: number | null;
  erro: string | null;
  /** Corrida perdida: informação, nunca erro. */
  aviso: string | null;
  /**
   * A dose que acabou de ser pulada e ainda nao tem motivo — Issue #166.
   *
   * Pular continua sendo UM toque: a dose e registrada na hora. Isto abre
   * logo depois, como oferta, e some sozinho quando a pessoa segue em frente.
   */
  motivoPendente: DoseRegistravel | null;

  // ── ações ───────────────────────────────────────────────────────────────
  registrar: (dose: DoseRegistravel, desfecho: Desfecho, opcoes?: OpcoesDeRegistro) => Promise<void>;
  desfazer: (dose: DoseRegistravel) => Promise<void>;
  abrirEditorDeHorario: (doseId: number, sugestao: Date) => void;
  fecharEditor: () => void;
  confirmarHorarioEscolhido: (dose: DoseRegistravel, desfecho: Desfecho) => Promise<void>;
  darOMotivo: (texto: string) => Promise<void>;
  dispensarOMotivo: () => void;
  abrirCorrecao: (dose: CorrecaoAberta) => void;
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
  aoMudar,
  otimista,
}: {
  /** Chamado depois de toda mudança — as telas invalidam as queries delas. */
  aoMudar: () => void;
  /**
   * Pinta o resultado antes da resposta chegar. Opcional: a tela que não
   * passa nada apenas espera o `aoMudar`.
   */
  otimista?: (doseId: number, desfecho: Desfecho) => void;
}): ControladorDeDose {
  const [antecipacao, setAntecipacao] = useState<(Antecipacao & { dose: DoseRegistravel }) | null>(null);
  const [editandoHorarioDe, setEditandoHorarioDe] = useState<number | null>(null);
  const [precisaJustificar, setPrecisaJustificar] = useState<number | null>(null);
  const [aCorrigir, setACorrigir] = useState<CorrecaoAberta | null>(null);
  const [horario, setHorario] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [emVoo, setEmVoo] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [motivoPendente, setMotivoPendente] = useState<DoseRegistravel | null>(null);

  const registrar = async (dose: DoseRegistravel, desfecho: Desfecho, opcoes: OpcoesDeRegistro = {}) => {
    const doseId = dose.id;
    setErro(null);
    setAviso(null);
    setEmVoo(doseId);
    otimista?.(doseId, desfecho);

    let res: Response;
    try {
      res = await authFetch(`/api/patients/${dose.patientId}/dose-records`, {
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
      setEmVoo(null);

      /**
       * ═══════════════════════════════════════════════════════════════════
       * SEM INTERNET, A DOSE VAI PARA A FILA — Issue #167.
       *
       * A fila existia e funcionava, mas só recebia os botões da
       * NOTIFICAÇÃO. Pelo app, offline, o toque se perdia — e a tela
       * inicial chegava a mostrar "Sem conexão" enquanto oferecia o botão
       * que ia falhar.
       *
       * O momento de dar remédio é, com frequência, o pior momento de
       * sinal: quarto nos fundos, elevador, hospital, casa de campo. A
       * promessa do produto — *a ação do cuidador nunca se perde* — valia
       * para a notificação e não valia para a tela.
       * ═══════════════════════════════════════════════════════════════════
       *
       * ── Sessão vencida NÃO entra na fila ──────────────────────────────
       *
       * `authFetch` lança em dois casos: rede caída e refresh recusado.
       * Enfileirar o segundo guardaria uma ação que vai ser recusada de
       * novo, e a pessoa acharia que registrou. Só a falta de rede vira
       * fila; o resto vira mensagem.
       */
      const semRede = !(e instanceof Error) || !e.message || !navigator.onLine;
      if (semRede) {
        await enqueueAction({
          kind: "register",
          scheduledDoseId: doseId,
          patientId: dose.patientId,
          outcome: desfecho,
          /**
           * O relógio DESTE aparelho, e aqui ele é a fonte certa.
           *
           * A regra do projeto — "o relógio do cliente não é fonte de
           * verdade" — existe para o caminho comum, em que o servidor
           * está a um pedido de distância e sabe melhor. Offline não há
           * servidor, e o horário do toque é a única coisa verdadeira que
           * existe sobre quando o remédio foi dado.
           */
          takenAt: opcoes.takenAt ?? new Date().toISOString(),
          justification: opcoes.justification?.trim() || undefined,
        }).catch(() => { /* IndexedDB indisponível: cai na mensagem abaixo */ });

        otimista?.(doseId, desfecho);
        // Honestidade: nem fingir que subiu, nem fingir que falhou. Quem
        // acha que subiu não confere depois.
        setAviso("Registrado. Vai subir quando a internet voltar.");
        return;
      }

      aoMudar();
      setErro(e instanceof Error ? e.message : "Não foi possível registrar essa dose.");
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
        setAntecipacao({ doseId, desfecho, horario: err.scheduledLocalTime ?? "", dose });
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
      return;
    }

    /**
     * Issue #166 — a oferta do motivo, DEPOIS de a dose estar registrada.
     *
     * Uma dose pulada é informação para o médico, e o motivo é metade
     * dela: "pulou porque estava vomitando" e "pulou porque acabou o
     * remédio" são duas conversas diferentes na consulta, e hoje viram a
     * mesma linha "Pulado".
     *
     * Só para PULAR: quem registra uma dose tomada não deve nada a
     * ninguém, e perguntar ali seria transformar o caminho comum num
     * interrogatório.
     *
     * E só quando a pessoa não disse nada ainda — se ela veio pelo editor
     * de horário e escreveu uma justificativa, perguntar de novo seria não
     * ter ouvido.
     */
    if (desfecho === "skipped" && !opcoes.justification?.trim()) {
      setMotivoPendente(dose);
    }
  };

  const desfazer = async (dose: DoseRegistravel) => {
    setErro(null);
    setAviso(null);
    const res = await authFetch(
      `/api/patients/${dose.patientId}/dose-records/${dose.recordId}/undo`,
      { method: "POST" },
    ).catch(() => null);

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
    confirmarHorarioEscolhido: async (dose, desfecho) => {
      const quando = new Date(horario);
      if (Number.isNaN(quando.getTime())) {
        setErro("Escolha um horário válido.");
        return;
      }
      await registrar(dose, desfecho, {
        takenAt: quando.toISOString(),
        justification: justificativa,
      });
    },

    motivoPendente,
    /**
     * Acrescenta o motivo ao registro que acabou de ser feito.
     *
     * Rota própria, e não o PATCH de correção: acrescentar um motivo que
     * faltava não emenda nada — o desfecho e o horário continuam os
     * mesmos —, e usar o PATCH marcaria o registro como "corrigido". Uma
     * marca de emenda onde não houve emenda é uma marca que mente.
     */
    darOMotivo: async (texto: string) => {
      const dose = motivoPendente;
      if (!dose || !dose.recordId || !texto.trim()) return;
      setMotivoPendente(null);
      const res = await authFetch(
        `/api/patients/${dose.patientId}/dose-records/${dose.recordId}/motivo`,
        { method: "POST", body: JSON.stringify({ justification: texto.trim() }) },
      ).catch(() => null);
      if (!res || !res.ok) {
        // O motivo é uma oferta: se ele não sobe, a DOSE continua
        // registrada, que é o que importa. Avisar, e não alarmar.
        setAviso("Não deu para guardar o motivo agora. A dose está registrada.");
        return;
      }
      aoMudar();
    },
    /** Seguir em frente sem dizer nada — e isso não é falha de ninguém. */
    dispensarOMotivo: () => setMotivoPendente(null),

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
      void registrar(pedido.dose, pedido.desfecho, { confirmarAntecipacao: true });
    },

    setHorario,
    setJustificativa,
  };
}

// ── O motivo de uma dose pulada — Issue #166 ────────────────────────────────

/**
 * Sugestões curtas de por que uma dose não foi dada.
 *
 * ── Elas descrevem o que ACONTECEU, nunca o que se deveria fazer ─────────
 *
 * Invariante 4: o ZELO registra, não orienta. "Estava passando mal" é um
 * relato; "espere a pressão normalizar" seria conselho clínico, e não entra
 * aqui nem como sugestão.
 *
 * ── Por que sugestões, e não um campo em branco ──────────────────────────
 *
 * Quem está com o remédio na mão não vai digitar. Um campo vazio recebe
 * silêncio, e o relatório do médico continua dizendo só "Pulado" — que é o
 * problema que a issue existe para resolver. Quatro toques possíveis cobrem
 * a maior parte do que acontece de verdade.
 *
 * O campo livre continua existindo, para o que não cabe em nenhuma delas.
 */
export const MOTIVOS_SUGERIDOS = [
  "Acabou o remédio",
  "A pessoa recusou",
  "Estava passando mal",
  "O médico mandou suspender",
] as const;

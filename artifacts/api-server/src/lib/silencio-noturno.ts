/**
 * A janela de silêncio noturno da família — ZELO-30.
 *
 * ── Por que isto virou arquivo próprio ────────────────────────────────────
 *
 * A regra nasceu dentro de `dose-reminders.ts`, porque só a cascata de dose
 * precisava dela. A QUI-10 trouxe um segundo interessado — o aviso de
 * momento novo — e duas cópias da mesma conta de horário divergem: alguém
 * conserta a que está na frente e a outra continua errada.
 *
 * **Isto é uma mudança de lugar, não de comportamento.** A função é a mesma,
 * e os testes da cascata de dose que já existiam continuam sendo a prova.
 *
 * ── O que "silêncio" significa em cada lugar ──────────────────────────────
 *
 * Não é a mesma decisão para todo mundo, e isso é deliberado:
 *
 *   - **dose** — o silêncio segura o nível 2 (T+30), mas o perfil `critical`
 *     atravessa. Existe remédio que vale acordar alguém;
 *   - **momento** — o silêncio simplesmente cancela o aviso. Uma foto no
 *     mural não é urgência nenhuma, e ela vai continuar lá de manhã.
 *
 * Quem decide é quem chama. Este arquivo só responde "estamos na janela?".
 */
import { toLocalDateTime } from "@workspace/scheduling";
import { Clock } from "./clock.ts";

export interface JanelaDeSilencio {
  quietHoursEnabled: boolean;
  /** "HH:mm", mesmo formato de `scheduled_local_time`. */
  quietHoursStart: string;
  quietHoursEnd: string;
}

/**
 * Estamos dentro da janela de silêncio, **no fuso do paciente**?
 *
 * O fuso é o dela, não o de quem está olhando: um filho em Portugal não pode
 * fazer o telefone da mãe em São Paulo tocar às 3 da manhã porque lá são 7.
 *
 * Comparação como string funciona porque "HH:mm" ordena igual ao relógio.
 * Quando `start > end` a janela cruza a meia-noite (o caso normal: 22:00 às
 * 07:00), e aí a conta inverte de propósito.
 *
 * `Clock.now()`, nunca `new Date()` — é o que deixa o teste congelar o
 * relógio e provar a regra sem esperar a madrugada chegar.
 */
export function estaEmSilencioNoturno(
  fusoDoPaciente: string,
  familia: JanelaDeSilencio
): boolean {
  // Início igual ao fim é janela de duração zero, não janela de 24 horas.
  // Tratar como "silêncio o dia inteiro" faria uma configuração acidental
  // desligar todos os avisos da família sem ninguém entender por quê.
  if (!familia.quietHoursEnabled || familia.quietHoursStart === familia.quietHoursEnd) return false;

  const agoraLocal = toLocalDateTime(Clock.now(), fusoDoPaciente).localTime;
  const { quietHoursStart: inicio, quietHoursEnd: fim } = familia;
  if (inicio < fim) return agoraLocal >= inicio && agoraLocal < fim;
  return agoraLocal >= inicio || agoraLocal < fim;
}

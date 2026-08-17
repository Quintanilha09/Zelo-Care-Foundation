/**
 * Extração de medicamento por foto — ZELO (ZELO-21).
 *
 * Regra absoluta do prompt: EXTRAIR, jamais INFERIR. Se a foto não mostra
 * um campo com clareza, o campo volta vazio com confiança baixa — nunca
 * chute silencioso. O modelo nunca sugere dose, nunca completa posologia
 * incompleta, nunca opina sobre o medicamento. Isto é OCR assistido, não
 * uma recomendação clínica.
 *
 * Usa tool-use forçado (tool_choice) em vez de pedir "responda em JSON" em
 * texto livre — é o jeito confiável de garantir a forma exata da resposta,
 * sem depender do modelo formatar prosa corretamente.
 */
import Anthropic from "@anthropic-ai/sdk";

const VISION_MODEL = "claude-haiku-4-5-20251001";

export interface ExtractedMedicationFields {
  name: string | null;
  concentration: string | null;
  form: string | null;
  /** Posologia como está impressa/legível, texto livre — nunca mapeada para um scheduleConfig estruturado. */
  posologyText: string | null;
}

export interface ExtractionConfidence {
  name: number;
  concentration: number;
  form: number;
  posologyText: number;
}

export interface ExtractionResult {
  fields: ExtractedMedicationFields;
  confidence: ExtractionConfidence;
}

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_medication_extraction",
  description:
    "Registra o que foi lido na foto da caixa de medicamento ou receita. Preencha um campo só se estiver claramente legível; caso contrário, use null e confiança baixa. Nunca invente, complete ou sugira um valor que não está visível na imagem.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: ["string", "null"], description: "Nome do medicamento exatamente como impresso, ou null se ilegível." },
      concentration: { type: ["string", "null"], description: "Concentração/dosagem impressa (ex: '500mg'), ou null se ilegível." },
      form: { type: ["string", "null"], description: "Forma farmacêutica (ex: 'comprimido', 'xarope'), ou null se ilegível." },
      posologyText: {
        type: ["string", "null"],
        description: "Posologia exatamente como impressa ou escrita na receita (ex: '1 comprimido de 8 em 8 horas'), ou null se não houver ou for ilegível. NUNCA complete uma posologia parcial nem sugira uma.",
      },
      confidence: {
        type: "object",
        description: "Confiança de 0 a 1 para cada campo acima, refletindo o quão claramente legível cada um estava na imagem.",
        properties: {
          name: { type: "number", minimum: 0, maximum: 1 },
          concentration: { type: "number", minimum: 0, maximum: 1 },
          form: { type: "number", minimum: 0, maximum: 1 },
          posologyText: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "concentration", "form", "posologyText"],
      },
    },
    required: ["name", "concentration", "form", "posologyText", "confidence"],
  },
};

const SYSTEM_PROMPT = `Você lê fotos de caixas de medicamento ou receitas médicas para preencher um formulário de cadastro. Seu único trabalho é EXTRAIR texto visível — nunca inferir, completar, sugerir ou opinar sobre o medicamento, a dose ou o tratamento. Se algo não está claramente legível na imagem, o campo correspondente deve ser null com confiança 0. Você não é um profissional de saúde e sua resposta não pode conter nenhuma recomendação clínica.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY não definida — configure o segredo para usar extração por foto.");
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Extrai campos de medicamento de uma foto. `imageBase64` sem o prefixo
 * data URI. Lança em caso de falha de rede/API — quem chama decide o
 * fallback (rota converte em resposta calma + caminho manual).
 */
export async function extractMedicationFromPhoto(imageBase64: string, mimeType: string): Promise<ExtractionResult> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_medication_extraction" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 } },
          { type: "text", text: "Extraia os campos visíveis desta foto de medicamento ou receita." },
        ],
      },
    ],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Modelo não retornou extração estruturada");
  }

  const raw = toolUse.input as {
    name: string | null; concentration: string | null; form: string | null; posologyText: string | null;
    confidence: ExtractionConfidence;
  };

  return {
    fields: { name: raw.name, concentration: raw.concentration, form: raw.form, posologyText: raw.posologyText },
    confidence: raw.confidence,
  };
}

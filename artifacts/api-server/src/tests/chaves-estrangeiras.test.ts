/**
 * As chaves estrangeiras que impediam apagar gente — Issue #213.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOIS DEFEITOS REAIS, ACHADOS AO RESTAURAR UM BACKUP DE VERDADE (#199).
 *
 * 1. Remover um cuidador que já registrou dose devolvia **500**. A rota apaga
 *    a linha do cuidador, e a chave sem ação fazia o banco recusar enquanto
 *    houvesse um registro de dose apontando para ele — ou seja, para qualquer
 *    cuidador que tivesse usado o app.
 *
 * 2. Apagar uma família falhava **depois de qualquer restauração**. Duas
 *    cascatas competem (famílias→pacientes→tratamentos e famílias→medicamentos)
 *    e a ordem depende de OIDs internos de gatilho, que mudam no `pg_restore`.
 *    Como apagar família é o caminho da exclusão de dados da LGPD, o efeito
 *    era: depois de um desastre, a exclusão parava de funcionar em silêncio.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Um sufixo por execução: a suíte divide um banco só. */
const MARCA = `fk213-${Date.now()}`; // clock-lint-ok: sufixo de unicidade de dado de teste, nao e tempo de dominio

async function limpar(): Promise<void> {
  await db.execute(sql`DELETE FROM families WHERE slug LIKE ${MARCA + "%"}`);
}

before(limpar);
after(limpar);

/**
 * Monta uma família fictícia completa e devolve os ids.
 *
 * SQL cru de propósito: o que está sendo testado é o comportamento do BANCO
 * ao apagar, não a camada Drizzle. Passar por ela esconderia justamente o que
 * importa.
 */
async function montarFamilia(sufixo: string): Promise<{
  familiaId: number;
  cuidadorId: number;
  registroId: number;
}> {
  const slug = `${MARCA}-${sufixo}`;
  const familia = await db.execute<{ id: number }>(sql`
    INSERT INTO families (name, slug) VALUES ('Familia Ficticia Teste', ${slug}) RETURNING id
  `);
  const familiaId = familia.rows[0]!.id;

  const cuidador = await db.execute<{ id: number }>(sql`
    INSERT INTO caregivers (family_id, name) VALUES (${familiaId}, 'Cuidador Ficticio Teste') RETURNING id
  `);
  const cuidadorId = cuidador.rows[0]!.id;

  const paciente = await db.execute<{ id: number }>(sql`
    INSERT INTO patients (family_id, name, timezone)
    VALUES (${familiaId}, 'Dona Maria Teste', 'America/Sao_Paulo') RETURNING id
  `);
  const pacienteId = paciente.rows[0]!.id;

  const remedio = await db.execute<{ id: number }>(sql`
    INSERT INTO medications (family_id, name)
    VALUES (${familiaId}, 'Remedio Ficticio 500mg (ficticio)') RETURNING id
  `);
  const remedioId = remedio.rows[0]!.id;

  const tratamento = await db.execute<{ id: number }>(sql`
    INSERT INTO treatments (patient_id, medication_id, schedule_type, schedule_config, start_date)
    VALUES (${pacienteId}, ${remedioId}, 'times_per_day', '{"times":["08:00"]}'::jsonb, CURRENT_DATE)
    RETURNING id
  `);
  const tratamentoId = tratamento.rows[0]!.id;

  const dose = await db.execute<{ id: number }>(sql`
    INSERT INTO scheduled_doses (treatment_id, patient_id, scheduled_at, scheduled_local_date, scheduled_local_time)
    VALUES (${tratamentoId}, ${pacienteId}, now(), CURRENT_DATE, '08:00') RETURNING id
  `);

  const registro = await db.execute<{ id: number }>(sql`
    INSERT INTO dose_records (scheduled_dose_id, patient_id, caregiver_id, taken_at)
    VALUES (${dose.rows[0]!.id}, ${pacienteId}, ${cuidadorId}, now()) RETURNING id
  `);

  return { familiaId, cuidadorId, registroId: registro.rows[0]!.id };
}

describe("Remover um cuidador que ja registrou dose", () => {
  it("funciona — e o registro de dose NAO some junto", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * OS DOIS LADOS IMPORTAM, E O SEGUNDO É O INVARIANTE 1 DO PRODUTO.
     *
     * A correção fácil seria `ON DELETE CASCADE`: remover o cuidador
     * funcionaria, apagando todo o histórico de dose que ele registrou.
     * Seria trocar um erro 500 por perda silenciosa do dado que o produto
     * existe para guardar.
     *
     * Por isso este caso não se contenta com "o DELETE passou": ele exige
     * que a dose continue lá depois.
     * ═════════════════════════════════════════════════════════════════════
     */
    const { cuidadorId, registroId } = await montarFamilia("remover-cuidador");

    await db.execute(sql`DELETE FROM caregivers WHERE id = ${cuidadorId}`);

    const depois = await db.execute<{ id: number; caregiver_id: number | null }>(sql`
      SELECT id, caregiver_id FROM dose_records WHERE id = ${registroId}
    `);

    assert.equal(depois.rows.length, 1, "a dose registrada NAO pode sumir com o cuidador");
    assert.equal(
      depois.rows[0]!.caregiver_id,
      null,
      "perde-se o nome, nunca a dose: o vinculo vira nulo em vez de apagar a linha",
    );
  });
});

describe("Apagar uma familia inteira", () => {
  it("funciona com paciente, remedio, tratamento e dose dentro", async () => {
    /**
     * É o caminho da exclusão de dados da LGPD (`routes/account.ts`).
     *
     * Antes da #213 isto só funcionava por sorte da ordem interna das
     * cascatas — e a ordem muda em qualquer restauração de backup.
     */
    const { familiaId } = await montarFamilia("apagar-familia");

    await db.execute(sql`DELETE FROM families WHERE id = ${familiaId}`);

    const sobrou = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM families WHERE id = ${familiaId}
    `);
    assert.equal(sobrou.rows[0]!.n, 0);
  });
});

describe("O guardrail: nenhuma chave estrangeira sem acao de exclusao", () => {
  it("toda chave estrangeira declara o que fazer quando o alvo some", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * ESTE É O CASO QUE IMPEDE O DEFEITO DE VOLTAR POR OUTRA PORTA.
     *
     * Uma chave estrangeira sem `ON DELETE` é `NO ACTION`: o banco recusa
     * apagar o alvo. Isso produz dois males, e os dois são silenciosos até
     * alguém tentar apagar algo:
     *
     *   - a operação vira 500 numa rota (foi o sintoma 1)
     *   - quando há OUTRO caminho de cascata até a mesma linha, o resultado
     *     passa a depender da ordem interna dos gatilhos — que muda numa
     *     restauração (foi o sintoma 2)
     *
     * `confdeltype` em `pg_constraint`: 'a' = no action, 'r' = restrict,
     * 'c' = cascade, 'n' = set null, 'd' = set default.
     *
     * Se um dia uma chave precisar mesmo recusar a exclusão, use `RESTRICT`
     * explícito — a diferença é dizer que foi escolha, e não esquecimento.
     * ═════════════════════════════════════════════════════════════════════
     */
    const sem = await db.execute<{ tabela: string; coluna: string; alvo: string }>(sql`
      SELECT c.conrelid::regclass::text AS tabela,
             a.attname::text            AS coluna,
             c.confrelid::regclass::text AS alvo
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND c.confdeltype = 'a'
        AND c.connamespace = 'public'::regnamespace
      ORDER BY 1, 2
    `);

    const lista = sem.rows.map((r) => `${r.tabela}.${r.coluna} -> ${r.alvo}`);
    assert.deepEqual(
      lista,
      [],
      "chave(s) estrangeira(s) sem ON DELETE — apagar o alvo vai falhar, ou vai " +
        `depender da ordem dos gatilhos:\n  ${lista.join("\n  ")}`,
    );
  });
});

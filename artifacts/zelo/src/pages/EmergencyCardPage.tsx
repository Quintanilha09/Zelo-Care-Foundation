/**
 * Ficha de emergência — Issue #176.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * UMA TELA PARA MOSTRAR A ALGUÉM, NÃO PARA NAVEGAR.
 *
 * O cuidador chega ao pronto-socorro às três da manhã com o idoso. Perguntam
 * alergias, condições, o que ele toma. Ele não sabe de cor — e se for o filho
 * que não mora junto, não tem como saber.
 *
 * Esta tela existe para ser virada para a enfermeira. Por isso: letra grande,
 * nada clicável no meio do conteúdo, e tudo numa rolagem só.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que ela NÃO faz ────────────────────────────────────────────────────
 *
 * Não interpreta nada. Não diz que um remédio bate com uma alergia, não
 * ordena por gravidade, não destaca o que "parece" mais sério. Mostra o que
 * alguém escreveu, do jeito que escreveu (invariante 4).
 *
 * E não tem vermelho. É tela de emergência, e a tentação de pintar tudo de
 * vermelho é grande — mas quem lê aqui já está numa emergência, e o que ele
 * precisa é ler rápido, não ser alarmado.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { AppHeader } from "@/components/app-header";
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { ArrowLeft, Phone } from "lucide-react";

interface Paciente {
  id: number;
  name: string;
  birthDate: string | null;
  allergies: string | null;
  conditions: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

interface Tratamento {
  id: number;
  medicationName: string;
  dose: string | null;
  status: string;
}

async function buscarPaciente(id: string): Promise<Paciente> {
  const res = await authFetch(`/api/patients/${id}`);
  if (!res.ok) throw new Error("Não foi possível carregar a ficha");
  return res.json();
}

async function buscarTratamentos(id: string): Promise<Tratamento[]> {
  const res = await authFetch(`/api/patients/${id}/treatments`);
  if (!res.ok) throw new Error("Não foi possível carregar os tratamentos");
  return res.json();
}

/** "12/03/1948 · 78 anos" — a idade é o que perguntam, a data é o que confere. */
function nascimentoPorExtenso(iso: string | null): string | null {
  if (!iso) return null;
  const [ano, mes, dia] = iso.split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - ano;
  const fezAniversario =
    hoje.getMonth() + 1 > mes || (hoje.getMonth() + 1 === mes && hoje.getDate() >= dia);
  if (!fezAniversario) idade -= 1;
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano} · ${idade} anos`;
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <div className="text-xl leading-snug">{children}</div>
    </div>
  );
}

export default function EmergencyCardPage() {
  const [, params] = useRoute("/pacientes/:id/emergencia");
  const id = params?.id ?? "";

  const { data: paciente, isLoading } = useQuery({
    queryKey: ["patient", id],
    queryFn: () => buscarPaciente(id),
    enabled: Boolean(id),
  });
  const { data: tratamentos } = useQuery({
    queryKey: ["treatments", id],
    queryFn: () => buscarTratamentos(id),
    enabled: Boolean(id),
  });

  const emUso = (tratamentos ?? []).filter((t) => t.status === "active");
  const nascimento = nascimentoPorExtenso(paciente?.birthDate ?? null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href={`/pacientes/${id}`} asChild>
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </a>
        </Link>

        {isLoading && (
          <AreaCarregando rotulo="Carregando a ficha de emergência">
            <div className="space-y-4">
              <Esqueleto className="h-12" />
              <Esqueleto className="h-24" />
              <Esqueleto className="h-24" />
            </div>
          </AreaCarregando>
        )}

        {paciente && (
          <>
            <div>
              <h2 className="text-3xl font-semibold leading-tight">{paciente.name}</h2>
              {nascimento && <p className="text-lg text-muted-foreground">{nascimento}</p>}
            </div>

            <Bloco titulo="Alergias">
              {paciente.allergies?.trim() ? (
                <p className="whitespace-pre-line">{paciente.allergies}</p>
              ) : (
                // "Nenhuma registrada" e não "Nenhuma": o app não sabe se a
                // pessoa não tem alergia ou se ninguém anotou, e afirmar a
                // primeira num pronto-socorro seria perigoso.
                <p className="text-muted-foreground">Nenhuma registrada no app.</p>
              )}
            </Bloco>

            <Bloco titulo="Condições de saúde">
              {paciente.conditions?.trim() ? (
                <p className="whitespace-pre-line">{paciente.conditions}</p>
              ) : (
                <p className="text-muted-foreground">Nenhuma registrada no app.</p>
              )}
            </Bloco>

            <Bloco titulo="Remédios em uso">
              {emUso.length > 0 ? (
                <ul className="space-y-1">
                  {emUso.map((t) => (
                    <li key={t.id}>
                      {t.medicationName}
                      {t.dose ? <span className="text-muted-foreground"> — {t.dose}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Nenhum tratamento ativo.</p>
              )}
            </Bloco>

            <Bloco titulo="Contato de emergência">
              {paciente.emergencyContactName ? (
                <a
                  href={`tel:${paciente.emergencyContactPhone ?? ""}`}
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <Phone className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden />
                  {paciente.emergencyContactName}
                  {paciente.emergencyContactPhone ? ` — ${paciente.emergencyContactPhone}` : ""}
                </a>
              ) : (
                <p className="text-muted-foreground">Nenhum cadastrado.</p>
              )}
            </Bloco>

            {/* O rodapé que mantém o produto fora do enquadramento de
                dispositivo médico, e que aqui é ainda mais necessário: esta
                tela vai ser lida por profissional de saúde. */}
            <p className="text-sm text-muted-foreground border-t pt-4">
              Informações anotadas pela família no ZELO. O app registra e mostra;
              não prescreve, não interpreta e não verifica interação entre
              medicamentos.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

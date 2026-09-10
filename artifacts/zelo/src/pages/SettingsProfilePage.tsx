/**
 * Ajustes — Seu perfil — ZELO (Issue #116).
 *
 * ── Por que a foto existe ─────────────────────────────────────────────────
 *
 * Pedido do fundador em 08/09/2026: *"quero que cada cuidador consiga
 * adicionar uma imagem ao perfil para que a família tenha noção da aparência
 * de quem está cuidando"*. Numa família que contrata alguém, saber o rosto de
 * quem entra na casa não é vaidade — é a coisa mais básica que existe.
 *
 * ── Onde cada campo vive, e por quê ───────────────────────────────────────
 *
 * A **foto** vive na pessoa (`users`): quem cuida da própria mãe E é
 * contratada de outra casa tem um rosto só. **Telefone** e **parentesco**
 * vivem no cuidador (`caregivers`), porque mudam de círculo para círculo —
 * a mesma pessoa é "filha" numa família e "contratada" noutra.
 *
 * ── A compressão é no aparelho, como em todo o resto ──────────────────────
 *
 * Mesmo `comprimirFoto` do Momentos. O servidor tem teto de 2 MB, mas ele é
 * a rede de segurança de quem pula o cliente — no caminho normal, uma foto de
 * celular chega bem abaixo disso.
 */
import { useState, useRef, useEffect } from "react";
import { authFetch, apiUrl } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { comprimirFoto } from "@/lib/comprimir-imagem";
import { RecortarFoto } from "@/components/recortar-foto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Camera, Check, Trash2 } from "lucide-react";
import { iniciais, PARENTESCOS } from "@/lib/perfil";

export default function SettingsProfilePage() {
  const { user, recarregarUsuario } = useAuth();

  const inputFoto = useRef<HTMLInputElement>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erroDaFoto, setErroDaFoto] = useState("");
  /** Issue #137 — a foto escolhida, esperando o enquadramento. */
  const [aRecortar, setARecortar] = useState<File | null>(null);

  const [telefone, setTelefone] = useState(user?.caregiver?.phone ?? "");
  const [parentesco, setParentesco] = useState<string>(user?.caregiver?.relationship ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(false);

  // O contexto pode chegar depois da primeira renderização (o `/account/me`
  // é assíncrono). Sem isto, os campos ficariam vazios para quem abriu a tela
  // direto pela URL.
  useEffect(() => {
    setTelefone(user?.caregiver?.phone ?? "");
    setParentesco(user?.caregiver?.relationship ?? "");
  }, [user?.caregiver?.phone, user?.caregiver?.relationship]);

  const fotoUrl = user?.caregiver?.fotoUrl;

  /**
   * Issue #137 — escolher o arquivo não envia mais nada.
   *
   * O caminho passou a ser: escolher → **recortar** → comprimir → enviar. O
   * recorte vem ANTES da compressão para o `LADO_MAXIMO` de 1600 px valer
   * sobre a imagem já quadrada, e não sobre um retângulo do qual a maior
   * parte vai ser jogada fora logo em seguida.
   */
  const escolherFoto = (lista: FileList | null) => {
    const arquivo = lista?.[0];
    if (!arquivo) return;
    setErroDaFoto("");
    setARecortar(arquivo);
    // Zerar o input já aqui: sem isto, escolher o MESMO arquivo depois de
    // cancelar o recorte não dispara `onChange`, e parece que o app ignorou.
    if (inputFoto.current) inputFoto.current.value = "";
  };

  const trocarFoto = async (arquivo: File) => {
    setEnviandoFoto(true);
    setErroDaFoto("");
    try {
      const comprimida = await comprimirFoto(arquivo);
      const form = new FormData();
      form.append("arquivo", comprimida.arquivo);

      const res = await authFetch("/api/account/avatar", { method: "POST", body: form });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? "Não conseguimos guardar a foto.");
      }
      // O cabeçalho, a lista de cuidadores e esta tela mostram a mesma foto —
      // recarregar o usuário é o que faz as três acompanharem sem F5.
      await recarregarUsuario();
      // Só fecha o recorte quando a foto ENTROU. Fechar antes deixaria a
      // pessoa olhando a foto antiga sem saber se deu certo.
      setARecortar(null);
    } catch (e) {
      setErroDaFoto(e instanceof Error ? e.message : "Não conseguimos guardar a foto.");
      setARecortar(null);
    } finally {
      setEnviandoFoto(false);
    }
  };

  const removerFoto = async () => {
    setEnviandoFoto(true);
    setErroDaFoto("");
    try {
      const res = await authFetch("/api/account/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("Não conseguimos remover a foto.");
      await recarregarUsuario();
    } catch (e) {
      setErroDaFoto(e instanceof Error ? e.message : "Não conseguimos remover a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  };

  const salvarContato = async () => {
    setSalvando(true);
    setErro("");
    setSalvo(false);
    try {
      const res = await authFetch("/api/account/me", {
        method: "PATCH",
        body: JSON.stringify({
          phone: telefone.trim(),
          // String vazia na tela significa "não quero dizer" — no servidor
          // isso é `null`, não o texto vazio.
          relationship: parentesco === "" ? null : parentesco,
        }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? "Não conseguimos salvar.");
      }
      await recarregarUsuario();
      setSalvo(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não conseguimos salvar.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Seu perfil</h2>
        <p className="text-muted-foreground text-[17px]">
          É o que a sua família vê sobre você.
        </p>
      </div>

      {/* ── Foto ───────────────────────────────────────────────────────── */}
      <section className="p-4 rounded-xl border bg-card shadow-sm space-y-4">
        <div>
          <h3 className="font-medium">Sua foto</h3>
          <p className="text-sm text-muted-foreground">
            Ajuda a família a reconhecer quem está cuidando. Só quem cuida junto
            com você consegue ver.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Avatar className="h-20 w-20 border">
            {fotoUrl && <AvatarImage src={apiUrl(fotoUrl)} alt="" />}
            <AvatarFallback className="bg-muted text-xl font-medium text-muted-foreground">
              {iniciais(user?.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputFoto}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => escolherFoto(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={enviandoFoto}
              onClick={() => inputFoto.current?.click()}
            >
              <Camera className="w-4 h-4" aria-hidden />
              {enviandoFoto ? "Enviando…" : fotoUrl ? "Trocar a foto" : "Escolher uma foto"}
            </Button>
            {fotoUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-muted-foreground"
                disabled={enviandoFoto}
                onClick={() => void removerFoto()}
              >
                <Trash2 className="w-4 h-4" aria-hidden /> Remover
              </Button>
            )}
          </div>
        </div>

        {erroDaFoto && (
          <Alert variant="destructive">
            <AlertDescription>{erroDaFoto}</AlertDescription>
          </Alert>
        )}

        {/* Issue #137 — entre escolher e enviar. Fica dentro desta seção
            porque é dela que a foto vem, e porque assim o erro de recorte
            aparece perto do avatar que ele afeta. */}
        <RecortarFoto
          arquivo={aRecortar}
          enviando={enviandoFoto}
          onCancelar={() => setARecortar(null)}
          onPronto={(recortada) => void trocarFoto(recortada)}
        />
      </section>

      {/* ── Contato e parentesco ───────────────────────────────────────── */}
      <section className="p-4 rounded-xl border bg-card shadow-sm space-y-4">
        <div>
          <h3 className="font-medium">Como falar com você</h3>
          <p className="text-sm text-muted-foreground">
            Telefone e parentesco ficam visíveis para os outros cuidadores desta
            família. Os dois são opcionais.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="perfil-telefone">Telefone</Label>
          <Input
            id="perfil-telefone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(21) 99999-0000"
            value={telefone}
            maxLength={20}
            onChange={(e) => {
              setTelefone(e.target.value);
              setSalvo(false);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Deixe em branco para não mostrar nenhum.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="perfil-parentesco">Você é…</Label>
          <Select
            value={parentesco}
            onValueChange={(v) => {
              setParentesco(v);
              setSalvo(false);
            }}
          >
            <SelectTrigger id="perfil-parentesco" className="max-w-xs">
              <SelectValue placeholder="Escolha, se quiser" />
            </SelectTrigger>
            <SelectContent>
              {PARENTESCOS.map((p) => (
                <SelectItem key={p.valor} value={p.valor}>
                  {p.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Dito por extenso: é rótulo humano, não permissão. Sem isto, alguém
              lê "contratado" e supõe que o app limita o que a pessoa faz. */}
          <p className="text-xs text-muted-foreground">
            É só como a família te reconhece. Não muda nada do que você pode
            fazer no app — isso é o papel, em Cuidadores.
          </p>
        </div>

        {erro && (
          <Alert variant="destructive">
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Button size="sm" disabled={salvando} onClick={() => void salvarContato()}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
          {salvo && (
            <span className="text-sm text-zelo-green-fg inline-flex items-center gap-1.5">
              <Check className="w-4 h-4" aria-hidden /> Salvo
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

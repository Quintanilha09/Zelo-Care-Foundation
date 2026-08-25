import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth-client";

/**
 * Campo de local com busca de endereço real e mapa.
 *
 * ── Degrada com elegância ─────────────────────────────────────────────────
 *
 * Sem `GOOGLE_MAPS_API_KEY` configurada, vira um campo de texto comum e o app
 * segue funcionando. Mesmo padrão de `/auth/google/status` e
 * `/auth/email/status`: capacidade que pode faltar é declarada, não suposta.
 *
 * ── Por que PlaceAutocompleteElement, e não Autocomplete ──────────────────
 *
 * `google.maps.places.Autocomplete` é a API legada. Chaves e projetos criados
 * depois de março de 2025 não têm acesso a ela — e a chave deste projeto é
 * nova. `PlaceAutocompleteElement` é a atual, com evento `gmp-select`.
 *
 * ── O mapa ────────────────────────────────────────────────────────────────
 *
 * Aparece só depois de escolher um endereço, usando a coordenada que já vem na
 * própria seleção. Não faz chamada extra de geocodificação, então não consome
 * cota além do que a busca já consumiu.
 */

interface ConfigMaps {
  configured: boolean;
  apiKey: string | null;
}

/** Promessa única de carregamento — evita injetar o script duas vezes. */
let carregando: Promise<void> | null = null;

function carregarMaps(apiKey: string): Promise<void> {
  if (carregando) return carregando;

  carregando = new Promise<void>((resolve, reject) => {
    // Já carregado por outra montagem do componente.
    if (typeof window !== "undefined" && (window as { google?: unknown }).google) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly&language=pt-BR&region=BR`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o Google Maps"));
    document.head.appendChild(script);
  });

  return carregando;
}

export function SeletorLocal({
  value,
  onChange,
  id,
  placeholder = "Endereço ou clínica",
}: {
  value: string;
  onChange: (local: string) => void;
  id?: string;
  placeholder?: string;
}) {
  const [config, setConfig] = useState<ConfigMaps | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [coordenada, setCoordenada] = useState<{ lat: number; lng: number } | null>(null);

  const caixaBusca = useRef<HTMLDivElement | null>(null);
  const caixaMapa = useRef<HTMLDivElement | null>(null);

  // 1. A capacidade existe?
  useEffect(() => {
    let ativo = true;
    void authFetch("/api/config/maps")
      .then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/config/maps respondeu ${r.status}`);
        return (await r.json()) as ConfigMaps;
      })
      .then((d) => {
        if (!ativo) return;
        setConfig(d);
        if (!d.configured) {
          // Cair para texto livre é o comportamento certo para quem usa o app,
          // mas quem está configurando precisa saber POR QUE caiu. Sem isto,
          // 'sem chave' e 'quebrado' ficam indistinguíveis — o mesmo defeito
          // que este projeto já corrigiu em três telas.
          console.info(
            "[ZELO] Busca de endereço desativada: GOOGLE_MAPS_API_KEY não está definida no servidor. " +
              "Crie o Secret e reinicie o workflow da API."
          );
        }
      })
      .catch((erro: unknown) => {
        if (!ativo) return;
        setConfig({ configured: false, apiKey: null });
        console.warn("[ZELO] Não consegui perguntar ao servidor se o Maps está configurado:", erro);
      });
    return () => { ativo = false; };
  }, []);

  // 2. Monta o campo de busca do Google
  useEffect(() => {
    if (!config?.configured || !config.apiKey || !caixaBusca.current) return;

    let ativo = true;
    let elemento: HTMLElement | null = null;

    void carregarMaps(config.apiKey)
      .then(async () => {
        if (!ativo || !caixaBusca.current) return;

        const g = (window as unknown as { google: { maps: { importLibrary: (n: string) => Promise<unknown> } } }).google;
        const places = (await g.maps.importLibrary("places")) as {
          PlaceAutocompleteElement: new () => HTMLElement;
        };

        elemento = new places.PlaceAutocompleteElement();
        // O elemento é um web component: não aceita className do React.
        elemento.setAttribute("style", "width:100%");
        caixaBusca.current.replaceChildren(elemento);

        elemento.addEventListener("gmp-select", (async (evento: Event) => {
          const { placePrediction } = evento as unknown as {
            placePrediction: { toPlace: () => { fetchFields: (o: { fields: string[] }) => Promise<void>; formattedAddress?: string; displayName?: string; location?: { lat: () => number; lng: () => number } } };
          };
          const lugar = placePrediction.toPlace();
          await lugar.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });

          // displayName primeiro: "Hospital Albert Einstein — Av. …" diz mais a
          // quem vai até lá do que só a rua.
          const nome = lugar.displayName;
          const endereco = lugar.formattedAddress;
          onChange(nome && endereco ? `${nome} — ${endereco}` : endereco ?? nome ?? "");

          if (lugar.location) {
            setCoordenada({ lat: lugar.location.lat(), lng: lugar.location.lng() });
          }
        }) as EventListener);
      })
      .catch((erro: unknown) => {
        if (!ativo) return;
        setFalhou(true);
        // Chave inválida, restrição de referenciador errada ou API não
        // ativada no Google Cloud caem todas aqui. O campo continua
        // utilizável como texto, mas o motivo fica registrado.
        console.error("[ZELO] O Google Maps não carregou. Verifique a chave, a restrição por referenciador e se Places API (New) e Maps JavaScript API estão ativadas:", erro);
      });

    return () => {
      ativo = false;
      elemento?.remove();
    };
  }, [config, onChange]);

  // 3. Desenha o mapa quando há coordenada
  useEffect(() => {
    if (!coordenada || !caixaMapa.current) return;
    const g = (window as unknown as { google?: { maps: { Map: new (e: HTMLElement, o: unknown) => unknown; Marker: new (o: unknown) => unknown } } }).google;
    if (!g) return;

    const mapa = new g.maps.Map(caixaMapa.current, {
      center: coordenada,
      zoom: 16,
      disableDefaultUI: true,
      zoomControl: true,
    });
    new g.maps.Marker({ position: coordenada, map: mapa });
  }, [coordenada]);

  // Enquanto não sabemos, ou quando não há chave: campo de texto comum.
  if (!config?.configured || falhou) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* O web component do Google entra aqui. Enquanto ele não monta, o campo
          de texto abaixo garante que a pessoa nunca fica sem onde escrever. */}
      <div ref={caixaBusca} />

      {value && (
        <p className="text-sm text-muted-foreground break-words">{value}</p>
      )}

      {coordenada && (
        <div
          ref={caixaMapa}
          className="h-40 w-full rounded-lg border overflow-hidden"
          aria-label="Mapa do local escolhido"
        />
      )}
    </div>
  );
}

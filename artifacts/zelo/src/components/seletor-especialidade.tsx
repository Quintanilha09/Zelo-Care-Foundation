import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ESPECIALIDADES, normalizar } from "@/lib/especialidades";
import { cn } from "@/lib/utils";

/**
 * Escolha de especialidade — lista fechada com busca.
 *
 * Antes era um `<Input>` de texto livre. Pedido do fundador em 24/08/2026:
 * "não posso poder inserir qualquer coisa". Digitar à mão produzia
 * "cardiologia", "Cardio" e "CARDIOLOGIA" na mesma base, o que impede agrupar
 * ou filtrar depois.
 *
 * A busca ignora acento e maiúscula e casa em qualquer posição: "dermato" acha
 * "Dermatologia"; "cardio" acha "Cardiologia" e "Cirurgia Cardiovascular".
 *
 * A lista tem "Outra" no fim de propósito — lista fechada sem escape vira
 * armadilha no dia em que faltar uma opção.
 */
export function SeletorEspecialidade({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (especialidade: string) => void;
  id?: string;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground"
          )}
        >
          {value || "Escolha ou digite para buscar"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command
          // O filtro padrão do cmdk não ignora acento: "nutricao" não acharia
          // "Nutrição". Este usa a mesma normalização do resto do módulo.
          filter={(valor, busca) => (normalizar(valor).includes(normalizar(busca)) ? 1 : 0)}
        >
          <CommandInput placeholder="Buscar especialidade…" />
          <CommandList>
            <CommandEmpty>
              Nenhuma especialidade com esse nome. Tente outro termo, ou escolha "Outra".
            </CommandEmpty>
            <CommandGroup>
              {ESPECIALIDADES.map((especialidade) => (
                <CommandItem
                  key={especialidade}
                  value={especialidade}
                  onSelect={() => {
                    onChange(especialidade);
                    setAberto(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === especialidade ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {especialidade}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

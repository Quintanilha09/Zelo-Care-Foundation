<!--
  Todo PR precisa de uma Issue. Sem Issue, não há PR — é a regra do projeto.
  Ver planning/decisoes/FLUXO-GITHUB.md
-->

## Issue

Closes #

<!--
  "Closes #123" fecha a Issue sozinha quando o PR entra no main.
  Se o PR só avança a Issue sem terminá-la, escreva "Refs #123".
-->

## O que muda, e por quê

<!-- Duas ou três frases. O QUE mudou e o MOTIVO — o "como" está no diff. -->

## Verificação

Marque só o que você **rodou de verdade** nesta mudança. Caixa marcada sem
execução é pior que caixa vazia: vira mentira registrada.

- [ ] `pnpm run typecheck` — limpo
- [ ] `pnpm --filter @workspace/api-server run test:all` — passando
- [ ] `pnpm --filter @workspace/api-server run lint:clock` — limpo
- [ ] `pnpm --filter @workspace/api-server run build` — limpo

**Números medidos** (testes, tempo, tamanho). Nunca escreva um número que
você não mediu — é a regra do GSD que vale em todo o projeto:

```
```

## O que NÃO foi verificado

<!--
  Obrigatório. Se está tudo verificado, escreva "nada".
  Exemplos reais deste projeto: interface não aberta em navegador (o vite não
  sobe no Windows), compressão não medida com foto real, banco de produção
  não tocado.
-->

## Banco e Secrets

- [ ] Esta mudança **não** mexe no schema
- [ ] Mexe no schema — exige `pnpm --filter @workspace/db run push` no Replit
- [ ] Exige Secret novo: <!-- nome da variável, NUNCA o valor -->

## Invariantes

Confirmo que esta mudança não viola nenhum dos 7 invariantes do produto
(`CLAUDE.md`), em especial:

- [ ] `familyId` vem do JWT, nunca da URL ou do corpo
- [ ] Recurso de outra família responde **404**, nunca 403
- [ ] Nenhum log com nome de medicamento, condição ou identificador de paciente
- [ ] Nenhum vermelho em contexto de dose

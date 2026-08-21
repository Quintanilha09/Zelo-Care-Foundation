# ZELO — Contexto de Continuidade

> Atualizado por Codex em 2026-08-21 (America/Sao_Paulo).
>
> Este arquivo registra fatos verificados, decisões e próximos passos para a próxima sessão de trabalho. Não contém credenciais, dados de pacientes ou outros dados sensíveis.

## Estado atual

- Repositório: `Quintanilha09/Zelo-Care-Foundation`
- Branch padrão remoto: `main`
- PR de CI em rascunho: #1 (`chore/github-actions-ci`)
- PRs e issues abertas antes desta sessão: nenhuma.
- GitHub Actions ainda está sendo validado nesta sessão; não tratar o CI como aprovado antes de consultar a execução mais recente.

## Recuperação do Git no Replit

O workspace do Replit estava preso em um rebase interativo sobre o commit `2bcb3b9`.

### O que foi preservado e resolvido

- Conflito único: `artifacts/api-server/package.json`.
- A divergência era exclusivamente no script `test:all`:
  - a base incluía `environment-hardening.test.ts`;
  - o commit reaplicado incluía `patient-role-matrix.test.ts`.
- A resolução preservou os dois testes.
- Cópias de segurança foram gravadas temporariamente em `/tmp/zelo-rebase-backup` no Replit:
  - versão com marcadores de conflito;
  - lado atual do rebase;
  - lado reaplicado do rebase.
- O rebase foi concluído com o commit local `270b9de` (`Incrementação de documentação 'zelo-foundation-state.md'`).
- Após a conclusão: branch `main` local limpa e um commit à frente de `origin/main`.

### Evidência de verificação

A suíte completa da API foi executada no Replit com:

```bash
ADMIN_PANEL_SECRET='valor-efêmero-de-teste' pnpm --filter @workspace/api-server test:all
```

Resultado: **395 testes, 121 suítes, 395 aprovados, 0 falhas**.

A primeira execução sem `ADMIN_PANEL_SECRET` teve 382/383 testes aprovados e falhou somente em `src/tests/admin.test.ts`. A causa é de configuração do teste: o arquivo gera um token administrativo ao carregar o módulo e exige a variável. Não foi usada nenhuma credencial real.

### Próxima ação no Replit

Publicar o commit recuperado de forma normal, sem force push:

```bash
git push origin main
```

Confirmar depois com `git status`. Não usar `git push --force`, `git reset --hard` ou `git rebase --abort`.

## CI no GitHub Actions

A PR de rascunho #1 adiciona `.github/workflows/validate.yml`.

### Escopo

Em pull requests e em atualizações de `main`, o workflow:

1. instala dependências com `pnpm install --frozen-lockfile`;
2. inicia PostgreSQL 16 efêmero;
3. aplica o schema do banco e o trigger de imutabilidade do audit log;
4. executa typecheck;
5. executa o lint de uso do relógio;
6. executa a suíte de integração da API;
7. executa o build do monorepo.

### Decisões de segurança

- O workflow tem apenas `contents: read`.
- Banco, `ADMIN_PANEL_SECRET` e `SESSION_SECRET` do job são valores sintéticos e efêmeros.
- Nenhum segredo de produção/Replit é usado ou enviado ao GitHub.
- O job é cancelável por concorrência e tem timeout de 20 minutos.

## Contexto do produto

ZELO é uma PWA de cuidado compartilhado para famílias com idosos. Invariantes relevantes:

- registros de dose são persistidos e protegidos contra duplicidade;
- todo acesso a paciente deve ser isolado por família no backend;
- logs não podem conter dados clínicos ou identificadores de pacientes;
- o produto registra cuidado, mas não prescreve, calcula dose ou interpreta dados clínicos.

Fontes de verdade adicionais:

- `FOUNDATION.md`
- `PLATFORM_DECISIONS.md`
- `.agents/memory/zelo-foundation-state.md`
- `replit.md`

## Próximos passos para a próxima sessão

1. Conferir o resultado mais recente da execução do CI da PR #1 e depurar somente falhas comprovadas.
2. Após o push seguro do Replit, garantir que o branch local esteja alinhado com `origin/main`.
3. Revisar a PR #1; só tornar o check obrigatório/proteger `main` depois de uma execução verde e revisão.
4. Considerar tornar `admin.test.ts` autossuficiente em ambiente de teste, para que testes locais não dependam de uma variável externa. Isso deve ser uma alteração separada e testada.

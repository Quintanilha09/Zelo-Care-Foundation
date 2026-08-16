#!/usr/bin/env bash
# check-clock-usage.sh — verifica que nenhum arquivo de lógica de domínio
# lê o relógio do sistema diretamente.
#
# REGRA: Todo código de domínio deve usar Clock.now() ou Clock.todayInTimezone()
# em vez de chamar new Date() SEM argumentos ou Date.now().
#
# NÃO são violações:
#   new Date(someString)      — converte string de entrada em Date
#   new Date(Clock.now())     — copia um Date já produzido pelo Clock
#   new Date(`${...}T00:00`)  — constrói a partir de string conhecida
#
# SÃO violações (lê o relógio do sistema sem usar o Clock):
#   new Date()                — construtor vazio = hora atual do sistema
#   Date.now()                — timestamp atual do sistema
#
# EXCEÇÕES (não verificadas):
#   clock.ts          — a própria abstração de relógio
#   *.test.ts         — testes podem usar Date diretamente para comparar
#   seed.ts           — script de dados, não lógica de domínio
#   scripts/          — este próprio script
#
# Sair com código 1 se alguma violação for encontrada.

set -euo pipefail

DOMAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/src"

FOUND=0

# ── new Date() — construtor vazio (lê o relógio do sistema) ──────────────
# Regex: new Date seguido de ( e ) imediatamente, opcionalmente com espaços
MATCHES_NEWDATE=$(grep -rn \
  --include="*.ts" \
  --exclude="*clock.ts" \
  --exclude="*.test.ts" \
  --exclude="*seed.ts" \
  -E 'new Date\(\s*\)' \
  "$DOMAIN_DIR" 2>/dev/null || true)

if [ -n "$MATCHES_NEWDATE" ]; then
  echo ""
  echo "❌  VIOLAÇÃO DE RELÓGIO: new Date() sem argumentos lê o relógio do sistema"
  echo "$MATCHES_NEWDATE" | while IFS= read -r line; do
    echo "    $line"
  done
  FOUND=1
fi

# ── Date.now() — timestamp atual do sistema ───────────────────────────────
MATCHES_DATENOW=$(grep -rn \
  --include="*.ts" \
  --exclude="*clock.ts" \
  --exclude="*.test.ts" \
  --exclude="*seed.ts" \
  -E 'Date\.now\(\)' \
  "$DOMAIN_DIR" 2>/dev/null || true)

if [ -n "$MATCHES_DATENOW" ]; then
  echo ""
  echo "❌  VIOLAÇÃO DE RELÓGIO: Date.now() lê o relógio do sistema"
  echo "$MATCHES_DATENOW" | while IFS= read -r line; do
    echo "    $line"
  done
  FOUND=1
fi

# ── Date.UTC() — também lê argumentos, mas pode indicar intenção errada ──
# Só flagra se for chamado sem argumentos (raro, mas possível)
MATCHES_DATEUTC=$(grep -rn \
  --include="*.ts" \
  --exclude="*clock.ts" \
  --exclude="*.test.ts" \
  --exclude="*seed.ts" \
  -E 'Date\.UTC\(\s*\)' \
  "$DOMAIN_DIR" 2>/dev/null || true)

if [ -n "$MATCHES_DATEUTC" ]; then
  echo ""
  echo "❌  VIOLAÇÃO DE RELÓGIO: Date.UTC() sem argumentos"
  echo "$MATCHES_DATEUTC" | while IFS= read -r line; do
    echo "    $line"
  done
  FOUND=1
fi

if [ "$FOUND" -eq 0 ]; then
  echo "✅  check-clock-usage: nenhuma leitura direta do relógio do sistema encontrada."
  echo "    (new Date(string) e new Date(Clock.now()) são permitidos — não leem o relógio)"
  exit 0
else
  echo ""
  echo "💡  Use Clock.now() em vez de new Date() ou Date.now()."
  echo "    Arquivo: artifacts/api-server/src/lib/clock.ts"
  echo "    new Date(algumValor) e new Date(Clock.now()) NÃO são violações."
  exit 1
fi

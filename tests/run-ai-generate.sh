#!/usr/bin/env bash
# Lance le test de génération IA sur des serveurs NEUFS (3 scénarios) — usage : bash tests/run-ai-generate.sh
# Nécessite bun et node. Les appels partent vers un faux fournisseur local (jamais vers Internet).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'pkill -f "[b]un run server.ts" 2>/dev/null; rm -rf "$TMP"' EXIT
mkdir -p "$TMP/app" && cp -r "$ROOT/server.ts" "$ROOT/src" "$ROOT/package.json" "$ROOT/tsconfig.json" "$TMP/app/" && ln -s "$ROOT/node_modules" "$TMP/app/node_modules"
run() { # scénario, variables d'environnement...
  local scen="$1"; shift
  pkill -f "[b]un run server.ts" 2>/dev/null; sleep 1; rm -rf "$TMP/app/data"
  (cd "$TMP/app" && env SUPER_ADMIN_PASSWORD=test-admin PORT=3100 NODE_ENV=production AI_MAX_GENERATIONS_PER_HOUR=3 "$@" nohup bun run server.ts > "$TMP/server-$scen.log" 2>&1 &)
  sleep 4
  echo "== scénario : $scen"
  (cd "$ROOT" && AI_TEST_SCENARIO="$scen" node tests/ai-generate.test.mjs http://localhost:3100 2>&1 | grep -v "^OK" | tail -15)
}
run gemini    AI_PROVIDER=gemini GEMINI_API_KEY=test-key GEMINI_BASE_URL=http://127.0.0.1:3199 ANTHROPIC_API_KEY=test-key-claude ANTHROPIC_BASE_URL=http://127.0.0.1:3199
run anthropic AI_PROVIDER=anthropic ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:3199
run nokey     AI_PROVIDER=gemini GEMINI_API_KEY=MY_GEMINI_API_KEY

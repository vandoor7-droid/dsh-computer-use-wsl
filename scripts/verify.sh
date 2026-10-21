#!/usr/bin/env bash
# Run every layer and print one PASS/FAIL table.
#
# L2/L2b/L4 need a Linux X stack (Xvfb, xdotool, imagemagick, xclip) and a
# display that is NOT the human's (:98 by default). Run it inside the
# distribution, not on Windows.
set -u

cd "$(dirname "$0")/.." || exit 1
NODE="${NODE:-node}"
FAILED=0
ROWS=()

run() {
  local name="$1"; shift
  local start end
  start=$(date +%s)
  if "$@" >/tmp/wslcu-verify.log 2>&1; then
    end=$(date +%s)
    ROWS+=("PASS|${name}|$((end - start))s")
  else
    end=$(date +%s)
    ROWS+=("FAIL|${name}|$((end - start))s")
    FAILED=$((FAILED + 1))
    echo "----- ${name} output (tail) -----"
    tail -n 25 /tmp/wslcu-verify.log
    echo "---------------------------------"
  fi
}

run "L0 unit" "$NODE" --test test/unit.test.mjs
run "L1 mcp handshake" "$NODE" test/mcp-handshake.mjs
run "L2 backend e2e" "$NODE" test/e2e.mjs
run "L2b viewer state" "$NODE" test/viewer-state.mjs
run "L4 host mode stub" "$NODE" test/transport-stub.mjs
run "L5 bundle patch" "$NODE" test/bundle-patch.mjs
run "L6 client module" "$NODE" test/client-module.mjs

echo
printf '%-6s %-22s %s\n' "RESULT" "LAYER" "TIME"
for row in "${ROWS[@]}"; do
  IFS='|' read -r status name seconds <<<"$row"
  printf '%-6s %-22s %s\n' "$status" "$name" "$seconds"
done

if [ "$FAILED" -gt 0 ]; then
  echo
  echo "$FAILED layer(s) failed"
  exit 1
fi
echo
echo "all layers passed"

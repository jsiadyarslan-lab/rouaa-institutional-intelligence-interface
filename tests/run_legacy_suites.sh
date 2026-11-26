#!/usr/bin/env bash
# tests/run_legacy_suites.sh — run the three pre-existing acceptance suites against THIS checkout.
#
# The legacy suites (test_v3.py, test_v9.py, test_v10.py) live outside the repo and were
# written against an older sibling copy: they hard-code
#     /home/z/my-project/scripts/deploy-v2
# as the directory they start their auxiliary servers from (v9 on :5097, v10 on :5096) and
# read the console HTML from (v3). Pointing only BASE at another server therefore leaves
# most of their assertions aimed at that old copy — and running them untouched appends to
# the review/usage logs of that copy.
#
# What this harness does instead:
#   1. stages a throwaway server home under .test-runs/ holding byte copies (cmp-verified)
#      of this checkout's server.js, package.json, rouaa-console-dark.html and the font the
#      suites fetch;
#   2. starts the legacy mock core (127.0.0.1:5099) and THIS server.js (127.0.0.1:5098)
#      from that home, so reviews.jsonl / usage.jsonl land there, never in the checkout;
#   3. runs temp copies of the suites in which ONLY the hard-coded path above is replaced
#      by the staged home (the diff is printed; the originals are never modified).
#
# Everything binds to 127.0.0.1. No external network calls.
#
# Usage:  tests/run_legacy_suites.sh [suite ...]      default: all three
# Env:    ROUAA_LEGACY_DIR  dir holding the suites, mock_core.js and .audit-work/snap.json
#                          (default: three levels above the checkout, i.e. <repo>/../../..)
set -euo pipefail

CHECKOUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY="${ROUAA_LEGACY_DIR:-$(cd "$CHECKOUT/../../.." && pwd)}"
RUNS="$CHECKOUT/.test-runs/legacy"
HOME_DIR="$RUNS/home"
LEGACY_PATH='/home/z/my-project/scripts/deploy-v2'
SUITES=("$@")
[ ${#SUITES[@]} -eq 0 ] && SUITES=(test_v3.py test_v9.py test_v10.py)

command -v node >/dev/null || { echo "node is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
for f in mock_core.js .audit-work/snap.json "${SUITES[@]}"; do
  [ -f "$LEGACY/$f" ] || { echo "missing $LEGACY/$f (set ROUAA_LEGACY_DIR)" >&2; exit 2; }
done
for f in server.js package.json rouaa-console-dark.html fonts/NotoSansArabic.ttf; do
  [ -f "$CHECKOUT/$f" ] || { echo "missing $CHECKOUT/$f" >&2; exit 2; }
done

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1; }
for p in 5096 5097 5098 5099; do
  port_busy "$p" && { echo "port $p is already in use — refusing to start (nothing was killed)" >&2; exit 3; }
done

ready() { # url attempts [bearer]
  local i=0
  until node -e 'fetch(process.argv[1],process.argv[2]?{headers:{Authorization:"Bearer "+process.argv[2]}}:{}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      "$1" "${3:-}" >/dev/null 2>&1; do
    i=$((i+1)); [ "$i" -ge "$2" ] && return 1; sleep 1
  done
}

PIDS=()
cleanup() {
  trap - EXIT
  for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

rm -rf "$RUNS"; mkdir -p "$HOME_DIR/fonts" "$RUNS/patched"
for f in server.js package.json rouaa-console-dark.html; do cp "$CHECKOUT/$f" "$HOME_DIR/$f"; done
cp "$CHECKOUT/fonts/NotoSansArabic.ttf" "$HOME_DIR/fonts/NotoSansArabic.ttf"
for f in server.js package.json rouaa-console-dark.html fonts/NotoSansArabic.ttf; do
  cmp -s "$CHECKOUT/$f" "$HOME_DIR/$f" || { echo "staged copy differs: $f" >&2; exit 4; }
done
echo "staged home: $HOME_DIR (byte copies of this checkout, cmp-verified)"

# `exec` so that $! is the node process itself (a plain subshell would survive `kill`
# and leave the server running).
node "$LEGACY/mock_core.js" >"$RUNS/mock.log" 2>&1 & PIDS+=($!)
( cd "$HOME_DIR" && exec env CORE_URL=http://127.0.0.1:5099 CORE_TOKEN=mock PORT=5098 \
    REVIEWS_DATA_DIR="$HOME_DIR" node server.js >"$RUNS/server.log" 2>&1 ) & PIDS+=($!)
ready http://127.0.0.1:5099/v1/ops/registry 30 mock || { echo "mock core did not come up"; cat "$RUNS/mock.log"; exit 5; }
ready http://127.0.0.1:5098/analyst/api/status 60 || { echo "server under test did not come up"; cat "$RUNS/server.log"; exit 5; }
# build the index once so the suites measure their own behaviour, not a cold start
node -e 'fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
  http://127.0.0.1:5098/analyst/api/summary || { echo "index build failed"; exit 5; }

failed=0
declare -a NAMES=() TALLIES=()
for s in "${SUITES[@]}"; do
  sed "s#${LEGACY_PATH}#${HOME_DIR}#g" "$LEGACY/$s" >"$RUNS/patched/$s"
  # proof that the path is the ONLY difference: put the path back and compare bytes
  sed "s#${HOME_DIR}#${LEGACY_PATH}#g" "$RUNS/patched/$s" | cmp -s - "$LEGACY/$s" \
    || { echo "$s: patched copy differs by more than the path" >&2; exit 6; }
  echo "== $s: $(diff "$LEGACY/$s" "$RUNS/patched/$s" | grep -c '^>') line(s) redirected"
  set +e
  python3 "$RUNS/patched/$s" http://127.0.0.1:5098 >"$RUNS/$s.log" 2>&1
  code=$?
  set -e
  [ "$code" -eq 0 ] || failed=1
  NAMES+=("$s")
  TALLIES+=("$(grep -o 'النتيجة: [0-9]*/[0-9]*' "$RUNS/$s.log" | tail -1 | sed 's/النتيجة: //')")
  grep -A3 '^فشل:' "$RUNS/$s.log" | sed 's/^/     /' || true
done

echo
echo "SUMMARY (server.js + rouaa-console-dark.html of this checkout; mock core = legacy snap.json)"
for i in "${!NAMES[@]}"; do printf '  %-12s %s passed\n' "${NAMES[$i]}" "${TALLIES[$i]:-no tally line}"; done
echo "  logs: $RUNS"
exit "$failed"

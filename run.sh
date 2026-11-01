#!/usr/bin/env bash
# Thin wrapper around the pipeline stages. No third-party dependencies.
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${PROFILE:-full}"
SEED="${SEED:-20261022}"
PORT="${PORT:-3000}"

usage() {
  cat <<'EOF'
usage: ./run.sh <command>

  all         generate -> validate -> evaluate -> reproducibility -> tests
  generate    build the dataset into out/ (PROFILE=full|starter, SEED=20261022)
  validate    run the validation suite over out/
  evaluate    evaluate engine decisions/detectors against ground truth
  repro       regenerate twice and compare checksums
  test        run the unit tests
  web         install and build the React application into web/dist
  serve       start the API + built web app on PORT (default 3000)

examples:
  ./run.sh all
  PROFILE=starter ./run.sh generate
  ./run.sh serve
EOF
}

case "${1:-help}" in
  all)
    rm -rf out
    python3 src/generate.py --profile "$PROFILE" --seed "$SEED" --out out --with-seed-sql
    python3 src/validate.py --out out
    python3 src/evaluate.py --out out
    python3 src/repro_check.py --profile starter --seed "$SEED" --out out
    python3 -m unittest discover -s tests -v
    ;;
  generate)  python3 src/generate.py --profile "$PROFILE" --seed "$SEED" --out out --with-seed-sql ;;
  validate)  python3 src/validate.py --out out ;;
  evaluate)  python3 src/evaluate.py --out out ;;
  repro)     python3 src/repro_check.py --profile "${PROFILE:-starter}" --seed "$SEED" --out out ;;
  test)      python3 -m unittest discover -s tests -v ;;
  web)       (cd web && npm install --no-audit --no-fund && npm run build) ;;
  serve)
    if [ ! -f web/dist/index.html ]; then
      echo "web build missing; building it first…"
      (cd web && npm install --no-audit --no-fund && npm run build)
    fi
    python3 src/app.py --out out --web web/dist --port "$PORT"
    ;;
  *) usage; exit 1 ;;
esac

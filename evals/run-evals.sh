#!/bin/bash
# Simple eval runner for octask
# Usage: ./evals/run-evals.sh [eval-file.json]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

EVAL_FILES=("$@")
if [ ${#EVAL_FILES[@]} -eq 0 ]; then
  EVAL_FILES=("$SCRIPT_DIR/evals.json" "$SCRIPT_DIR/creating-task-evals.json")
fi

PASS=0
FAIL=0
ERRORS=()

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

check_assertion() {
  local type="$1" name="$2" output="$3" tmpdir="$4"
  shift 4

  case "$type" in
    output_contains)
      local value="$1"
      if echo "$output" | grep -qi "$value"; then return 0; else return 1; fi
      ;;
    output_not_contains)
      local value="$1"
      if echo "$output" | grep -qi "$value"; then return 1; else return 0; fi
      ;;
    output_contains_any)
      local values="$1"
      for v in $(echo "$values" | jq -r '.[]'); do
        if echo "$output" | grep -qi "$v"; then return 0; fi
      done
      return 1
      ;;
    output_not_contains_any)
      local values="$1"
      for v in $(echo "$values" | jq -r '.[]'); do
        if echo "$output" | grep -qi "$v"; then return 1; fi
      done
      return 0
      ;;
    file_contains)
      local file="$1" value="$2"
      if grep -qi "$value" "$tmpdir/$file" 2>/dev/null; then return 0; else return 1; fi
      ;;
    file_not_contains)
      local file="$1" value="$2"
      if grep -qi "$value" "$tmpdir/$file" 2>/dev/null; then return 1; else return 0; fi
      ;;
    file_contains_regex)
      local file="$1" value="$2"
      if grep -qiE "$value" "$tmpdir/$file" 2>/dev/null; then return 0; else return 1; fi
      ;;
    *)
      echo "  Unknown assertion type: $type"
      return 1
      ;;
  esac
}

run_eval_file() {
  local eval_file="$1"
  local skill_name
  skill_name=$(jq -r '.skill_name' "$eval_file")
  local num_evals
  num_evals=$(jq '.evals | length' "$eval_file")

  echo -e "\n${BOLD}=== Eval suite: $skill_name ($eval_file) ===${NC}"
  echo "   $num_evals eval(s) to run"

  for i in $(seq 0 $((num_evals - 1))); do
    local eval_name eval_prompt
    eval_name=$(jq -r ".evals[$i].name" "$eval_file")
    eval_prompt=$(jq -r ".evals[$i].prompt" "$eval_file")

    echo -e "\n${BOLD}--- Eval $((i+1))/$num_evals: $eval_name ---${NC}"

    # Create temp working directory
    local tmpdir
    tmpdir=$(mktemp -d)

    # Copy fixture files
    local files
    files=$(jq -r ".evals[$i].files[]" "$eval_file" 2>/dev/null || true)
    for f in $files; do
      cp "$SCRIPT_DIR/$f" "$tmpdir/TASKS.md"
    done

    # Run claude with the prompt
    echo "  Running claude -p ..."
    local output exit_code=0
    output=$(cd "$tmpdir" && claude -p \
      --plugin-dir "$PLUGIN_DIR" \
      --dangerously-skip-permissions \
      --model sonnet \
      "$eval_prompt" 2>&1) || exit_code=$?

    if [ $exit_code -ne 0 ]; then
      echo -e "  ${RED}ERROR: claude exited with code $exit_code${NC}"
      echo "  Output: ${output:0:200}"
      FAIL=$((FAIL + 1))
      ERRORS+=("$eval_name: claude exited with code $exit_code")
      rm -rf "$tmpdir"
      continue
    fi

    # Check assertions
    local num_assertions
    num_assertions=$(jq ".evals[$i].assertions | length" "$eval_file")
    local eval_passed=true

    for j in $(seq 0 $((num_assertions - 1))); do
      local a_name a_type a_value a_values a_file
      a_name=$(jq -r ".evals[$i].assertions[$j].name" "$eval_file")
      a_type=$(jq -r ".evals[$i].assertions[$j].type" "$eval_file")
      a_value=$(jq -r ".evals[$i].assertions[$j].value // empty" "$eval_file")
      a_values=$(jq ".evals[$i].assertions[$j].values // empty" "$eval_file")
      a_file=$(jq -r ".evals[$i].assertions[$j].file // empty" "$eval_file")

      local result=0
      case "$a_type" in
        output_contains)
          check_assertion "$a_type" "$a_name" "$output" "$tmpdir" "$a_value" || result=1
          ;;
        output_not_contains)
          check_assertion "$a_type" "$a_name" "$output" "$tmpdir" "$a_value" || result=1
          ;;
        output_contains_any|output_not_contains_any)
          check_assertion "$a_type" "$a_name" "$output" "$tmpdir" "$a_values" || result=1
          ;;
        file_contains|file_not_contains|file_contains_regex)
          check_assertion "$a_type" "$a_name" "$output" "$tmpdir" "$a_file" "$a_value" || result=1
          ;;
        *)
          echo -e "  ${YELLOW}? $a_name: unknown type $a_type${NC}"
          result=1
          ;;
      esac

      if [ $result -eq 0 ]; then
        echo -e "  ${GREEN}PASS${NC} $a_name"
      else
        echo -e "  ${RED}FAIL${NC} $a_name ($a_type)"
        eval_passed=false
      fi
    done

    if $eval_passed; then
      echo -e "  ${GREEN}${BOLD}EVAL PASSED${NC}"
      PASS=$((PASS + 1))
    else
      echo -e "  ${RED}${BOLD}EVAL FAILED${NC}"
      FAIL=$((FAIL + 1))
      ERRORS+=("$eval_name")
    fi

    rm -rf "$tmpdir"
  done
}

# Run all eval files
for ef in "${EVAL_FILES[@]}"; do
  run_eval_file "$ef"
done

# Summary
echo -e "\n${BOLD}========== SUMMARY ==========${NC}"
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo -e "\n  ${RED}Failed evals:${NC}"
  for e in "${ERRORS[@]}"; do
    echo "    - $e"
  done
fi
echo ""

[ $FAIL -eq 0 ]

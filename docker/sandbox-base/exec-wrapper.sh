#!/usr/bin/env bash
# /usr/local/bin/exec-wrapper.sh
# Purpose: Execute tool commands with precise timing, environment isolation, and clean exit traps.

set -o pipefail

COMMAND="$1"
CWD="${2:-/workspace}"

cd "${CWD}" || exit 1

# High-resolution timestamp calculation (supports Linux GNU date +%s%N and BSD fallback)
get_nanoseconds() {
    local ts
    ts=$(date +%s%N 2>/dev/null || true)
    if [[ "${ts}" =~ ^[0-9]+$ ]]; then
        echo "${ts}"
    else
        echo "$(date +%s)000000000"
    fi
}

START_NS=$(get_nanoseconds)

# Execute the command passed from the orchestrator in a subshell to capture exit traps & direct exits
(
    eval "${COMMAND}"
)
EXIT_CODE=$?

END_NS=$(get_nanoseconds)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))
if [ "${DURATION_MS}" -lt 0 ]; then
    DURATION_MS=0
fi

# Emit execution metadata trailer to stderr delimiter
printf "\n__SB_META_TRAILER__:{\"exitCode\":%d,\"durationMs\":%d}\n" "${EXIT_CODE}" "${DURATION_MS}" >&2

exit ${EXIT_CODE}

#!/usr/bin/env bash

set -o pipefail

COMMAND="$1"
CWD="${2:-/workspace}"

cd "${CWD}" || exit 1

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

(
    eval "${COMMAND}"
)
EXIT_CODE=$?

END_NS=$(get_nanoseconds)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))
if [ "${DURATION_MS}" -lt 0 ]; then
    DURATION_MS=0
fi

printf "\n__SB_META_TRAILER__:{\"exitCode\":%d,\"durationMs\":%d}\n" "${EXIT_CODE}" "${DURATION_MS}" >&2

exit ${EXIT_CODE}

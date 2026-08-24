#!/usr/bin/env bash
set -euo pipefail

echo "=== Skill Benchmarks Sandbox Environment Verification ==="

check_binary() {
    local name="$1"
    local cmd="$2"
    if command -v "${cmd%% *}" >/dev/null 2>&1; then
        local version
        version=$(${cmd} 2>&1 | head -n 1 || true)
        printf "  [✓] %-16s : %s\n" "${name}" "${version}"
    else
        printf "  [✗] %-16s : NOT FOUND\n" "${name}"
        exit 1
    fi
}

check_binary "OS Release" "cat /etc/debian_version"
check_binary "Shell (bash)" "bash --version"
check_binary "Git" "git --version"
check_binary "Node.js" "node --version"
check_binary "npm" "npm --version"
check_binary "pnpm" "pnpm --version"
check_binary "Bun" "bun --version"
check_binary "Python" "python3 --version"
check_binary "uv" "uv --version"
check_binary "ripgrep" "rg --version"
check_binary "fd-find" "fd --version"
check_binary "jq" "jq --version"

echo "=== Non-Root User Verification ==="
printf "  Current User: %s (UID=%s, GID=%s)\n" "$(whoami)" "$(id -u)" "$(id -g)"
if [ "$(id -u)" -eq 0 ]; then
    echo "  [✗] Security Failure: Running as root!"
    exit 1
fi

WORKSPACE_DIR="${WORKSPACE:-/workspace}"
printf "  Workspace: %s (writable: %s)\n" "${WORKSPACE_DIR}" "$([ -w "${WORKSPACE_DIR}" ] && echo "YES" || echo "NO")"
if [ ! -w "${WORKSPACE_DIR}" ]; then
    echo "  [✗] Security Failure: Workspace directory is not writable!"
    exit 1
fi

echo "=== Environment Verification Passed Successfully ==="

#!/usr/bin/env bash
# 把一个本地插件包装进 web profile。
# 用法: ./scripts/install-plugin.sh <packages 下的目录名>   例: ./scripts/install-plugin.sh dsh-plugin-balance
# 安装后需要重启 `dsh web` 服务，插件集合的变化才会生效。
set -euo pipefail

PACKAGE_DIR="${1:?usage: install-plugin.sh <package-dir-name>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# dsh 二进制：优先 DSH_BIN 环境变量；其次 PATH 里的 dsh（换电脑开箱即用）；
# 最后回退到这台机器 npx 部署里的路径。
if [ -z "${DSH_BIN:-}" ]; then
  if command -v dsh >/dev/null 2>&1; then
    DSH_BIN="$(command -v dsh)"
  else
    DSH_BIN="/Users/hhc/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh"
  fi
fi

if [ ! -f "$ROOT/packages/$PACKAGE_DIR/package.json" ]; then
  echo "error: packages/$PACKAGE_DIR/package.json not found" >&2
  exit 1
fi

echo "using dsh: $DSH_BIN" >&2
exec "$DSH_BIN" plugin --profile web add "$ROOT/packages/$PACKAGE_DIR"

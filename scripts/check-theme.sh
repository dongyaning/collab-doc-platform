#!/usr/bin/env bash
# 检查 tokens.ts 与 variables.less 中的主题色值是否一致
# 在 lint-staged 或 CI 中调用：pnpm check:theme

set -euo pipefail

TOKENS_FILE="apps/doc-web/src/styles/tokens.ts"
VARS_FILE="apps/doc-web/src/styles/variables.less"

# 从 tokens.ts 提取 colorPrimary 值
ts_color=$(grep -oE "colorPrimary: '#[0-9a-fA-F]+'" "$TOKENS_FILE" \
  | grep -oE "'#[0-9a-fA-F]+'" | tr -d "'")

# 从 variables.less 提取语义色 @color-primary 指向的色阶变量名
semantic_ref=$(grep -oE '@color-primary:\s*@[a-zA-Z0-9-]+' "$VARS_FILE" \
  | grep -oE '@[a-zA-Z0-9-]+$')

# 解析色阶变量的实际色值
palette_color=$(grep -oE "^${semantic_ref}:\s*#[0-9a-fA-F]+" "$VARS_FILE" \
  | grep -oE '#[0-9a-fA-F]+')

if [ "$ts_color" != "$palette_color" ]; then
  echo "❌ Theme token mismatch:"
  echo "   tokens.ts         colorPrimary = $ts_color"
  echo "   variables.less    $semantic_ref = $palette_color"
  exit 1
fi

echo "✓ Theme tokens consistent (primary: $ts_color)"

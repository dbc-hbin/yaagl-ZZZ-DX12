#!/bin/zsh
set -euo pipefail

repo_dir="${0:A:h:h}"
cd "$repo_dir"

# This diagnostic build must fail closed onto the v2 passive-capture path.
# A plain naposdx12 build intentionally remains usable for non-capture work.
export YAAGL_CHANNEL_CLIENT=naposdx12
export YAAGL_METAL_IR_MODE=metal-ir-capture-v2

exec node build-app.js

#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$repo_dir/native/capture-fs-helper/capture-fs-helper.cpp"
output_dir="$repo_dir/sidecar/diagnostics"
output_file="$output_dir/yaagl-capture-fs-helper"

mkdir -p "$output_dir"

xcrun clang++ -std=c++17 -arch x86_64 -O2 -Wall -Wextra -Werror \
  "$source_file" -o "$output_file"
chmod 755 "$output_file"
codesign --force --sign - "$output_file"
shasum -a 256 "$output_file"

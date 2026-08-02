#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$repo_dir/native/zzz-rt-shim/zzz-rt-shim.cpp"
output_dir="$repo_dir/sidecar/runtime"
output_file="$output_dir/libyaagl-zzz-rt-shim.dylib"
build_dir="${TMPDIR:-/tmp}/yaagl-zzz-rt-shim-tests"

mkdir -p "$output_dir" "$build_dir"
xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib -O2 \
  -Wall -Wextra -Werror -Wl,-install_name,@rpath/libyaagl-zzz-rt-shim.dylib \
  -Wl,-undefined,dynamic_lookup \
  "$source_file" -o "$output_file"
codesign --force --sign - "$output_file"

if [[ "${1:-}" == "--test" ]]; then
  if nm -u "$output_file" | grep -q IRCompilerAllocCompileAndLink; then
    echo "RT shim must patch the verified GOT slot, not import the provider symbol" >&2
    exit 1
  fi
  if strings "$output_file" | grep -Eq 'capture|observer|terminal.json|source-.*dxil|rt-output'; then
    echo "RT shim contains retired diagnostic runtime machinery" >&2
    exit 1
  fi
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/unorm24-transform-proof.cpp" \
    -o "$build_dir/unorm24-transform-proof"
  "$build_dir/unorm24-transform-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/inject-cache-transform-proof.cpp" \
    -o "$build_dir/inject-cache-transform-proof"
  "$build_dir/inject-cache-transform-proof"
fi

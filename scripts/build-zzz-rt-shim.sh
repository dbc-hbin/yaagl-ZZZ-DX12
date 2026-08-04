#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$repo_dir/native/zzz-rt-shim/zzz-rt-shim.cpp"
output_dir="$repo_dir/sidecar/runtime"
output_file="$output_dir/libyaagl-zzz-rt-shim.dylib"
build_dir="${TMPDIR:-/tmp}/yaagl-zzz-rt-shim-tests"

mkdir -p "$output_dir" "$build_dir"
xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib -O2 \
  -fno-rtti -fvisibility=hidden -fvisibility-inlines-hidden \
  -ffunction-sections -fdata-sections \
  -Wall -Wextra -Werror -Wl,-dead_strip \
  -Wl,-install_name,@rpath/libyaagl-zzz-rt-shim.dylib \
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
  if grep -q '_dyld_image_count' "$source_file"; then
    echo "RT shim must inspect only the image supplied to the dyld callback" >&2
    exit 1
  fi
  if grep -q 'kPositiveFull' "$source_file"; then
    echo "RT shim cache saturation must not suppress transformation" >&2
    exit 1
  fi
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/zzz-rt-shim/tests/decision-cache-proof.cpp" \
    -o "$build_dir/decision-cache-proof"
  "$build_dir/decision-cache-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/zzz-rt-shim/tests/image-callback-proof.cpp" \
    -o "$build_dir/image-callback-proof"
  "$build_dir/image-callback-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/zzz-rt-shim/tests/compile-boundary-dispatch-proof.cpp" \
    -o "$build_dir/compile-boundary-dispatch-proof"
  "$build_dir/compile-boundary-dispatch-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/zzz-rt-shim/tests/pinned-sha256-proof.cpp" \
    -o "$build_dir/pinned-sha256-proof"
  "$build_dir/pinned-sha256-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/zzz-rt-shim/tests/correction-cache-policy-proof.cpp" \
    -o "$build_dir/correction-cache-policy-proof"
  "$build_dir/correction-cache-policy-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/unorm24-transform-proof.cpp" \
    -o "$build_dir/unorm24-transform-proof"
  "$build_dir/unorm24-transform-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/inject-cache-transform-proof.cpp" \
    -o "$build_dir/inject-cache-transform-proof"
  "$build_dir/inject-cache-transform-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -pthread -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/translation-synchronization-proof.cpp" \
    -o "$build_dir/translation-synchronization-proof"
  "$build_dir/translation-synchronization-proof"
fi

if [[ "${1:-}" == "--benchmark" ]]; then
  xcrun clang++ -std=c++17 -arch x86_64 -O2 -Wall -Wextra -Werror \
    "$repo_dir/native/zzz-rt-shim/tests/runtime-overhead-benchmark.cpp" \
    -o "$build_dir/runtime-overhead-benchmark"
  "$build_dir/runtime-overhead-benchmark"
fi

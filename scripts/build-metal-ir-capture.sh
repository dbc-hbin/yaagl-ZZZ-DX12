#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$repo_dir/native/metal-ir-capture/metal-ir-capture.cpp"
rt_observer_source="$repo_dir/native/metal-ir-capture/rt-output-observer.mm"
output_dir="$repo_dir/sidecar/diagnostics"
output_file="$output_dir/libyaagl-metal-ir-capture.dylib"
build_dir="$repo_dir/build/metal-ir-capture-tests"

if [[ "${1:-}" == "--dxil-proof" ]]; then
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror -pthread \
    "$repo_dir/native/metal-ir-capture/tests/dxil-capture-proof.cpp" \
    -o "$build_dir/dxil-capture-proof"
  "$build_dir/dxil-capture-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -O2 -fno-fast-math \
    -ffp-contract=off -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/unorm24-equivalence.cpp" \
    -o "$build_dir/unorm24-equivalence"
  "$build_dir/unorm24-equivalence"
  xcrun clang++ -std=c++17 -arch x86_64 -O2 -fno-fast-math \
    -ffp-contract=off -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/unorm16-times-two-equivalence.cpp" \
    -o "$build_dir/unorm16-times-two-equivalence"
  "$build_dir/unorm16-times-two-equivalence"
  xcrun clang++ -std=c++17 -arch x86_64 -O2 -fno-fast-math \
    -ffp-contract=off -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/inject-cache-equivalence.cpp" \
    -o "$build_dir/inject-cache-equivalence"
  "$build_dir/inject-cache-equivalence"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/unorm24-transform-proof.cpp" \
    -o "$build_dir/unorm24-transform-proof"
  "$build_dir/unorm24-transform-proof"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/inject-cache-transform-proof.cpp" \
    -o "$build_dir/inject-cache-transform-proof"
  "$build_dir/inject-cache-transform-proof"
  exit 0
fi

if [[ "${1:-}" == "--passive-tests" ]]; then
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror -Wno-unused-function -pthread \
    "$repo_dir/native/metal-ir-capture/tests/passive-capture-contract.cpp" \
    -o "$build_dir/passive-capture-contract"
  "$build_dir/passive-capture-contract"
  exit 0
fi

if [[ "${1:-}" == "--v2-integration-fixture" ]]; then
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror -Wno-unused-function -pthread \
    "$repo_dir/native/metal-ir-capture/tests/v2-fixture-host.cpp" \
    -o "$build_dir/v2-fixture-host"
  "$build_dir/v2-fixture-host"
  exit 0
fi

if [[ "${1:-}" == "--v2-constructor-fixture-build" ]]; then
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib \
    "$repo_dir/native/metal-ir-capture/tests/got-ir-provider.cpp" \
    -Wl,-install_name,@rpath/libv2-fixture-provider.dylib \
    -o "$build_dir/libv2-fixture-provider.dylib"
  xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib \
    "$repo_dir/native/metal-ir-capture/tests/got-ir-consumer.cpp" \
    -L"$build_dir" -lv2-fixture-provider -Wl,-rpath,"$build_dir" \
    -Wl,-install_name,@rpath/libv2-fixture-consumer.dylib \
    -o "$build_dir/libv2-fixture-consumer.dylib"
  xcrun clang++ -std=c++17 -arch x86_64 \
    "$repo_dir/native/metal-ir-capture/tests/v2-constructor-host.cpp" \
    -L"$build_dir" -lv2-fixture-consumer -Wl,-rpath,"$build_dir" \
    -o "$build_dir/v2-constructor-host"
  got_offset="$(xcrun llvm-objdump --macho --bind "$build_dir/libv2-fixture-consumer.dylib" | awk '$NF == "_IRCompilerAllocCompileAndLink" { print $3; exit }')"
  test -n "$got_offset"
  printf '%s\n' "$got_offset" > "$build_dir/v2-fixture-got-offset.txt"
  exit 0
fi

if [[ "${1:-}" == "--v2-late-load-fixture" ]]; then
  mkdir -p "$build_dir"
  if [[ ! -f "$output_file" ]]; then
    xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib -O2 \
      -Wall -Wextra -Werror \
      -Wl,-install_name,@rpath/libyaagl-metal-ir-capture.dylib \
      -framework Security -framework Foundation -Wl,-undefined,dynamic_lookup \
      "$source_file" "$rt_observer_source" -o "$output_file"
    codesign --force --sign - "$output_file"
  fi
  "$0" --v2-constructor-fixture-build >/dev/null
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/v2-late-load-host.cpp" \
    -framework Security -o "$build_dir/v2-late-load-host"
  got_offset="$(cat "$build_dir/v2-fixture-got-offset.txt")"
  for order in provider-first consumer-first; do
    session_root="$(mktemp -d "$build_dir/v2-late-load.XXXXXX")"
    mkdir -p "$session_root/instances" "$session_root/acks" \
      "$session_root/arms" "$session_root/controls"
    env \
      YAAGL_RUNTIME_MODE=metal-ir-capture-v2 \
      YAAGL_METAL_IR_V2_CONSTRUCTOR_FIXTURE=1 \
      YAAGL_METAL_IR_FIXTURE_GOT_OFFSET="$got_offset" \
      YAAGL_METAL_IR_D3DMETAL="$build_dir/libv2-fixture-consumer.dylib" \
      YAAGL_METAL_IR_PROVIDER="$build_dir/libv2-fixture-provider.dylib" \
      YAAGL_METAL_IR_SESSION_ROOT="$session_root" \
      YAAGL_METAL_IR_LOG="$session_root/capture.log" \
      YAAGL_METAL_IR_RUN_ID="late-$order" \
      YAAGL_METAL_IR_ATTEMPT_ID="late-$order" \
      YAAGL_METAL_IR_ACK_TOKEN=fixture-token \
      YAAGL_METAL_IR_CAPTURE_SHA256=$(printf '%064d' 0) \
      YAAGL_METAL_IR_D3DMETAL_SHA256=$(printf '%064d' 1) \
      YAAGL_METAL_IR_PROVIDER_SHA256=$(printf '%064d' 2) \
      YAAGL_METAL_IR_GAME_EXECUTABLE='Z:\\Applications\\Fixture.exe' \
      DYLD_INSERT_LIBRARIES="$output_file" \
      "$build_dir/v2-late-load-host" "$order"
  done
  exit 0
fi

if [[ "${1:-}" == "--provider-object-proof" ]]; then
  : "${YAAGL_OBJECT_PROOF_PROVIDER:?provider path required}"
  : "${YAAGL_OBJECT_PROOF_DXIL:?replacement DXIL path required}"
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/provider-object-lifetime-proof.cpp" \
    -o "$build_dir/provider-object-lifetime-proof"
  "$build_dir/provider-object-lifetime-proof" \
    "$YAAGL_OBJECT_PROOF_PROVIDER" "$YAAGL_OBJECT_PROOF_DXIL"
  exit 0
fi

if [[ "${1:-}" == "--dxc-roundtrip-proof" ]]; then
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/dxc-roundtrip-proof.cpp" \
    -o "$build_dir/dxc-roundtrip-proof"
  "$build_dir/dxc-roundtrip-proof" \
    "$repo_dir/naposdx12/gptk/4.0b2/lib/external/D3DMetal.framework/Versions/A/Resources/libdxcompiler.dylib" \
    "$repo_dir/sidecar/diagnostics/zzz-rt-unorm-float.dxil" \
    "$build_dir/zzz-rt-unorm-float-roundtrip.dxil"
  exit 0
fi

if [[ "${1:-}" == "--captured-dxc-proof" ]]; then
  if [[ "$#" -ne 4 ]]; then
    echo "usage: $0 --captured-dxc-proof inject-cache.dxil resolve-rays.dxil fill-pixels.dxil" >&2
    exit 2
  fi
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/dxc-roundtrip-proof.cpp" \
    -o "$build_dir/dxc-roundtrip-proof"
  dxc_path="$repo_dir/naposdx12/gptk/4.0b2/lib/external/D3DMetal.framework/Versions/A/Resources/libdxcompiler.dylib"
  YAAGL_DXC_PROOF_QUIET=1 "$build_dir/dxc-roundtrip-proof" \
    "$dxc_path" "$2" "$build_dir/inject-cache-transformed.dxil" \
    --transform-inject-cache
  YAAGL_DXC_PROOF_QUIET=1 "$build_dir/dxc-roundtrip-proof" \
    "$dxc_path" "$3" "$build_dir/resolve-rays-transformed.dxil" \
    --transform-unorm
  YAAGL_DXC_PROOF_QUIET=1 "$build_dir/dxc-roundtrip-proof" \
    "$dxc_path" "$4" "$build_dir/fill-pixels-transformed.dxil" \
    --transform-unorm
  exit 0
fi

if [[ "${1:-}" == "--rt-output-hook-proof" ]]; then
  mkdir -p "$build_dir"
  xcrun clang++ -std=c++17 -arch x86_64 -Wall -Wextra -Werror \
    "$repo_dir/native/metal-ir-capture/tests/rt-output-hook-boundary-proof.cpp" \
    -o "$build_dir/rt-output-hook-boundary-proof"
  "$build_dir/rt-output-hook-boundary-proof" \
    "$repo_dir/naposdx12/gptk/4.0b2/lib/external/D3DMetal.framework/Versions/A/D3DMetal"
  exit 0
fi

mkdir -p "$output_dir" "$build_dir"

xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib -O2 \
  -Wall -Wextra -Werror -Wl,-install_name,@rpath/libyaagl-metal-ir-capture.dylib \
  -framework Security -framework Foundation -Wl,-undefined,dynamic_lookup \
  "$source_file" "$rt_observer_source" -o "$output_file"
codesign --force --sign - "$output_file"

if [[ "${1:-}" == "--test" ]]; then
  if nm -u "$output_file" | grep -q IRCompilerAllocCompileAndLink; then
    echo "production probe must not import IRCompilerAllocCompileAndLink" >&2
    exit 1
  fi
  if otool -l "$output_file" | grep -q __interpose; then
    echo "production probe must not contain a static interpose tuple" >&2
    exit 1
  fi
  if strings "$output_file" | grep -Eq 'EnableFP64|metal-ir-fp64'; then
    echo "DXIL capture probe must not contain the retired FP64 mutation path" >&2
    exit 1
  fi
  "$0" --got-proof >/dev/null
  "$0" --dxil-proof >/dev/null
  "$0" --rt-output-hook-proof >/dev/null
  "$0" --passive-tests >/dev/null
  "$0" --v2-integration-fixture
  "$0" --v2-late-load-fixture >/dev/null
fi

if [[ "${1:-}" == "--fp64-proof" ]]; then
  xcrun clang++ -std=c++17 -arch x86_64 \
    "$repo_dir/native/metal-ir-capture/tests/fp64-state-proof.cpp" \
    -o "$build_dir/fp64-state-proof"
  "$build_dir/fp64-state-proof"
fi

if [[ "${1:-}" == "--dynamic-interpose-proof" ]]; then
  xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib \
    "$repo_dir/native/metal-ir-capture/tests/dynamic-provider.cpp" \
    -Wl,-install_name,@rpath/libdynamic-provider.dylib \
    -o "$build_dir/libdynamic-provider.dylib"
  xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib \
    "$repo_dir/native/metal-ir-capture/tests/dynamic-consumer.cpp" \
    -L"$build_dir" -ldynamic-provider -Wl,-rpath,"$build_dir" \
    -Wl,-install_name,@rpath/libdynamic-consumer.dylib \
    -o "$build_dir/libdynamic-consumer.dylib"
  xcrun clang++ -std=c++17 -arch x86_64 \
    "$repo_dir/native/metal-ir-capture/tests/dynamic-proof.cpp" \
    -L"$build_dir" -ldynamic-consumer -ldynamic-provider \
    -Wl,-rpath,"$build_dir" -o "$build_dir/dynamic-proof"
  "$build_dir/dynamic-proof"
fi

if [[ "${1:-}" == "--got-proof" ]]; then
  xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib \
    "$repo_dir/native/metal-ir-capture/tests/got-ir-provider.cpp" \
    -Wl,-install_name,@rpath/libgot-ir-provider.dylib \
    -o "$build_dir/libgot-ir-provider.dylib"
  xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib \
    "$repo_dir/native/metal-ir-capture/tests/got-ir-consumer.cpp" \
    -L"$build_dir" -lgot-ir-provider -Wl,-rpath,"$build_dir" \
    -Wl,-install_name,@rpath/libgot-ir-consumer.dylib \
    -o "$build_dir/libgot-ir-consumer.dylib"
  xcrun clang++ -std=c++17 -arch x86_64 -dynamiclib \
    "$repo_dir/native/metal-ir-capture/tests/got-proof-probe.cpp" \
    -o "$build_dir/libgot-proof-probe.dylib"
  xcrun clang++ -std=c++17 -arch x86_64 \
    "$repo_dir/native/metal-ir-capture/tests/got-proof-main.cpp" \
    -o "$build_dir/got-proof-main"
  got_offset="$(xcrun llvm-objdump --macho --bind "$build_dir/libgot-ir-consumer.dylib" | awk '$NF == "_IRCompilerAllocCompileAndLink" { print $3; exit }')"
  test -n "$got_offset"
  for scenario in normal preload after-writable after-cas; do
    : > "$build_dir/got-proof-$scenario.log"
    extra_env=(YAAGL_GOT_PROOF_SCENARIO="$scenario")
    if [[ "$scenario" == "preload" ]]; then
      extra_env+=(YAAGL_GOT_PROOF_PRELOAD_PROVIDER=1)
    elif [[ "$scenario" == after-* ]]; then
      extra_env+=(YAAGL_GOT_PROOF_FAIL="$scenario")
    fi
    env "${extra_env[@]}" \
      YAAGL_GOT_PROOF_CONSUMER="$build_dir/libgot-ir-consumer.dylib" \
      YAAGL_GOT_PROOF_PROVIDER="$build_dir/libgot-ir-provider.dylib" \
      YAAGL_GOT_PROOF_OFFSET="$got_offset" \
      YAAGL_GOT_PROOF_LOG="$build_dir/got-proof-$scenario.log" \
      DYLD_INSERT_LIBRARIES="$build_dir/libgot-proof-probe.dylib" \
      "$build_dir/got-proof-main"
  done
  cat "$build_dir"/got-proof-*.log
fi

shasum -a 256 "$output_file"

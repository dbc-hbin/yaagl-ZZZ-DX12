#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_wine=${1:-"$HOME/Library/Application Support/Yaagl ZZZ DX12/wine"}
output_dir=${2:-"$repo_dir/build/local-d3dmetal-wine-runtime"}
stage="$output_dir/stage"
archive="$output_dir/wine-11.0-d3dmetal-patched-gptk4.0b2-rtx5060.tar.xz"

if [ ! -x "$source_wine/bin/wine" ] || [ ! -x "$source_wine/bin/wineserver" ]; then
  echo "invalid Wine runtime: $source_wine" >&2
  exit 2
fi

converter="$source_wine/lib/external/D3DMetal.framework/Versions/A/Resources/libmetalirconverter.dylib"
inspection=$(node "$repo_dir/scripts/metalir-fp64-codec-patch.mjs" inspect "$converter")
printf '%s\n' "$inspection" | grep -q '"mode": "patched"' || {
  echo "source runtime does not contain the verified FP64 codec patch" >&2
  exit 3
}

verify_hash() {
  target=$1
  expected=$2
  actual=$(shasum -a 256 "$target" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    echo "unexpected D3DMetal module hash: $target: $actual" >&2
    exit 5
  fi
}

# Refuse to package a runtime while upstream Yaagl's temporary DXMT swap is
# active. These are the verified GPTK/CrossOver PE modules in the local source.
verify_hash "$source_wine/lib/wine/x86_64-windows/d3d10core.dll" \
  dc87193d17e1b48bd40acc295ee180031089740c87e2d4ddc36325773a3c2e27
verify_hash "$source_wine/lib/wine/x86_64-windows/d3d11.dll" \
  303b2bb41efa30c890e2e93d39c3d3c565c8557e069eee832f2cb8a37bd4ec26
verify_hash "$source_wine/lib/wine/x86_64-windows/dxgi.dll" \
  522a8b37216afb09e614489d88a74118076f4d7e08d2b289df6a6eb6f3e817af
verify_hash "$source_wine/lib/wine/x86_64-windows/d3d12.dll" \
  1b7a02cb37ec6b484e2aaa76b5ec9cbb47e63aeec29dbe087d5d1589a3347cfb

mkdir -p "$output_dir"
if [ -e "$stage" ] || [ -e "$archive" ]; then
  echo "refusing to overwrite existing build output: $output_dir" >&2
  exit 4
fi
mkdir -p "$stage/wine"
ditto "$source_wine" "$stage/wine"
mv "$stage/wine/bin/wine" "$stage/wine/bin/wine.real"
cp "$repo_dir/sidecar/local-wine/wine-launch-wrapper.sh" "$stage/wine/bin/wine"
chmod 755 "$stage/wine/bin/wine"

cat > "$stage/wine/yaagl-local-d3dmetal-runtime.txt" <<EOF
Wine: 11.0 CrossOver experimental
Graphics backend: GPTK 4.0b2 D3DMetal
Metal IR converter: verified local FP64 codec patch
GPU identity: NVIDIA GeForce RTX 5060 (10de:2d05)
Renderer selection: launcher-controlled; no game argument injection
DXMT components: removed
Archive layout: Yaagl-compatible top-level wine/
EOF

codesign --verify --strict "$stage/wine/bin/wine.real"
codesign --verify --strict "$stage/wine/bin/wineserver"
codesign --verify --deep --strict "$stage/wine/lib/external/D3DMetal.framework"

COPYFILE_DISABLE=1 tar -C "$stage" \
  --exclude='.DS_Store' \
  --exclude='wine/yaagl-wine-runtime.json' \
  --exclude='wine/lib/external/D3DMetal.framework.pristine-before-rtxgi-tags' \
  --exclude='wine/lib/wine/x86_64-unix/winemetal.so' \
  --exclude='wine/lib/wine/x86_64-windows/winemetal.dll' \
  --exclude='wine/lib/wine/i386-unix/winemetal.so' \
  --exclude='wine/lib/wine/i386-windows/winemetal.dll' \
  -cf - wine | xz -T0 -3 > "$archive"
tar -tJf "$archive" >/dev/null
shasum -a 256 "$archive" | tee "$archive.sha256"
du -h "$archive"

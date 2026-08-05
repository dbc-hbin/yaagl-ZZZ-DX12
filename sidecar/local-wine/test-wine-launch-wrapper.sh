#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/yaagl-wine-wrapper-test.XXXXXX")
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin" "$test_root/prefix"
mkdir -p "$test_root/lib/wine/x86_64-windows"
cp "$repo_dir/sidecar/local-wine/wine-launch-wrapper.sh" "$test_root/bin/wine"
cat > "$test_root/bin/wine.real" <<'EOF'
#!/bin/sh
printf 'backend=%s\n' "$CX_ACTIVE_GRAPHICS_BACKEND"
printf 'vendor=%s device=%s description=%s\n' "$D3DM_VENDOR_ID" "$D3DM_DEVICE_ID" "$D3DM_DEVICE_DESCRIPTION"
printf 'argv='; printf '<%s>' "$@"; printf '\n'
EOF
chmod 755 "$test_root/bin/wine" "$test_root/bin/wine.real"
printf 'dxmt' > "$test_root/lib/wine/x86_64-windows/dxgi.dll"
printf 'd3dmetal' > "$test_root/lib/wine/x86_64-windows/dxgi.dll.bak"

direct=$(WINEPREFIX="$test_root/prefix" "$test_root/bin/wine" 'Z:\Games\ZenlessZoneZero.exe')
printf '%s\n' "$direct" | grep -Fq 'backend=d3dmetal'
printf '%s\n' "$direct" | grep -Fq 'vendor=0x10de device=0x2d05 description=NVIDIA GeForce RTX 5060'
printf '%s\n' "$direct" | grep -Fq 'argv=<Z:\Games\ZenlessZoneZero.exe>'
printf '%s\n' "$direct" | grep -Fq -- '-use-d3d12' && exit 1

cat > "$test_root/config.bat" <<'EOF'
@echo off
"Z:\Games\ZenlessZoneZero.exe"
EOF
batch=$(WINEPREFIX="$test_root/prefix" "$test_root/bin/wine" cmd /c 'Z:\config.bat')
printf '%s\n' "$batch" | grep -Fq 'argv=<cmd></c><Z:\config.bat>'
grep -q -- '-use-d3d12' "$test_root/config.bat" && exit 1
grep -Fq 'd3dmetal' "$test_root/lib/wine/x86_64-windows/dxgi.dll"
grep -Fq 'd3dmetal' "$test_root/lib/wine/x86_64-windows/dxgi.dll.bak"

control=$(WINEPREFIX="$test_root/prefix" "$test_root/bin/wine" wineboot -u)
printf '%s\n' "$control" | grep -Fq 'argv=<wineboot><-u>'
printf 'PASS: fixed D3DMetal/RTX5060 profile without renderer argument injection\n'

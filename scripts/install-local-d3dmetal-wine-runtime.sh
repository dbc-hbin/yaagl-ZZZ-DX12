#!/bin/sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <runtime.tar.xz> [Yaagl support root]" >&2
  exit 2
fi

archive=$1
support_root=${2:-"$HOME/Library/Application Support/Yaagl ZZZ DX12"}
active="$support_root/wine"
timestamp=$(date '+%Y%m%d-%H%M%S')
recovery="$support_root/recovery/local-wine-before-rtx5060-dx12-$timestamp"
staging=$(mktemp -d "$support_root/.local-wine-install.XXXXXX")

if [ ! -f "$archive" ] || [ ! -d "$active" ]; then
  echo "archive or active Yaagl Wine runtime is missing" >&2
  exit 3
fi
if pgrep -f "$active/bin/(wine|wineserver)" >/dev/null 2>&1; then
  echo "Yaagl Wine is running; quit the game and launcher before installing" >&2
  exit 4
fi

tar -xJf "$archive" -C "$staging"
candidate="$staging/wine"
if [ ! -x "$candidate/bin/wine" ] || [ ! -x "$candidate/bin/wine.real" ] ||
   [ ! -x "$candidate/bin/wineserver" ]; then
  echo "archive does not contain the expected Yaagl wine/ layout" >&2
  exit 5
fi
converter="$candidate/lib/external/D3DMetal.framework/Versions/A/Resources/libmetalirconverter.dylib"
converter_hash=$(shasum -a 256 "$converter" | awk '{print $1}')
if [ "$converter_hash" != "c831f36804e65ea0f54d9516e1d8cc690454bc711e55b0e615a39c30469e30fa" ]; then
  echo "unexpected patched Metal IR converter hash: $converter_hash" >&2
  exit 6
fi
if [ "$("$candidate/bin/wine" --version)" != "wine-11.0" ]; then
  echo "unexpected Wine version" >&2
  exit 7
fi

mkdir -p "$(dirname -- "$recovery")"
mv "$active" "$recovery"
mv "$candidate" "$active"
rmdir "$staging"
printf 'Installed: %s\nRecovery: %s\n' "$active" "$recovery"

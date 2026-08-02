#!/bin/sh

set -eu

pristine_sha="f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad"
tagged_sha="9fdcba57a4c47ed7f444ed18bbe3bc6468361a6d43fb40ea178244aec2f7366d"
guard_sha="380e0897fa881cc7a350e8f862708316ad6db6afb6a631e9b64cfe691b00118e"
guard_tag_sha="4e09276dca738ca6c76922d24dd7c6f7dee0b021889776743a8322e137c8748a"
trap_sha="397ad81e5cb18e4556fe04eaeb6d1fc43209e822810d0278cc151a8476aeffc4"
noop_fix_sha="4925700de03c91e33cd75ac160fac6f9ef8efa7c94a353d4062084cee4b89851"
state_object_return_trap_sha="f19a6b89a668eefd628a8b95126b8099dfae7b2e85861710498be0e57e46b5fb"
state_object_parser_phase_trap_sha="ea8d4e5d11a01b2871125999679d59495f21663f11d66b31c9f1e6f060ea21ee"
state_object_inheritance_result_trap_sha="699547e5c3f2f503705e6bc5809a2d21dbd2fc3d53461c07b4c8e9249bb695a3"
noop_fix_compile_export_store_traps_sha="0a1e2effe8f534f897436545917019d0279aecaa8e86847cfb9a9bd2bc17f904"
noop_fix_create_function_null_traps_sha="bf9a75b515d549b43943793e3c00000206dadbd8e086946f3e786a697746023a"
noop_fix_ir_link_fallback_sha="db27ff847589670c701937392a63c0f9411b3411c77df224d6d066bae44deecb"

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
workspace_root=$(CDPATH= cd -- "$script_directory/.." && pwd -P)
user_home=${HOME:?HOME is not set}

external_directory=${D3DMETAL_RUNTIME_EXTERNAL_DIR:-"$user_home/Library/Application Support/Yaagl ZZZ DX12/wine/lib/external"}
active_framework="$external_directory/D3DMetal.framework"
backup_framework="$external_directory/D3DMetal.framework.pristine-before-rtxgi-tags"
staging_framework="$external_directory/D3DMetal.framework.diagnostic-staging"
failed_framework="$external_directory/D3DMetal.framework.failed-diagnostic"
lock_directory="$external_directory/.d3dmetal-rtxgi-runtime.lock"
cache_framework=${D3DMETAL_CACHE_FRAMEWORK:-"$user_home/Library/Application Support/Yaagl ZZZ DX12/gptk/4.0b2/lib/external/D3DMetal.framework"}
tagged_source=${D3DMETAL_TAGGED_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.tagged"}
guard_source=${D3DMETAL_GUARD_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.guard"}
guard_tag_source=${D3DMETAL_GUARD_TAG_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.guard-tag"}
trap_source=${D3DMETAL_TRAP_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.trap"}
noop_fix_source=${D3DMETAL_NOOP_FIX_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.noop-fix"}
state_object_return_trap_source=${D3DMETAL_STATE_OBJECT_RETURN_TRAP_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.failed-state-object-return-trap"}
state_object_parser_phase_trap_source=${D3DMETAL_STATE_OBJECT_PARSER_PHASE_TRAP_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.parser-phase-trap"}
state_object_inheritance_result_trap_source=${D3DMETAL_STATE_OBJECT_INHERITANCE_RESULT_TRAP_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.inheritance-result-trap"}
noop_fix_compile_export_store_traps_source=${D3DMETAL_NOOP_FIX_COMPILE_EXPORT_STORE_TRAPS_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.noop-fix-compile-export-store-traps"}
noop_fix_create_function_null_traps_source=${D3DMETAL_NOOP_FIX_CREATE_FUNCTION_NULL_TRAPS_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.noop-fix-create-function-null-traps"}
noop_fix_ir_link_fallback_source=${D3DMETAL_NOOP_FIX_IR_LINK_FALLBACK_FRAMEWORK:-"$workspace_root/build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.noop-fix-ir-link-null-with-compile-rt-fallback"}
lock_held=0
transaction=none
restore_diagnostic_state=unknown

framework_binary() {
  printf '%s/Versions/A/D3DMetal\n' "$1"
}

sha256_file() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

framework_hash() {
  binary=$(framework_binary "$1")
  if [ ! -f "$binary" ]; then
    printf 'missing\n'
    return
  fi
  sha256_file "$binary"
}

framework_state() {
  hash=$(framework_hash "$1")
  case "$hash" in
    "$pristine_sha") printf 'pristine\n' ;;
    "$tagged_sha") printf 'failure-tags\n' ;;
    "$guard_sha") printf 'vertex-count-guard\n' ;;
    "$guard_tag_sha") printf 'vertex-count-guard+failure-tags\n' ;;
    "$trap_sha") printf 'state-object-traps\n' ;;
    "$noop_fix_sha") printf 'no-op-pso-vertex-count-init\n' ;;
    "$state_object_return_trap_sha") printf 'failed-create-state-object-return-trap\n' ;;
    "$state_object_parser_phase_trap_sha") printf 'state-object-parser-phase-trap\n' ;;
    "$state_object_inheritance_result_trap_sha") printf 'state-object-inheritance-result-trap\n' ;;
    "$noop_fix_compile_export_store_traps_sha") printf 'noop-fix+compile-export-store-traps\n' ;;
    "$noop_fix_create_function_null_traps_sha") printf 'noop-fix+create-function-null-traps\n' ;;
    "$noop_fix_ir_link_fallback_sha") printf 'noop-fix+ir-link-null-with-compile-rt-fallback\n' ;;
    missing) printf 'missing\n' ;;
    *) printf 'unknown:%s\n' "$hash" ;;
  esac
}

require_state() {
  path=$1
  expected=$2
  label=$3
  actual=$(framework_state "$path")
  if [ "$actual" != "$expected" ]; then
    printf '%s must be %s, found %s: %s\n' \
      "$label" "$expected" "$actual" "$path" >&2
    exit 1
  fi
}

verify_framework_signature() {
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$1"
}

acquire_lock() {
  if /bin/mkdir "$lock_directory" 2>/dev/null; then
    printf '%s\n' "$$" >"$lock_directory/pid"
    lock_held=1
    return
  fi

  owner=
  if [ -f "$lock_directory/pid" ]; then
    owner=$(/bin/cat "$lock_directory/pid" 2>/dev/null || true)
  fi
  case "$owner" in
    *[!0-9]*|'') ;;
    *)
      if /bin/kill -0 "$owner" 2>/dev/null; then
        printf 'Another D3DMetal runtime transition is active (pid %s).\n' \
          "$owner" >&2
        exit 1
      fi
      ;;
  esac

  stale_lock="$lock_directory.stale.$$"
  if ! /bin/mv "$lock_directory" "$stale_lock" 2>/dev/null; then
    printf 'Unable to acquire D3DMetal runtime transition lock: %s\n' \
      "$lock_directory" >&2
    exit 1
  fi
  /bin/rm -rf "$stale_lock"
  if ! /bin/mkdir "$lock_directory" 2>/dev/null; then
    printf 'Unable to acquire D3DMetal runtime transition lock: %s\n' \
      "$lock_directory" >&2
    exit 1
  fi
  printf '%s\n' "$$" >"$lock_directory/pid"
  lock_held=1
}

release_lock() {
  if [ "$lock_held" -eq 1 ]; then
    /bin/rm -f "$lock_directory/pid"
    /bin/rmdir "$lock_directory" 2>/dev/null || true
    lock_held=0
  fi
}

find_lsof() {
  if [ -x /usr/sbin/lsof ]; then
    printf '/usr/sbin/lsof\n'
    return
  fi
  command -v lsof
}

require_idle() {
  binary=$(framework_binary "$active_framework")
  lsof_command=$(find_lsof)
  if "$lsof_command" "$binary" >/dev/null 2>&1; then
    printf 'D3DMetal is in use. Close the game and launcher first:\n' >&2
    "$lsof_command" "$binary" >&2 || true
    exit 1
  fi
}

print_status() {
  printf 'active:  %s\n' "$(framework_state "$active_framework")"
  printf 'cache:   %s\n' "$(framework_state "$cache_framework")"
  printf 'tag source:   %s\n' "$(framework_state "$tagged_source")"
  printf 'guard source: %s\n' "$(framework_state "$guard_source")"
  printf 'combined source: %s\n' "$(framework_state "$guard_tag_source")"
  printf 'trap source: %s\n' "$(framework_state "$trap_source")"
  printf 'no-op fix source: %s\n' "$(framework_state "$noop_fix_source")"
  printf 'return trap source: %s\n' "$(framework_state "$state_object_return_trap_source")"
  printf 'parser phase source: %s\n' "$(framework_state "$state_object_parser_phase_trap_source")"
  printf 'inheritance result source: %s\n' "$(framework_state "$state_object_inheritance_result_trap_source")"
  printf 'compile store trap source: %s\n' "$(framework_state "$noop_fix_compile_export_store_traps_source")"
  printf 'CreateFunction null trap source: %s\n' "$(framework_state "$noop_fix_create_function_null_traps_source")"
  printf 'IR link/fallback trap source: %s\n' "$(framework_state "$noop_fix_ir_link_fallback_source")"
  printf 'backup:  %s\n' "$(framework_state "$backup_framework")"
  printf 'active path: %s\n' "$active_framework"
  printf 'cache path:  %s\n' "$cache_framework"

  if [ -f "$(framework_binary "$active_framework")" ]; then
    lsof_command=$(find_lsof)
    if "$lsof_command" "$(framework_binary "$active_framework")" >/dev/null 2>&1; then
      printf 'in use:  yes\n'
    else
      printf 'in use:  no\n'
    fi
  fi
}

rollback_install() {
  if [ -e "$backup_framework" ]; then
    printf 'Install failed; restoring the pristine framework...\n' >&2
    if [ -e "$active_framework" ]; then
      if [ -e "$failed_framework" ]; then
        failed_framework="$failed_framework.$$"
      fi
      /bin/mv "$active_framework" "$failed_framework"
    fi
    /bin/mv "$backup_framework" "$active_framework"
  fi
  if [ -e "$staging_framework" ]; then
    /bin/rm -rf "$staging_framework"
  fi
  if [ "$(framework_state "$active_framework")" != pristine ]; then
    printf 'Automatic install rollback did not restore a pristine runtime.\n' >&2
  elif ! verify_framework_signature "$active_framework"; then
    printf 'Automatic install rollback restored an invalid signature.\n' >&2
  fi
}

rollback_restore() {
  active_state=$(framework_state "$active_framework")
  backup_state=$(framework_state "$backup_framework")
  staging_state=$(framework_state "$staging_framework")

  if [ "$active_state" = pristine ] && \
    [ "$backup_state" = missing ] && \
    [ "$staging_state" = "$restore_diagnostic_state" ]; then
    printf 'Restore failed; returning to the diagnostic runtime...\n' >&2
    /bin/mv "$active_framework" "$backup_framework"
    /bin/mv "$staging_framework" "$active_framework"
  elif [ "$active_state" = missing ] && \
    [ "$backup_state" = pristine ] && \
    [ "$staging_state" = "$restore_diagnostic_state" ]; then
    printf 'Restore failed before activation; returning the diagnostic runtime...\n' >&2
    /bin/mv "$staging_framework" "$active_framework"
  fi

  if [ "$(framework_state "$active_framework")" != "$restore_diagnostic_state" ] || \
    [ "$(framework_state "$backup_framework")" != pristine ]; then
    printf 'Automatic restore rollback could not reconstruct the tagged runtime and pristine backup.\n' >&2
  fi
}

on_exit() {
  result=$1
  trap - 0 1 2 15
  set +e
  if [ "$result" -ne 0 ]; then
    case "$transaction" in
      install) rollback_install ;;
      restore) rollback_restore ;;
    esac
  fi
  release_lock
  exit "$result"
}

begin_transition() {
  acquire_lock
  trap 'on_exit $?' 0
  trap 'exit 129' 1
  trap 'exit 130' 2
  trap 'exit 143' 15
}

install_diagnostic() {
  desired_state=$1
  diagnostic_source=$2
  diagnostic_label=$3
  begin_transition
  active_state=$(framework_state "$active_framework")
  if [ "$active_state" = "$desired_state" ]; then
    require_state "$backup_framework" pristine "pristine backup"
    verify_framework_signature "$backup_framework"
    verify_framework_signature "$active_framework"
    printf '%s runtime is already installed.\n' "$diagnostic_label"
    return
  fi

  require_state "$active_framework" pristine "active framework"
  require_state "$cache_framework" pristine "GPTK cache framework"
  require_state "$diagnostic_source" "$desired_state" "$diagnostic_label source framework"
  verify_framework_signature "$active_framework"
  verify_framework_signature "$cache_framework"
  verify_framework_signature "$diagnostic_source"
  require_idle

  for reserved_path in \
    "$backup_framework" \
    "$staging_framework" \
    "$failed_framework"; do
    if [ -e "$reserved_path" ]; then
      printf 'Refusing to overwrite reserved path: %s\n' "$reserved_path" >&2
      exit 1
    fi
  done

  /usr/bin/ditto "$diagnostic_source" "$staging_framework"
  require_state "$staging_framework" "$desired_state" "staged framework"
  verify_framework_signature "$staging_framework"

  transaction=install
  /bin/mv "$active_framework" "$backup_framework"
  /bin/mv "$staging_framework" "$active_framework"
  require_state "$backup_framework" pristine "pristine backup"
  require_state "$active_framework" "$desired_state" "active framework"
  verify_framework_signature "$backup_framework"
  verify_framework_signature "$active_framework"
  require_state "$cache_framework" pristine "GPTK cache framework"
  verify_framework_signature "$cache_framework"
  transaction=none

  printf 'Installed %s D3DMetal runtime.\n' "$diagnostic_label"
  printf 'After one controlled run, quit the game, then run: %s restore\n' "$0"
}

install_tags() {
  install_diagnostic failure-tags "$tagged_source" failure-tag
}

install_guard() {
  install_diagnostic vertex-count-guard "$guard_source" vertex-count-guard
}

install_guard_tags() {
  install_diagnostic \
    vertex-count-guard+failure-tags \
    "$guard_tag_source" \
    vertex-count-guard+failure-tags
}

install_state_object_traps() {
  install_diagnostic state-object-traps "$trap_source" state-object-traps
}

install_noop_fix() {
  install_diagnostic \
    no-op-pso-vertex-count-init \
    "$noop_fix_source" \
    no-op-pso-vertex-count-init
}

install_state_object_return_trap() {
  install_diagnostic \
    failed-create-state-object-return-trap \
    "$state_object_return_trap_source" \
    failed-create-state-object-return-trap
}

install_state_object_parser_phase_trap() {
  install_diagnostic \
    state-object-parser-phase-trap \
    "$state_object_parser_phase_trap_source" \
    state-object-parser-phase-trap
}

install_state_object_inheritance_result_trap() {
  install_diagnostic \
    state-object-inheritance-result-trap \
    "$state_object_inheritance_result_trap_source" \
    state-object-inheritance-result-trap
}

install_noop_fix_compile_export_store_traps() {
  install_diagnostic \
    noop-fix+compile-export-store-traps \
    "$noop_fix_compile_export_store_traps_source" \
    noop-fix+compile-export-store-traps
}

install_noop_fix_create_function_null_traps() {
  install_diagnostic \
    noop-fix+create-function-null-traps \
    "$noop_fix_create_function_null_traps_source" \
    noop-fix+create-function-null-traps
}

install_noop_fix_ir_link_fallback() {
  install_diagnostic \
    noop-fix+ir-link-null-with-compile-rt-fallback \
    "$noop_fix_ir_link_fallback_source" \
    noop-fix+ir-link-null-with-compile-rt-fallback
}

restore_pristine() {
  begin_transition
  active_state=$(framework_state "$active_framework")
  backup_state=$(framework_state "$backup_framework")

  if [ "$active_state" = pristine ] && [ "$backup_state" = missing ]; then
    printf 'Pristine runtime is already active.\n'
    return
  fi

  case "$active_state" in
    failure-tags|vertex-count-guard|vertex-count-guard+failure-tags|state-object-traps|no-op-pso-vertex-count-init|failed-create-state-object-return-trap|state-object-parser-phase-trap|state-object-inheritance-result-trap|noop-fix+compile-export-store-traps|noop-fix+create-function-null-traps|noop-fix+ir-link-null-with-compile-rt-fallback)
      restore_diagnostic_state=$active_state
      ;;
    *)
      printf 'Active framework is not a restorable diagnostic: %s\n' \
        "$active_state" >&2
      exit 1
      ;;
  esac
  require_state "$backup_framework" pristine "pristine backup"
  require_state "$cache_framework" pristine "GPTK cache framework"
  verify_framework_signature "$active_framework"
  verify_framework_signature "$backup_framework"
  verify_framework_signature "$cache_framework"
  require_idle

  if [ -e "$staging_framework" ]; then
    printf 'Refusing to overwrite restore staging path: %s\n' "$staging_framework" >&2
    exit 1
  fi

  transaction=restore
  /bin/mv "$active_framework" "$staging_framework"
  /bin/mv "$backup_framework" "$active_framework"
  require_state "$active_framework" pristine "restored active framework"
  require_state "$staging_framework" "$restore_diagnostic_state" "retired diagnostic framework"
  require_state "$cache_framework" pristine "GPTK cache framework"
  verify_framework_signature "$active_framework"
  verify_framework_signature "$staging_framework"
  verify_framework_signature "$cache_framework"
  /bin/rm -rf "$staging_framework"
  transaction=none

  printf 'Restored pristine D3DMetal runtime.\n'
}

usage() {
  printf 'Usage: %s status | install | install-tags | install-traps | install-noop-fix | install-return-trap | install-parser-phase-trap | install-inheritance-trap | install-compile-store-traps | install-create-function-null-traps | install-ir-link-fallback-traps | install-guard | install-guard-tags | restore\n' "$0" >&2
  exit 2
}

case ${1:-} in
  status) print_status ;;
  install|install-tags) install_tags ;;
  install-guard) install_guard ;;
  install-guard-tags) install_guard_tags ;;
  install-traps) install_state_object_traps ;;
  install-noop-fix) install_noop_fix ;;
  install-return-trap) install_state_object_return_trap ;;
  install-parser-phase-trap) install_state_object_parser_phase_trap ;;
  install-inheritance-trap) install_state_object_inheritance_result_trap ;;
  install-compile-store-traps) install_noop_fix_compile_export_store_traps ;;
  install-create-function-null-traps) install_noop_fix_create_function_null_traps ;;
  install-ir-link-fallback-traps) install_noop_fix_ir_link_fallback ;;
  restore) restore_pristine ;;
  *) usage ;;
esac

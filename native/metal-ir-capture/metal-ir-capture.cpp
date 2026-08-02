#include <CommonCrypto/CommonDigest.h>
#include <atomic>
#include <cctype>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <errno.h>
#include <exception>
#include <execinfo.h>
#include <fcntl.h>
#include <limits.h>
#include <new>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#ifndef YAAGL_CAPTURE_CONTRACT_TEST
#include <Security/SecRandom.h>
#endif
#include <poll.h>
#include <pthread.h>
#include <sched.h>
#include <string>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <vector>

#include "dxc-runtime.hpp"
#include "rt-output-observer.hpp"
#include "unorm24-transform.hpp"

struct IRCompiler;
struct IRObject;
struct IRError;
using CompileAndLink = IRObject *(*)(IRCompiler *,
                                     const std::vector<std::string> &,
                                     const IRObject *, IRError **);
using CreateDxilObject = IRObject *(*)(const char *, size_t);
using DestroyDxilObject = void (*)(IRObject *);

extern "C" IRObject *YaaglIRCompilerAllocCompileAndLinkProbe(
    IRCompiler *, const std::vector<std::string> &, const IRObject *, IRError **);

namespace {

constexpr const char *kMode = "metal-ir-capture-v2";
constexpr const char *kObserverMode = "metal-ir-observe-v1";
constexpr const char *kFunctionalMode = "metal-ir-unorm-fix-v2";
constexpr const char *kFunctionalObserverMode = "metal-ir-unorm-fix-v2-rt";
constexpr uintptr_t kGotOffset = 0x4ae1a0;
// The latest city-run waterfall observed the active compiler caller at
// +0x87ec9. The older RT export null path returned at +0x9a12f. Capture remains
// bound to the current caller; functional mode may inspect either exact site.
constexpr uintptr_t kConfiguredCallerOffset = 0x87ec9;
constexpr const char *kConfiguredOffsetText = "0x87ec9";
constexpr uintptr_t kHistoricalRtCallerOffset = 0x9a12f;
constexpr uintptr_t kComputeCompileBegin = 0x86e58;
constexpr uintptr_t kComputeCompileEnd = 0x871f7;
constexpr uintptr_t kGraphicsCompileBegin = 0x89188;
constexpr uintptr_t kGraphicsCompileEnd = 0x89ffd;
constexpr uintptr_t kRtCompileBegin = 0x996d8;
constexpr uintptr_t kRtCompileEnd = 0x9a23b;
constexpr uintptr_t kIrErrorCodeOffset = 0x8;
constexpr uint32_t kObserverObservationCap = 128;
constexpr uintptr_t kProviderExportOffset = 0x92fe30;
constexpr uintptr_t kProviderCreateDxilOffset = 0x931b40;
constexpr uintptr_t kProviderDestroyDxilOffset = 0x931b80;
constexpr uintptr_t kDxilVtableOffset = 0x14940e0;
constexpr uint32_t kFunctionalSourceBytes = 26964;
constexpr uint32_t kFunctionalReplacementBytes = 17720;
constexpr const char *kFunctionalSourceSha256 =
    "02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869";
constexpr const char *kFunctionalReplacementSha256 =
    "c64e67eabc3cf5ff89359c3075ebe00387c5a46d5136ea61dfbdd832b2f01717";
// Captured city-run InjectCache DXIL.  Unlike the generic UNORM transforms,
// its additional FP64 codecs are enabled only for this exact immutable source
// and still require the complete SSA/topology proof in the transformer.
constexpr uint32_t kInjectCacheSourceBytes = 33228;
constexpr const char *kInjectCacheSourceSha256 =
    "843be9c95dd09b3e4da739d67b91257495fb746da91b57eb52f859e682dd55ff";
constexpr const char *kDxcompilerSha256 =
    "57dc9421af62c35b372adf7536f07b1e2c20ef32dc1f4c16930a42fc12ed1fd2";
constexpr uint32_t kFunctionalObservationCap = 32;
constexpr uint32_t kFunctionalCacheCap = 32;
// Failed transforms are common for game shaders that contain no supported
// codec.  Keep their deterministic outcomes separate from replacement
// objects: this bounds repeated DXC disassembly without reducing the number
// of transformed shaders we can retain for the lifetime of the process.
constexpr uint32_t kFunctionalNegativeCacheCap = kFunctionalCacheCap;
constexpr size_t kFunctionalAssembledCap = 256 * 1024;
constexpr uint32_t kSlotCap = 32;
constexpr uint32_t kBlobCap = 32;
constexpr uint32_t kPayloadBytes = 65536;
constexpr uint32_t kArmMaxBytes = 4096;
constexpr uint64_t kAuthorizationWindowNs = 60ULL * 1000ULL * 1000ULL * 1000ULL;

enum RuntimeMode : uint8_t {
  kRuntimeNone = 0,
  kRuntimeCapture = 1,
  kRuntimeFunctional = 2,
  kRuntimeObserver = 3,
  kRuntimeFunctionalObserver = 4,
};
enum ProtocolState : uint8_t {
  kDormant = 0,
  kInstalledAcked = 1,
  kArmed = 2,
  kCapturing = 3,
  kDraining = 4,
  kTerminal = 5,
  kAuthClosed = 6,
};
enum CaptureFailure : uint8_t {
  kFailureNone = 0,
  kFailureInvalidObject = 1,
  kFailureUnreadable = 2,
  kFailureOversize = 3,
  kFailureSlotExhausted = 4,
  kFailureBlobExhausted = 5,
};
enum OriginalOutcome : uint8_t {
  kOutcomeReturnedNull = 0,
  kOutcomeReturnedNonNull = 1,
  kOutcomeUnwound = 2,
};
enum RecordState : uint8_t {
  kRecordFree = 0,
  kRecordFinal = 1,
  kRecordPersisted = 2,
};
enum TerminalReason : uint8_t {
  kTerminalNormal = 0,
  kTerminalProtocolInvalid = 1,
  kTerminalArmExpired = 2,
  kTerminalProtocolConflict = 3,
};

struct Blob {
  uint32_t size = 0;
  uint8_t digest[CC_SHA256_DIGEST_LENGTH]{};
  alignas(64) uint8_t bytes[kPayloadBytes]{};
};
struct Slot {
  uint64_t sequence = 0;
  uint32_t caller_offset = 0;
  uint32_t size = 0;
  CaptureFailure failure = kFailureNone;
  uint8_t digest[CC_SHA256_DIGEST_LENGTH]{};
  alignas(64) uint8_t bytes[kPayloadBytes]{};
};
struct Record {
  uint64_t sequence = 0;
  uint32_t caller_offset = 0;
  uint32_t size = 0;
  uint16_t blob = UINT16_MAX;
  CaptureFailure failure = kFailureNone;
  OriginalOutcome outcome = kOutcomeReturnedNull;
  uint8_t digest[CC_SHA256_DIGEST_LENGTH]{};
};
struct FunctionalCacheEntry {
  bool occupied = false;
  uint8_t source_digest[CC_SHA256_DIGEST_LENGTH]{};
  uint8_t output_digest[CC_SHA256_DIGEST_LENGTH]{};
  const uint8_t *bytes = nullptr;
  size_t size = 0;
  IRObject *object = nullptr;
  uint32_t graph_count = 0;
};
struct FunctionalNegativeCacheEntry {
  bool occupied = false;
  uint8_t source_digest[CC_SHA256_DIGEST_LENGTH]{};
  yaagl::metal_ir::Unorm24TransformStatus status =
      yaagl::metal_ir::Unorm24TransformStatus::kNoMatch;
  uint32_t graph_count = 0;
};
struct FunctionalSelection {
  const IRObject *object = nullptr;
  const char *kind = "original";
  const char *reason = "not_attempted";
  uint32_t graph_count = 0;
  size_t output_size = 0;
  bool has_output_digest = false;
  uint8_t output_digest[CC_SHA256_DIGEST_LENGTH]{};
};
struct ControlBlock {
  // bit 0 admits new wrappers; bits 32..63 count admitted wrappers.
  std::atomic<uint64_t> admission_refcount{1};
  std::atomic<CompileAndLink> original{nullptr};
};
struct ArmMessage {
  uint64_t schema = 0;
  uint64_t uid = 0;
  uint64_t pid = 0;
  char mode[32]{};
  char state[16]{};
  char nonce[33]{};
  char ack_sha256[65]{};
};
enum ArmCheck : uint8_t { kArmMissing = 0, kArmAccepted = 1, kArmInvalid = 2 };

std::atomic<CompileAndLink> g_original{nullptr};
ControlBlock g_control;
std::atomic_flag g_capture_lock = ATOMIC_FLAG_INIT;
std::atomic_flag g_install_lock = ATOMIC_FLAG_INIT;
std::atomic_flag g_terminal_lock = ATOMIC_FLAG_INIT;
std::atomic<uint8_t> g_runtime_mode{kRuntimeNone};
std::atomic<uint8_t> g_protocol_state{kDormant};
std::atomic<bool> g_initialized{false};
std::atomic<bool> g_functional_ready{false};
std::atomic<bool> g_functional_identity_logged{false};
std::atomic<bool> g_functional_success_logged{false};
std::atomic<uint32_t> g_functional_observations{0};
std::atomic<uint32_t> g_functional_matches{0};
std::atomic<uint32_t> g_functional_successes{0};
std::atomic<uint32_t> g_functional_error19{0};
std::atomic<uint32_t> g_observer_observations{0};
std::atomic<uint32_t> g_observer_error19{0};
std::atomic<uint32_t> g_observer_exports{0};
std::atomic<bool> g_rt_output_observer_installed{false};
std::atomic<bool> g_compute_correlation_observer_installed{false};
pthread_mutex_t g_functional_mutex = PTHREAD_MUTEX_INITIALIZER;
uint32_t g_functional_cache_count = 0;
FunctionalCacheEntry g_functional_cache[kFunctionalCacheCap];
uint32_t g_functional_negative_cache_count = 0;
FunctionalNegativeCacheEntry
    g_functional_negative_cache[kFunctionalNegativeCacheCap];
yaagl::dxc::Runtime *g_dxc_runtime = nullptr;
std::atomic<bool> g_instance_sealed{false};
std::atomic<bool> g_ack_written{false};
std::atomic<bool> g_terminal_written{false};
std::atomic<bool> g_stop{false};
std::atomic<bool> g_producers_stopped{false};
std::atomic<bool> g_worker_started{false};
std::atomic<bool> g_control_started{false};
std::atomic<bool> g_lifecycle_started{false};
std::atomic<uint64_t> g_image_generation{0};
std::atomic<bool> g_got_restored{false};
std::atomic<bool> g_restore_failed{false};
std::atomic<bool> g_publication_failed{false};
std::atomic<bool> g_auth_timeout{false};
std::atomic<bool> g_install_verified{false};
std::atomic<bool> g_install_readback_ok{false};
std::atomic<bool> g_install_protection_restored{false};
std::atomic<uint32_t> g_in_flight{0};
std::atomic<uint32_t> g_slots_claimed{0};
std::atomic<uint32_t> g_record_count{0};
std::atomic<uint32_t> g_records_persisted{0};
std::atomic<uint32_t> g_blob_count{0};
std::atomic<uint32_t> g_original_calls{0};
std::atomic<uint32_t> g_returned_null{0};
std::atomic<uint32_t> g_returned_nonnull{0};
std::atomic<uint32_t> g_unwound{0};
std::atomic<uint32_t> g_oversize_failures{0};
std::atomic<uint32_t> g_invalid_failures{0};
std::atomic<uint32_t> g_unreadable_failures{0};
std::atomic<uint32_t> g_slot_exhausted_failures{0};
std::atomic<uint32_t> g_blob_exhausted_failures{0};
std::atomic<uint32_t> g_exact_offset_matches{0};
std::atomic<uint64_t> g_auth_started_ns{0};
std::atomic<uint8_t> g_terminal_reason{kTerminalNormal};
std::atomic<uint8_t> g_record_state[kSlotCap]{};
std::atomic<uint8_t> g_blob_written[kBlobCap]{};
Slot g_slots[kSlotCap];
Blob g_blobs[kBlobCap];
Record g_records[kSlotCap];
thread_local Slot g_functional_scratch;
thread_local Slot g_observer_scratch;

const mach_header_64 *g_d3dmetal = nullptr;
const uint8_t *g_functional_replacement_bytes = nullptr;
size_t g_functional_replacement_size = 0;
IRObject *g_functional_replacement_object = nullptr;
const mach_header_64 *g_provider = nullptr;
CompileAndLink *g_slot = nullptr;
vm_prot_t g_slot_protection = VM_PROT_NONE;
pthread_t g_worker_thread{};
pthread_t g_control_thread{};
pthread_t g_lifecycle_thread{};
int g_pipe[2] = {-1, -1};
int g_log = -1;
int g_root_fd = -1;
int g_instances_fd = -1;
int g_instance_fd = -1;
int g_acks_fd = -1;
int g_arms_fd = -1;
int g_controls_fd = -1;
char g_session_root[PATH_MAX]{};
char g_instance_id[128]{};
char g_instance_dir[PATH_MAX]{};
char g_run_id[128]{};
char g_attempt_id[128]{};
char g_nonce[33]{};
char g_ack_token[256]{};
char g_ack_raw_sha256[65]{};
char g_ack_leaf[192]{};
char g_arm_leaf[192]{};
char g_stop_leaf[192]{};
char g_d3dmetal_identity[PATH_MAX]{};
char g_provider_identity[PATH_MAX]{};
char g_manifest_rel[PATH_MAX]{};
char g_artifact_dir_rel[PATH_MAX]{};
char g_capture_sha256[65]{};
char g_d3dmetal_sha256[65]{};
char g_provider_sha256[65]{};
char g_functional_capture_path[PATH_MAX]{};
char g_process_executable[PATH_MAX]{};
char g_configured_game_executable[PATH_MAX]{};
char g_got_slot[64]{};
bool g_constructor_fixture = false;
uintptr_t g_fixture_got_offset = 0;

void *worker(void *);
void *control(void *);
void *lifecycle(void *);
bool restoreGot();
bool writeTerminalOnce();
bool makeInstance();
void beginDrain();

void logLine(const char *line) {
  if (g_log >= 0) {
    (void)::write(g_log, line, std::strlen(line));
    (void)fsync(g_log);
  }
}
void logFormat(const char *format, ...) {
  if (g_log < 0 || !format)
    return;
  char line[2048]{};
  va_list args;
  va_start(args, format);
  const int length = vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  if (length <= 0 || static_cast<size_t>(length) >= sizeof(line))
    return;
  logLine(line);
}
void rtOutputLog(const char *line) { logLine(line); }
uint64_t realtimeNanos() {
  timespec value{};
  if (clock_gettime(CLOCK_REALTIME, &value) != 0)
    return 0;
  return static_cast<uint64_t>(value.tv_sec) * 1000000000ULL +
         static_cast<uint64_t>(value.tv_nsec);
}
uint64_t currentThreadId() {
  uint64_t value = 0;
  (void)pthread_threadid_np(nullptr, &value);
  return value;
}

bool validId(const char *text) {
  if (!text || !*text || std::strlen(text) >= sizeof(g_instance_id))
    return false;
  for (const unsigned char *p = reinterpret_cast<const unsigned char *>(text);
       *p; ++p)
    if (!(std::isalnum(*p) || *p == '_' || *p == '-'))
      return false;
  return true;
}
bool validProtocolText(const char *text, size_t cap) {
  if (!text || !*text || std::strlen(text) >= cap)
    return false;
  for (const unsigned char *p = reinterpret_cast<const unsigned char *>(text);
       *p; ++p)
    if (*p < 0x20)
      return false;
  return true;
}
bool joinPath(char *out, size_t cap, const char *a, const char *b) {
  int n = snprintf(out, cap, "%s/%s", a, b);
  return n > 0 && static_cast<size_t>(n) < cap;
}
bool hexBytes(const uint8_t *bytes, size_t size, char *out, size_t cap) {
  if (!bytes || cap < size * 2 + 1)
    return false;
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < size; ++i) {
    out[i * 2] = hex[bytes[i] >> 4];
    out[i * 2 + 1] = hex[bytes[i] & 0xf];
  }
  out[size * 2] = 0;
  return true;
}
bool digest(const void *data, size_t size, uint8_t output[32]) {
  return data && size <= UINT32_MAX &&
         CC_SHA256(data, static_cast<CC_LONG>(size), output) != nullptr;
}
bool digestMatches(const uint8_t value[32], const char *expected) {
  char hex[65]{};
  return value && expected && hexBytes(value, 32, hex, sizeof(hex)) &&
         std::strcmp(hex, expected) == 0;
}
bool fileDigestMatches(const char *path, const char *expected) {
  if (!path || !*path || !expected)
    return false;
  int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return false;
  struct stat status{};
  bool ok = fstat(fd, &status) == 0 && S_ISREG(status.st_mode) &&
            status.st_size > 0 && status.st_size <= UINT32_MAX;
  void *mapping = ok ? mmap(nullptr, static_cast<size_t>(status.st_size),
                            PROT_READ, MAP_PRIVATE, fd, 0)
                     : MAP_FAILED;
  if (close(fd) != 0)
    ok = false;
  uint8_t value[32]{};
  if (!ok || mapping == MAP_FAILED ||
      !digest(mapping, static_cast<size_t>(status.st_size), value) ||
      !digestMatches(value, expected))
    ok = false;
  if (mapping != MAP_FAILED)
    (void)munmap(mapping, static_cast<size_t>(status.st_size));
  return ok;
}
bool matchesFunctionalSource(uint32_t size, const uint8_t value[32]) {
  return size == kFunctionalSourceBytes &&
         digestMatches(value, kFunctionalSourceSha256);
}
bool matchesInjectCacheSource(uint32_t size, const uint8_t value[32]) {
  return size == kInjectCacheSourceBytes &&
         digestMatches(value, kInjectCacheSourceSha256);
}
RuntimeMode runtimeMode() {
  return static_cast<RuntimeMode>(g_runtime_mode.load(std::memory_order_acquire));
}
bool isLowerHex64(const char *value) {
  if (!value || std::strlen(value) != 64)
    return false;
  for (size_t i = 0; i < 64; ++i)
    if (!((value[i] >= '0' && value[i] <= '9') ||
          (value[i] >= 'a' && value[i] <= 'f')))
      return false;
  return true;
}
bool isLowerHex32(const char *value) {
  if (!value || std::strlen(value) != 32)
    return false;
  for (size_t i = 0; i < 32; ++i)
    if (!((value[i] >= '0' && value[i] <= '9') ||
          (value[i] >= 'a' && value[i] <= 'f')))
      return false;
  return true;
}
uint64_t monotonicNanos() {
  static mach_timebase_info_data_t timebase = [] {
    mach_timebase_info_data_t result{};
    (void)mach_timebase_info(&result);
    return result;
  }();
  const uint64_t ticks = mach_absolute_time();
  return timebase.denom == 0 ? ticks :
      ticks * static_cast<uint64_t>(timebase.numer) / timebase.denom;
}
void copyEnv(char *dst, size_t cap, const char *name) {
  if (!dst || cap == 0)
    return;
  const char *value = getenv(name);
  if (!value)
    return;
  std::strncpy(dst, value, cap - 1);
  dst[cap - 1] = 0;
}
bool generateNonce() {
  uint8_t bytes[16]{};
#ifndef YAAGL_CAPTURE_CONTRACT_TEST
  if (SecRandomCopyBytes(kSecRandomDefault, sizeof(bytes), bytes) != 0)
    return false;
#else
  int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  bool ok = fd >= 0 && read(fd, bytes, sizeof(bytes)) == sizeof(bytes);
  if (fd >= 0)
    close(fd);
  if (!ok)
    return false;
#endif
  return hexBytes(bytes, sizeof(bytes), g_nonce, sizeof(g_nonce));
}
bool generateInstanceId() {
  uint8_t bytes[16]{};
  int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  bool ok = fd >= 0 && read(fd, bytes, sizeof(bytes)) == sizeof(bytes);
  if (fd >= 0)
    close(fd);
  if (!ok)
    return false;
  char random[33]{};
  if (!hexBytes(bytes, sizeof(bytes), random, sizeof(random)))
    return false;
  int n = snprintf(g_instance_id, sizeof(g_instance_id), "%08x-%s",
                   static_cast<unsigned>(getpid()), random);
  return n > 0 && static_cast<size_t>(n) < sizeof(g_instance_id) &&
         validId(g_instance_id);
}
bool fsyncDirectoryFd(int fd) { return fd >= 0 && fsync(fd) == 0; }
bool directoryAt(int parent, const char *name, int *output) {
  if (!name || !*name || !output)
    return false;
  struct stat existing{};
  if (fstatat(parent, name, &existing, AT_SYMLINK_NOFOLLOW) != 0) {
    if (errno != ENOENT || mkdirat(parent, name, 0700) != 0)
      return false;
  } else if (!S_ISDIR(existing.st_mode)) {
    errno = ENOTDIR;
    return false;
  }
  int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return false;
  struct stat verified{};
  bool ok = fstat(fd, &verified) == 0 && S_ISDIR(verified.st_mode);
  if (!ok) {
    close(fd);
    return false;
  }
  *output = fd;
  return true;
}
bool createDirectoryAt(int parent, const char *name, int *output) {
  struct stat existing{};
  if (fstatat(parent, name, &existing, AT_SYMLINK_NOFOLLOW) == 0) {
    errno = EEXIST;
    return false;
  }
  if (errno != ENOENT || mkdirat(parent, name, 0700) != 0)
    return false;
  return directoryAt(parent, name, output);
}
bool writeAll(int fd, const void *data, size_t size) {
  const uint8_t *cursor = reinterpret_cast<const uint8_t *>(data);
  while (size) {
    ssize_t written = write(fd, cursor, size);
    if (written < 0) {
      if (errno == EINTR)
        continue;
      return false;
    }
    if (written == 0)
      return false;
    cursor += written;
    size -= static_cast<size_t>(written);
  }
  return true;
}
bool exportFunctionalSource(const Slot &slot, const char *digestHex,
                            char *path, size_t pathCapacity) {
  if (!digestHex || !path || pathCapacity == 0 ||
      !g_functional_capture_path[0] || slot.size == 0)
    return false;
  const int length = snprintf(path, pathCapacity, "%s.source-%s.dxil",
                              g_functional_capture_path, digestHex);
  if (length <= 0 || static_cast<size_t>(length) >= pathCapacity)
    return false;
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                0600);
  if (fd < 0)
    return errno == EEXIST;
  bool ok = writeAll(fd, slot.bytes, slot.size) && fsync(fd) == 0;
  if (close(fd) != 0)
    ok = false;
  if (!ok)
    (void)unlink(path);
  return ok;
}
bool renameExclusiveAt(int parent, const char *temporary, const char *leaf) {
  struct stat existing{};
  if (fstatat(parent, leaf, &existing, AT_SYMLINK_NOFOLLOW) == 0) {
    errno = EEXIST;
    return false;
  }
  if (errno != ENOENT)
    return false;
  return renameatx_np(parent, temporary, parent, leaf, RENAME_EXCL) == 0;
}
bool writeImmutableAt(int parent, const char *leaf, const void *data,
                      size_t size) {
  if (parent < 0 || !leaf || !*leaf || !data)
    return false;
  char temporary[NAME_MAX + 1]{};
  int n = snprintf(temporary, sizeof(temporary), ".%s.%d", leaf, getpid());
  if (n <= 0 || static_cast<size_t>(n) >= sizeof(temporary))
    return false;
  int fd = openat(parent, temporary,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0)
    return false;
  bool ok = writeAll(fd, data, size) && fsync(fd) == 0;
  if (close(fd) != 0)
    ok = false;
  if (ok)
    ok = renameExclusiveAt(parent, temporary, leaf);
  if (!ok)
    (void)unlinkat(parent, temporary, 0);
  if (ok)
    ok = fsyncDirectoryFd(parent);
  return ok;
}

bool appendText(char *buffer, size_t cap, size_t *at, const char *text) {
  size_t length = std::strlen(text);
  if (*at + length >= cap)
    return false;
  std::memcpy(buffer + *at, text, length);
  *at += length;
  buffer[*at] = 0;
  return true;
}
bool appendUint(char *buffer, size_t cap, size_t *at, uint64_t value) {
  char number[32]{};
  int n = snprintf(number, sizeof(number), "%llu",
                   static_cast<unsigned long long>(value));
  return n > 0 && static_cast<size_t>(n) < sizeof(number) &&
         appendText(buffer, cap, at, number);
}
bool appendQuoted(char *buffer, size_t cap, size_t *at, const char *text) {
  if (!appendText(buffer, cap, at, "\""))
    return false;
  for (const unsigned char *p = reinterpret_cast<const unsigned char *>(text);
       *p; ++p) {
    if (*p < 0x20)
      return false;
    if (*p == '\"' || *p == '\\') {
      if (*at + 2 >= cap)
        return false;
      buffer[(*at)++] = '\\';
    } else if (*at + 1 >= cap) {
      return false;
    }
    buffer[(*at)++] = static_cast<char>(*p);
  }
  if (*at + 2 >= cap)
    return false;
  buffer[(*at)++] = '\"';
  buffer[*at] = 0;
  return true;
}
bool prepareSession() {
  const char *root = getenv("YAAGL_METAL_IR_SESSION_ROOT");
  if (!root || !*root || std::strlen(root) >= sizeof(g_session_root) ||
      !generateInstanceId())
    return false;
  g_root_fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (g_root_fd < 0)
    return false;
  if (!directoryAt(g_root_fd, "instances", &g_instances_fd) ||
      !directoryAt(g_root_fd, "acks", &g_acks_fd) ||
      !directoryAt(g_root_fd, "arms", &g_arms_fd) ||
      !directoryAt(g_root_fd, "controls", &g_controls_fd))
    return false;
  std::strncpy(g_session_root, root, sizeof(g_session_root) - 1);
  char instancesPath[PATH_MAX]{};
  const int artifactLength =
      snprintf(g_artifact_dir_rel, sizeof(g_artifact_dir_rel), "instances/%s",
               g_instance_id);
  if (!joinPath(instancesPath, sizeof(instancesPath), root, "instances") ||
      !joinPath(g_instance_dir, sizeof(g_instance_dir), instancesPath,
                g_instance_id) || artifactLength <= 0 ||
      static_cast<size_t>(artifactLength) >= sizeof(g_artifact_dir_rel) ||
      !joinPath(g_manifest_rel, sizeof(g_manifest_rel), g_artifact_dir_rel,
                "terminal.json"))
    return false;
  return true;
}
bool makeInstance() {
  if (g_instance_sealed.load(std::memory_order_acquire))
    return true;
  if (g_instances_fd < 0 || !validId(g_instance_id) ||
      !createDirectoryAt(g_instances_fd, g_instance_id, &g_instance_fd))
    return false;
  char body[2048]{};
  size_t at = 0;
  bool ok = appendText(body, sizeof(body), &at,
                       "{\"schema\":2,\"kind\":\"instance\",\"mode\":\"") &&
            appendText(body, sizeof(body), &at, kMode) &&
            appendText(body, sizeof(body), &at, "\",\"instance_id\":") &&
            appendQuoted(body, sizeof(body), &at, g_instance_id) &&
            appendText(body, sizeof(body), &at, ",\"run_id\":") &&
            appendQuoted(body, sizeof(body), &at, g_run_id) &&
            appendText(body, sizeof(body), &at, ",\"attempt_id\":") &&
            appendQuoted(body, sizeof(body), &at, g_attempt_id) &&
            appendText(body, sizeof(body), &at, ",\"configured_offset\":") &&
            appendQuoted(body, sizeof(body), &at, kConfiguredOffsetText) &&
            appendText(body, sizeof(body), &at,
                       ",\"target_predicate\":\"exact-offset-precall-dxil\"}");
  if (!ok || !writeImmutableAt(g_instance_fd, "instance.json", body, at))
    return false;
  at = 0;
  ok = appendText(body, sizeof(body), &at,
                  "{\"schema\":2,\"kind\":\"manifest\",\"instance_id\":") &&
       appendQuoted(body, sizeof(body), &at, g_instance_id) &&
       appendText(body, sizeof(body), &at, ",\"artifact_dir_rel\":") &&
       appendQuoted(body, sizeof(body), &at, g_artifact_dir_rel) &&
       appendText(body, sizeof(body), &at,
                  ",\"configured_offset\":\"0x87ec9\",\"target_predicate\":\"exact-offset-precall-dxil\"}");
  if (!ok || !writeImmutableAt(g_instance_fd, "manifest.json", body, at))
    return false;
  g_instance_sealed.store(true, std::memory_order_release);
  return true;
}

bool enterWrapper(CompileAndLink *out) {
  for (;;) {
    uint64_t observed =
        g_control.admission_refcount.load(std::memory_order_acquire);
    if ((observed & 1U) == 0)
      return false;
    const uint64_t desired = observed + (uint64_t(1) << 32);
    if (!g_control.admission_refcount.compare_exchange_weak(
            observed, desired, std::memory_order_acq_rel,
            std::memory_order_acquire))
      continue;
    g_in_flight.fetch_add(1, std::memory_order_acq_rel);
    if (g_control.admission_refcount.load(std::memory_order_acquire) & 1U) {
      *out = g_control.original.load(std::memory_order_acquire);
      if (*out)
        return true;
    }
    g_control.admission_refcount.fetch_sub(uint64_t(1) << 32,
                                           std::memory_order_acq_rel);
    g_in_flight.fetch_sub(1, std::memory_order_acq_rel);
    return false;
  }
}
void leaveWrapper() {
  g_control.admission_refcount.fetch_sub(uint64_t(1) << 32,
                                         std::memory_order_acq_rel);
  g_in_flight.fetch_sub(1, std::memory_order_acq_rel);
}
bool image(const mach_header_64 *header) {
  return header && header->magic == MH_MAGIC_64 &&
         header->cputype == CPU_TYPE_X86_64;
}
size_t textSize(const mach_header_64 *header) {
  if (!header)
    return 0;
  const uint8_t *cursor = reinterpret_cast<const uint8_t *>(header) +
                          sizeof(*header);
  for (uint32_t i = 0; i < header->ncmds; ++i) {
    const auto *command = reinterpret_cast<const load_command *>(cursor);
    if (command->cmd == LC_SEGMENT_64) {
      const auto *segment = reinterpret_cast<const segment_command_64 *>(cursor);
      if (std::strncmp(segment->segname, "__TEXT", 16) == 0)
        return static_cast<size_t>(segment->vmsize);
    }
    if (command->cmdsize < sizeof(load_command))
      return 0;
    cursor += command->cmdsize;
  }
  return 0;
}
bool isConfiguredCallerOffset(uintptr_t caller, uintptr_t base) {
  return caller >= base && caller - base == kConfiguredCallerOffset;
}
bool isFunctionalCallerOffset(uintptr_t caller, uintptr_t base) {
  if (caller < base)
    return false;
  const uintptr_t offset = caller - base;
  return offset == kConfiguredCallerOffset ||
         offset == kHistoricalRtCallerOffset;
}
bool protection(void *pointer, vm_prot_t *output) {
  vm_address_t address = reinterpret_cast<vm_address_t>(pointer);
  vm_size_t size = 0;
  vm_region_basic_info_data_64_t info{};
  mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
  mach_port_t object = MACH_PORT_NULL;
  if (vm_region_64(mach_task_self(), &address, &size, VM_REGION_BASIC_INFO_64,
                   reinterpret_cast<vm_region_info_t>(&info), &count,
                   &object) != KERN_SUCCESS)
    return false;
  *output = info.protection;
  return true;
}
bool protect(void *pointer, vm_prot_t prot) {
  vm_address_t address = reinterpret_cast<vm_address_t>(pointer) &
                         ~static_cast<vm_address_t>(getpagesize() - 1);
  return vm_protect(mach_task_self(), address, getpagesize(), false, prot) ==
         KERN_SUCCESS;
}
bool parseFixtureOffset(const char *name, uintptr_t *value) {
  const char *text = getenv(name);
  if (!text || !*text || !value)
    return false;
  char *end = nullptr;
  errno = 0;
  const unsigned long long parsed = std::strtoull(text, &end, 0);
  if (errno != 0 || !end || *end != 0 || parsed == 0)
    return false;
  *value = static_cast<uintptr_t>(parsed);
  return true;
}
bool imagesReady() {
  const char *d3dmetal = getenv("YAAGL_METAL_IR_D3DMETAL");
  const char *provider = getenv("YAAGL_METAL_IR_PROVIDER");
  if (!d3dmetal || !provider) {
    logLine("probe missing image paths\n");
    return false;
  }
  const mach_header_64 *d3dmetalImage = nullptr;
  const mach_header_64 *providerImage = nullptr;
  for (uint32_t i = 0; i < _dyld_image_count(); ++i) {
    const char *name = _dyld_get_image_name(i);
    if (name && std::strcmp(name, d3dmetal) == 0)
      d3dmetalImage = reinterpret_cast<const mach_header_64 *>(
          _dyld_get_image_header(i));
    if (name && std::strcmp(name, provider) == 0)
      providerImage = reinterpret_cast<const mach_header_64 *>(
          _dyld_get_image_header(i));
  }
  return image(d3dmetalImage) && image(providerImage);
}
void destroyDxilObject(IRObject *object) {
  if (!object || !g_provider)
    return;
  const auto destroy = reinterpret_cast<DestroyDxilObject>(
      reinterpret_cast<uintptr_t>(g_provider) + kProviderDestroyDxilOffset);
  destroy(object);
}
bool createBorrowedDxilObject(const uint8_t *bytes, size_t size,
                              IRObject **output) {
  if (!bytes || size == 0 || size > UINT32_MAX || !output || !g_provider)
    return false;
  *output = nullptr;
  const auto create = reinterpret_cast<CreateDxilObject>(
      reinterpret_cast<uintptr_t>(g_provider) + kProviderCreateDxilOffset);
  IRObject *object = create(reinterpret_cast<const char *>(bytes), size);
  uint8_t header[0x20]{};
  vm_size_t copied = 0;
  if (!object ||
      vm_read_overwrite(mach_task_self(),
                        reinterpret_cast<vm_address_t>(object), sizeof(header),
                        reinterpret_cast<vm_address_t>(header), &copied) !=
          KERN_SUCCESS ||
      copied != sizeof(header)) {
    destroyDxilObject(object);
    return false;
  }
  const void *vtable = nullptr;
  const uint8_t *storedBytes = nullptr;
  uint32_t storedSize = 0;
  uint8_t type = 0;
  uint8_t owns = 1;
  std::memcpy(&vtable, header, sizeof(vtable));
  std::memcpy(&storedBytes, header + 0x10, sizeof(storedBytes));
  std::memcpy(&storedSize, header + 0x18, sizeof(storedSize));
  std::memcpy(&type, header + 0x1c, sizeof(type));
  std::memcpy(&owns, header + 0x1d, sizeof(owns));
  const void *expectedVtable = reinterpret_cast<const uint8_t *>(g_provider) +
                               kDxilVtableOffset;
  if (vtable != expectedVtable || storedBytes != bytes ||
      storedSize != static_cast<uint32_t>(size) || type != 2 || owns != 0) {
    destroyDxilObject(object);
    return false;
  }
  *output = object;
  return true;
}
bool createPersistentDxilObject(const void *bytes, size_t size,
                                const uint8_t **mappingOutput,
                                IRObject **objectOutput) {
  if (!bytes || size == 0 || size > kFunctionalAssembledCap ||
      !mappingOutput || !objectOutput)
    return false;
  *mappingOutput = nullptr;
  *objectOutput = nullptr;
  void *mapping = mmap(nullptr, size, PROT_READ | PROT_WRITE,
                       MAP_PRIVATE | MAP_ANON, -1, 0);
  if (mapping == MAP_FAILED)
    return false;
  std::memcpy(mapping, bytes, size);
  if (mprotect(mapping, size, PROT_READ) != 0) {
    (void)munmap(mapping, size);
    return false;
  }
  IRObject *object = nullptr;
  if (!createBorrowedDxilObject(reinterpret_cast<const uint8_t *>(mapping),
                                size, &object)) {
    (void)munmap(mapping, size);
    return false;
  }
  *mappingOutput = reinterpret_cast<const uint8_t *>(mapping);
  *objectOutput = object;
  return true;
}
bool loadFunctionalReplacement() {
  if (g_functional_ready.load(std::memory_order_acquire))
    return true;
  const char *replacementPath = getenv("YAAGL_METAL_IR_REPLACEMENT");
  const char *dxcompilerPath = getenv("YAAGL_METAL_IR_DXCOMPILER");
  if (!replacementPath || !*replacementPath || !dxcompilerPath ||
      !*dxcompilerPath || !g_provider ||
      !fileDigestMatches(dxcompilerPath, kDxcompilerSha256))
    return false;

  auto *runtime = new (std::nothrow) yaagl::dxc::Runtime();
  if (!runtime || !runtime->open(dxcompilerPath)) {
    delete runtime;
    return false;
  }

  int fd = open(replacementPath, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) {
    delete runtime;
    return false;
  }
  struct stat status{};
  bool ok = fstat(fd, &status) == 0 && S_ISREG(status.st_mode) &&
            status.st_size == static_cast<off_t>(kFunctionalReplacementBytes);
  void *mapping = ok ? mmap(nullptr, kFunctionalReplacementBytes, PROT_READ,
                            MAP_PRIVATE, fd, 0)
                     : MAP_FAILED;
  if (close(fd) != 0)
    ok = false;
  uint8_t replacementDigest[32]{};
  if (!ok || mapping == MAP_FAILED ||
      !digest(mapping, kFunctionalReplacementBytes, replacementDigest) ||
      !digestMatches(replacementDigest, kFunctionalReplacementSha256)) {
    if (mapping != MAP_FAILED)
      (void)munmap(mapping, kFunctionalReplacementBytes);
    delete runtime;
    return false;
  }

  IRObject *replacement = nullptr;
  if (!createBorrowedDxilObject(
          reinterpret_cast<const uint8_t *>(mapping),
          kFunctionalReplacementBytes, &replacement)) {
    (void)munmap(mapping, kFunctionalReplacementBytes);
    delete runtime;
    return false;
  }

  // Provider IR objects borrow their DXIL byte storage. Keep both the exact
  // control replacement and every structurally transformed object alive until
  // process teardown; D3DMetal may retain them after CompileAndLink returns.
  g_functional_replacement_bytes =
      reinterpret_cast<const uint8_t *>(mapping);
  g_functional_replacement_size = kFunctionalReplacementBytes;
  g_functional_replacement_object = replacement;
  g_dxc_runtime = runtime;
  g_functional_ready.store(true, std::memory_order_release);
  logFormat("probe dxcompiler-sha256=%s\n", kDxcompilerSha256);
  return true;
}
bool install() {
  if (g_install_lock.test_and_set(std::memory_order_acquire))
    return g_install_verified.load(std::memory_order_acquire);
  struct Guard {
    ~Guard() { g_install_lock.clear(std::memory_order_release); }
  } guard;
  if (g_slot)
    return g_install_verified.load(std::memory_order_acquire);
  const char *d3dmetal = getenv("YAAGL_METAL_IR_D3DMETAL");
  const char *provider = getenv("YAAGL_METAL_IR_PROVIDER");
  if (!d3dmetal || !provider)
    return false;
  for (uint32_t i = 0; i < _dyld_image_count(); ++i) {
    const char *name = _dyld_get_image_name(i);
    if (name && std::strcmp(name, d3dmetal) == 0)
      g_d3dmetal = reinterpret_cast<const mach_header_64 *>(_dyld_get_image_header(i));
    if (name && std::strcmp(name, provider) == 0)
      g_provider = reinterpret_cast<const mach_header_64 *>(_dyld_get_image_header(i));
  }
  const RuntimeMode mode = runtimeMode();
  const bool combined = mode == kRuntimeFunctionalObserver;
  const bool functional = mode == kRuntimeFunctional || combined;
  const bool observer = mode == kRuntimeObserver;
  const bool outputObserver = observer || combined;
  const bool probeMode = functional || observer;
  if (!image(g_d3dmetal) || !image(g_provider)) {
    logFormat("%s image header missing\n",
              probeMode ? "probe" : "metal-ir-capture-v2");
    return false;
  }
  if (functional && !loadFunctionalReplacement()) {
    logLine("probe replacement-file-invalid\n");
    return false;
  }
  Dl_info d3dmetalInfo{};
  Dl_info providerInfo{};
  if (!dladdr(g_d3dmetal, &d3dmetalInfo) || !d3dmetalInfo.dli_fname ||
      !dladdr(g_provider, &providerInfo) || !providerInfo.dli_fname)
    return false;
  std::strncpy(g_d3dmetal_identity, d3dmetalInfo.dli_fname,
               sizeof(g_d3dmetal_identity) - 1);
  std::strncpy(g_provider_identity, providerInfo.dli_fname,
               sizeof(g_provider_identity) - 1);
  const uintptr_t slotOffset =
      g_constructor_fixture ? g_fixture_got_offset : kGotOffset;
  auto *slot = reinterpret_cast<CompileAndLink *>(
      reinterpret_cast<uintptr_t>(g_d3dmetal) + slotOffset);
  CompileAndLink expected = nullptr;
  if (g_constructor_fixture) {
    void *providerHandle = dlopen(provider, RTLD_NOW | RTLD_NOLOAD);
    expected = providerHandle
                   ? reinterpret_cast<CompileAndLink>(
                         dlsym(providerHandle, "IRCompilerAllocCompileAndLink"))
                   : nullptr;
  } else {
    expected = reinterpret_cast<CompileAndLink>(
        reinterpret_cast<uintptr_t>(g_provider) + kProviderExportOffset);
  }
  if (!expected) {
    logFormat("%s expected target missing\n",
              probeMode ? "probe" : "metal-ir-capture-v2");
    return false;
  }
  CompileAndLink observed = nullptr;
  __atomic_load(slot, &observed, __ATOMIC_ACQUIRE);
  if (observed != expected || !protection(slot, &g_slot_protection)) {
    logFormat("%s GOT precondition mismatch\n",
              probeMode ? "probe" : "metal-ir-capture-v2");
    return false;
  }
  if (!protect(slot, g_slot_protection | VM_PROT_WRITE)) {
    logFormat("%s GOT writable transition failed\n",
              probeMode ? "probe" : "metal-ir-capture-v2");
    return false;
  }
  CompileAndLink wrapper = &YaaglIRCompilerAllocCompileAndLinkProbe;
  char slotText[sizeof(g_got_slot)]{};
  const int slotLength = snprintf(
      slotText, sizeof(slotText), "0x%llx",
      static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(slot)));
  if (slotLength <= 0 || static_cast<size_t>(slotLength) >= sizeof(slotText)) {
    (void)protect(slot, g_slot_protection);
    logFormat("%s GOT slot formatting failed\n",
              probeMode ? "probe" : "metal-ir-capture-v2");
    return false;
  }
  // Publish the immutable pass-through and rollback target before the GOT can
  // ever point at the wrapper. These values remain valid through any post-CAS
  // rollback so a concurrently entering wrapper always has an original call.
  g_original.store(expected, std::memory_order_release);
  g_control.original.store(expected, std::memory_order_release);
  g_slot = slot;
  std::memcpy(g_got_slot, slotText, static_cast<size_t>(slotLength) + 1);
  if (!__atomic_compare_exchange(slot, &expected, &wrapper, false,
                                 __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {
    (void)protect(slot, g_slot_protection);
    g_slot = nullptr;
    g_original.store(nullptr, std::memory_order_release);
    g_control.original.store(nullptr, std::memory_order_release);
    return false;
  }
  __atomic_load(slot, &observed, __ATOMIC_ACQUIRE);
  const bool restored = protect(slot, g_slot_protection);
  const bool readback = observed == &YaaglIRCompilerAllocCompileAndLinkProbe;
  g_install_readback_ok.store(readback, std::memory_order_release);
  g_install_protection_restored.store(restored, std::memory_order_release);
  if (!readback || !restored) {
    // A failed post-CAS verification must not leave an untracked live hook.
    // Re-enter the writable state, restore the exact observed original, and
    // restore the original page protection before reporting failure.
    bool rolledBack = protect(slot, g_slot_protection | VM_PROT_WRITE);
    CompileAndLink installed = &YaaglIRCompilerAllocCompileAndLinkProbe;
    if (rolledBack)
      rolledBack = __atomic_compare_exchange(slot, &installed, &expected, false,
                                             __ATOMIC_ACQ_REL,
                                             __ATOMIC_ACQUIRE);
    if (!protect(slot, g_slot_protection))
      rolledBack = false;
    if (!rolledBack)
      g_restore_failed.store(true, std::memory_order_release);
    logFormat("%s GOT verification failed\n",
              probeMode ? "probe" : "metal-ir-capture-v2");
    return false;
  }
  g_install_verified.store(true, std::memory_order_release);
  bool rtInstalled = false;
  bool computeCorrelationInstalled = false;
  if (outputObserver) {
    rtInstalled = YaaglInstallRtOutputObserver(
        reinterpret_cast<uintptr_t>(g_d3dmetal), &rtOutputLog);
    computeCorrelationInstalled = YaaglInstallComputeCorrelationObserver(
        reinterpret_cast<uintptr_t>(g_d3dmetal), &rtOutputLog);
    g_rt_output_observer_installed.store(rtInstalled,
                                         std::memory_order_release);
    g_compute_correlation_observer_installed.store(
        computeCorrelationInstalled, std::memory_order_release);
  }
  if (observer) {
    logFormat("observer resolved=0x%llx\n",
              static_cast<unsigned long long>(
                  reinterpret_cast<uintptr_t>(expected)));
    logFormat("observer installed got=0x%llx mode=%s rt_output=%s compute_correlation=%s\n",
              static_cast<unsigned long long>(kGotOffset), kObserverMode,
              rtInstalled ? "installed" : "unavailable",
              computeCorrelationInstalled ? "installed" : "unavailable");
  } else if (functional) {
    const char *installedMode = mode == kRuntimeFunctionalObserver
                                    ? kFunctionalObserverMode
                                    : kFunctionalMode;
    logFormat("probe resolved=0x%llx\n",
              static_cast<unsigned long long>(
                  reinterpret_cast<uintptr_t>(expected)));
    logFormat("probe installed got=0x%llx mode=%s rt_output=%s compute_correlation=%s\n",
              static_cast<unsigned long long>(kGotOffset), installedMode,
              rtInstalled ? "installed" : "unavailable",
              computeCorrelationInstalled ? "installed" : "unavailable");
  }
  return true;
}
bool restoreGot() {
  if (!g_slot || !g_original.load(std::memory_order_acquire)) {
    g_got_restored.store(true, std::memory_order_release);
    return true;
  }
  if (!protect(g_slot, g_slot_protection | VM_PROT_WRITE))
    return false;
  CompileAndLink wrapper = &YaaglIRCompilerAllocCompileAndLinkProbe;
  CompileAndLink original = g_original.load(std::memory_order_acquire);
  CompileAndLink current = nullptr;
  __atomic_load(g_slot, &current, __ATOMIC_ACQUIRE);
  if (current == original) {
    if (!protect(g_slot, g_slot_protection))
      return false;
    g_got_restored.store(true, std::memory_order_release);
    return true;
  }
  bool ok = __atomic_compare_exchange(g_slot, &wrapper, &original, false,
                                      __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
  if (!protect(g_slot, g_slot_protection))
    ok = false;
  if (ok)
    g_got_restored.store(true, std::memory_order_release);
  return ok;
}

CaptureFailure snapshotObject(const IRObject *object, Slot *slot) {
  if (!object || !slot || !g_provider)
    return kFailureInvalidObject;
  uint8_t header[0x20]{};
  vm_size_t copied = 0;
  if (vm_read_overwrite(mach_task_self(), reinterpret_cast<vm_address_t>(object),
                        sizeof(header), reinterpret_cast<vm_address_t>(header),
                        &copied) != KERN_SUCCESS || copied != sizeof(header))
    return kFailureUnreadable;
  const void *vtable = nullptr;
  const uint8_t *bytes = nullptr;
  uint32_t size = 0;
  uint8_t type = 0;
  uint8_t owns = 1;
  std::memcpy(&vtable, header, sizeof(vtable));
  std::memcpy(&bytes, header + 0x10, sizeof(bytes));
  std::memcpy(&size, header + 0x18, sizeof(size));
  std::memcpy(&type, header + 0x1c, sizeof(type));
  std::memcpy(&owns, header + 0x1d, sizeof(owns));
  const void *expected = reinterpret_cast<const uint8_t *>(g_provider) +
                         kDxilVtableOffset;
  if ((!g_constructor_fixture &&
       (vtable != expected || type != 2 || owns != 0)) ||
      !bytes || size == 0)
    return kFailureInvalidObject;
  if (size > kPayloadBytes)
    return kFailureOversize;
  copied = 0;
  if (vm_read_overwrite(mach_task_self(), reinterpret_cast<vm_address_t>(bytes),
                        size, reinterpret_cast<vm_address_t>(slot->bytes),
                        &copied) != KERN_SUCCESS || copied != size)
    return kFailureUnreadable;
  slot->size = size;
  if (!digest(slot->bytes, size, slot->digest))
    return kFailureUnreadable;
  return kFailureNone;
}
void countFailure(CaptureFailure failure) {
  switch (failure) {
  case kFailureOversize:
    g_oversize_failures.fetch_add(1, std::memory_order_relaxed);
    break;
  case kFailureInvalidObject:
    g_invalid_failures.fetch_add(1, std::memory_order_relaxed);
    break;
  case kFailureUnreadable:
    g_unreadable_failures.fetch_add(1, std::memory_order_relaxed);
    break;
  case kFailureSlotExhausted:
    g_slot_exhausted_failures.fetch_add(1, std::memory_order_relaxed);
    break;
  case kFailureBlobExhausted:
    g_blob_exhausted_failures.fetch_add(1, std::memory_order_relaxed);
    break;
  case kFailureNone:
    break;
  }
}
int prepareSlot(const IRObject *object, uintptr_t caller, uint64_t sequence) {
  const uint32_t index = g_slots_claimed.fetch_add(1, std::memory_order_acq_rel);
  if (index >= kSlotCap) {
    countFailure(kFailureSlotExhausted);
    return -1;
  }
  while (g_capture_lock.test_and_set(std::memory_order_acquire))
    sched_yield();
  Slot &slot = g_slots[index];
  slot = Slot{};
  slot.sequence = sequence;
  slot.caller_offset = static_cast<uint32_t>(caller -
      reinterpret_cast<uintptr_t>(g_d3dmetal));
  slot.failure = snapshotObject(object, &slot);
  if (slot.failure != kFailureNone)
    countFailure(slot.failure);
  g_capture_lock.clear(std::memory_order_release);
  return static_cast<int>(index);
}
uint16_t internBlob(const Slot &slot, CaptureFailure *failure) {
  for (uint32_t i = 0; i < g_blob_count.load(std::memory_order_relaxed); ++i) {
    const Blob &blob = g_blobs[i];
    if (blob.size == slot.size && std::memcmp(blob.digest, slot.digest, 32) == 0 &&
        std::memcmp(blob.bytes, slot.bytes, slot.size) == 0)
      return static_cast<uint16_t>(i);
  }
  const uint32_t index = g_blob_count.load(std::memory_order_relaxed);
  if (index >= kBlobCap) {
    *failure = kFailureBlobExhausted;
    countFailure(*failure);
    return UINT16_MAX;
  }
  Blob &blob = g_blobs[index];
  blob.size = slot.size;
  std::memcpy(blob.digest, slot.digest, sizeof(blob.digest));
  std::memcpy(blob.bytes, slot.bytes, slot.size);
  g_blob_count.store(index + 1, std::memory_order_release);
  return static_cast<uint16_t>(index);
}
void wakeWorker() {
  uint8_t wake = 1;
  if (g_pipe[1] >= 0)
    (void)::write(g_pipe[1], &wake, sizeof(wake));
}
void finishSlot(int slotIndex, OriginalOutcome outcome) {
  if (slotIndex < 0 || static_cast<uint32_t>(slotIndex) >= kSlotCap)
    return;
  while (g_capture_lock.test_and_set(std::memory_order_acquire))
    sched_yield();
  const uint32_t recordIndex = g_record_count.load(std::memory_order_relaxed);
  if (recordIndex >= kSlotCap) {
    countFailure(kFailureSlotExhausted);
    g_capture_lock.clear(std::memory_order_release);
    return;
  }
  const Slot &slot = g_slots[slotIndex];
  Record &record = g_records[recordIndex];
  record = Record{};
  record.sequence = slot.sequence;
  record.caller_offset = slot.caller_offset;
  record.size = slot.size;
  record.failure = slot.failure;
  record.outcome = outcome;
  std::memcpy(record.digest, slot.digest, sizeof(record.digest));
  if (record.failure == kFailureNone)
    record.blob = internBlob(slot, &record.failure);
  std::atomic_thread_fence(std::memory_order_release);
  g_record_state[recordIndex].store(kRecordFinal, std::memory_order_release);
  g_record_count.store(recordIndex + 1, std::memory_order_release);
  g_capture_lock.clear(std::memory_order_release);
  wakeWorker();
}
const char *failureText(CaptureFailure failure) {
  switch (failure) {
  case kFailureNone: return "none";
  case kFailureInvalidObject: return "invalid_object";
  case kFailureUnreadable: return "unreadable";
  case kFailureOversize: return "oversize";
  case kFailureSlotExhausted: return "slot_exhausted";
  case kFailureBlobExhausted: return "blob_exhausted";
  }
  return "unknown";
}
const char *outcomeText(OriginalOutcome outcome) {
  switch (outcome) {
  case kOutcomeReturnedNull: return "returned_null";
  case kOutcomeReturnedNonNull: return "returned_nonnull";
  case kOutcomeUnwound: return "unwound";
  }
  return "unknown";
}
bool exportBlob(uint32_t index) {
  if (index >= g_blob_count.load(std::memory_order_acquire))
    return false;
  if (g_blob_written[index].load(std::memory_order_acquire))
    return true;
  const Blob &blob = g_blobs[index];
  char hex[65]{};
  char leaf[80]{};
  if (blob.size == 0 || !hexBytes(blob.digest, sizeof(blob.digest), hex,
                                  sizeof(hex)))
    return false;
  int n = snprintf(leaf, sizeof(leaf), "blob_%s.dxil", hex);
  if (n <= 0 || static_cast<size_t>(n) >= sizeof(leaf) ||
      !writeImmutableAt(g_instance_fd, leaf, blob.bytes, blob.size))
    return false;
  g_blob_written[index].store(1, std::memory_order_release);
  return true;
}
bool writeRecord(uint32_t index) {
  if (index >= g_record_count.load(std::memory_order_acquire) ||
      g_record_state[index].load(std::memory_order_acquire) != kRecordFinal)
    return false;
  const Record &record = g_records[index];
  if (record.failure == kFailureNone && !exportBlob(record.blob))
    return false;
  char body[2048]{};
  size_t at = 0;
  char digestHex[65]{};
  char blobLeaf[80]{};
  bool ok = appendText(body, sizeof(body), &at,
                       "{\"schema\":2,\"kind\":\"record\",\"sequence\":") &&
            appendUint(body, sizeof(body), &at, record.sequence) &&
            appendText(body, sizeof(body), &at, ",\"caller_offset\":") &&
            appendQuoted(body, sizeof(body), &at, kConfiguredOffsetText) &&
            appendText(body, sizeof(body), &at, ",\"original_outcome\":\"") &&
            appendText(body, sizeof(body), &at, outcomeText(record.outcome)) &&
            appendText(body, sizeof(body), &at, "\",\"capture\":{");
  if (record.failure == kFailureNone) {
    ok = ok && hexBytes(record.digest, sizeof(record.digest), digestHex,
                         sizeof(digestHex));
    int n = snprintf(blobLeaf, sizeof(blobLeaf), "blob_%s.dxil", digestHex);
    ok = ok && n > 0 && static_cast<size_t>(n) < sizeof(blobLeaf) &&
         appendText(body, sizeof(body), &at, "\"status\":\"captured\",\"blob\":") &&
         appendQuoted(body, sizeof(body), &at, blobLeaf) &&
         appendText(body, sizeof(body), &at, ",\"size\":") &&
         appendUint(body, sizeof(body), &at, record.size) &&
         appendText(body, sizeof(body), &at, ",\"sha256\":\"") &&
         appendText(body, sizeof(body), &at, digestHex) &&
         appendText(body, sizeof(body), &at, "\"");
  } else {
    ok = ok && appendText(body, sizeof(body), &at, "\"status\":\"failure\",\"reason\":\"") &&
         appendText(body, sizeof(body), &at, failureText(record.failure)) &&
         appendText(body, sizeof(body), &at, "\"");
  }
  ok = ok && appendText(body, sizeof(body), &at, "}}");
  char leaf[32]{};
  int n = snprintf(leaf, sizeof(leaf), "record_%02u.json", index);
  if (!ok || n <= 0 || static_cast<size_t>(n) >= sizeof(leaf) ||
      !writeImmutableAt(g_instance_fd, leaf, body, at))
    return false;
  g_record_state[index].store(kRecordPersisted, std::memory_order_release);
  g_records_persisted.fetch_add(1, std::memory_order_release);
  return true;
}

bool containsCaseInsensitive(const std::string &value, const char *token) {
  if (!token || !*token)
    return false;
  const size_t tokenLength = std::strlen(token);
  if (tokenLength > value.size())
    return false;
  for (size_t start = 0; start + tokenLength <= value.size(); ++start) {
    bool equal = true;
    for (size_t index = 0; index < tokenLength; ++index) {
      const unsigned char left = static_cast<unsigned char>(value[start + index]);
      const unsigned char right = static_cast<unsigned char>(token[index]);
      if (std::tolower(left) != std::tolower(right)) {
        equal = false;
        break;
      }
    }
    if (equal)
      return true;
  }
  return false;
}

const char *inferObserverStage(const std::vector<std::string> &args) {
  const size_t count = args.size() > 32 ? 32 : args.size();
  for (size_t index = 0; index < count; ++index) {
    const std::string &argument = args[index];
    if (containsCaseInsensitive(argument, "fragment") ||
        containsCaseInsensitive(argument, "pixel") ||
        containsCaseInsensitive(argument, "ps_"))
      return "fragment";
    if (containsCaseInsensitive(argument, "compute") ||
        containsCaseInsensitive(argument, "cs_"))
      return "compute";
    if (containsCaseInsensitive(argument, "vertex") ||
        containsCaseInsensitive(argument, "vs_"))
      return "vertex";
    if (containsCaseInsensitive(argument, "geometry") ||
        containsCaseInsensitive(argument, "gs_"))
      return "geometry";
    if (containsCaseInsensitive(argument, "hull") ||
        containsCaseInsensitive(argument, "hs_"))
      return "hull";
    if (containsCaseInsensitive(argument, "domain") ||
        containsCaseInsensitive(argument, "ds_"))
      return "domain";
    if (containsCaseInsensitive(argument, "raygeneration") ||
        containsCaseInsensitive(argument, "raygen"))
      return "raygeneration";
    if (containsCaseInsensitive(argument, "closesthit"))
      return "closesthit";
    if (containsCaseInsensitive(argument, "anyhit"))
      return "anyhit";
    if (containsCaseInsensitive(argument, "intersection"))
      return "intersection";
    if (containsCaseInsensitive(argument, "miss"))
      return "miss";
    if (containsCaseInsensitive(argument, "callable"))
      return "callable";
  }
  return "unknown";
}

bool observerOffsetInRange(uintptr_t offset, uintptr_t begin, uintptr_t end) {
  return offset >= begin && offset <= end;
}

const char *inferObserverContext(uintptr_t returnAddress, const char *stage,
                                 char *stackText, size_t stackCapacity) {
  if (stackText && stackCapacity)
    stackText[0] = 0;
  const uintptr_t base = reinterpret_cast<uintptr_t>(g_d3dmetal);
  if (!base || returnAddress < base)
    return "unknown";
  const uintptr_t directOffset = returnAddress - base;
  bool compute = false;
  bool graphics = false;
  bool rayTracing = directOffset == kHistoricalRtCallerOffset;
  void *frames[16]{};
  const int count = backtrace(frames, static_cast<int>(sizeof(frames) / sizeof(frames[0])));
  size_t used = 0;
  for (int index = 0; index < count; ++index) {
    const uintptr_t address = reinterpret_cast<uintptr_t>(frames[index]);
    if (address < base)
      continue;
    const uintptr_t offset = address - base;
    if (observerOffsetInRange(offset, kComputeCompileBegin, kComputeCompileEnd))
      compute = true;
    if (observerOffsetInRange(offset, kGraphicsCompileBegin, kGraphicsCompileEnd))
      graphics = true;
    if (observerOffsetInRange(offset, kRtCompileBegin, kRtCompileEnd))
      rayTracing = true;
    if (stackText && used < stackCapacity) {
      const int written = snprintf(stackText + used, stackCapacity - used,
                                   "%s0x%llx", used ? "," : "",
                                   static_cast<unsigned long long>(offset));
      if (written <= 0 || static_cast<size_t>(written) >= stackCapacity - used)
        break;
      used += static_cast<size_t>(written);
    }
  }
  if (rayTracing)
    return "rt";
  if (graphics)
    return "graphics";
  if (compute)
    return "compute";
  if (stage && std::strcmp(stage, "compute") == 0)
    return "compute";
  if (stage && (std::strcmp(stage, "fragment") == 0 ||
                std::strcmp(stage, "vertex") == 0 ||
                std::strcmp(stage, "geometry") == 0 ||
                std::strcmp(stage, "hull") == 0 ||
                std::strcmp(stage, "domain") == 0))
    return "graphics";
  if (stage && (std::strcmp(stage, "raygeneration") == 0 ||
                std::strcmp(stage, "closesthit") == 0 ||
                std::strcmp(stage, "anyhit") == 0 ||
                std::strcmp(stage, "intersection") == 0 ||
                std::strcmp(stage, "miss") == 0 ||
                std::strcmp(stage, "callable") == 0))
    return "rt";
  return "unknown";
}

bool readObserverErrorCode(IRError **sink, uint32_t *code,
                           const char **status) {
  if (code)
    *code = 0;
  if (status)
    *status = "not_provided";
  if (!sink)
    return false;
  IRError *error = nullptr;
  vm_size_t copied = 0;
  if (vm_read_overwrite(mach_task_self(), reinterpret_cast<vm_address_t>(sink),
                        sizeof(error), reinterpret_cast<vm_address_t>(&error),
                        &copied) != KERN_SUCCESS || copied != sizeof(error)) {
    if (status)
      *status = "sink_unreadable";
    return false;
  }
  if (!error) {
    if (status)
      *status = "none";
    return false;
  }
  uint32_t observed = 0;
  copied = 0;
  if (vm_read_overwrite(
          mach_task_self(),
          reinterpret_cast<vm_address_t>(error) + kIrErrorCodeOffset,
          sizeof(observed), reinterpret_cast<vm_address_t>(&observed),
          &copied) != KERN_SUCCESS || copied != sizeof(observed)) {
    if (status)
      *status = "error_unreadable";
    return false;
  }
  if (code)
    *code = observed;
  if (status)
    *status = "code";
  return true;
}

IRObject *invokeObserverCompile(IRCompiler *compiler,
                                const std::vector<std::string> &args,
                                const IRObject *object, IRError **sink,
                                CompileAndLink original,
                                uintptr_t returnAddress) {
  const uint32_t sequence =
      g_observer_observations.fetch_add(1, std::memory_order_relaxed);
  const bool bounded = sequence < kObserverObservationCap;
  g_observer_scratch = Slot{};
  g_observer_scratch.sequence = sequence;
  g_observer_scratch.caller_offset = static_cast<uint32_t>(
      returnAddress - reinterpret_cast<uintptr_t>(g_d3dmetal));
  const CaptureFailure failure = snapshotObject(object, &g_observer_scratch);
  char sourceSha[65]{};
  const bool sourceValid =
      failure == kFailureNone &&
      hexBytes(g_observer_scratch.digest, sizeof(g_observer_scratch.digest),
               sourceSha, sizeof(sourceSha));
  const char *stage = inferObserverStage(args);
  char stackText[320]{};
  const char *context =
      inferObserverContext(returnAddress, stage, stackText, sizeof(stackText));
  g_original_calls.fetch_add(1, std::memory_order_relaxed);
  try {
    IRObject *result = original(compiler, args, object, sink);
    if (result)
      g_returned_nonnull.fetch_add(1, std::memory_order_relaxed);
    else
      g_returned_null.fetch_add(1, std::memory_order_relaxed);
    uint32_t errorCode = 0;
    const char *errorStatus = nullptr;
    const bool hasErrorCode = readObserverErrorCode(sink, &errorCode, &errorStatus);
    if (hasErrorCode && errorCode == 0x13)
      g_observer_error19.fetch_add(1, std::memory_order_relaxed);
    char exportedPath[PATH_MAX]{};
    const bool shouldExport = sourceValid && bounded;
    const bool exported =
        shouldExport && exportFunctionalSource(g_observer_scratch, sourceSha,
                                               exportedPath,
                                               sizeof(exportedPath));
    if (exported)
      g_observer_exports.fetch_add(1, std::memory_order_relaxed);
    if (bounded || (hasErrorCode && errorCode == 0x13)) {
      char errorText[32]{};
      if (hasErrorCode)
        (void)snprintf(errorText, sizeof(errorText), "0x%x", errorCode);
      logFormat(
          "observer compile sequence=%u time_ns=%llu tid=%llu caller=0x%x "
          "context=%s stage=%s size=%u sha256=%s capture=%s "
          "result=%s error=%s error_status=%s sink=%s export=%s path=%s "
          "stack=%s\n",
          sequence, static_cast<unsigned long long>(realtimeNanos()),
          static_cast<unsigned long long>(currentThreadId()),
          g_observer_scratch.caller_offset, context, stage,
          g_observer_scratch.size, sourceValid ? sourceSha : "none",
          failureText(failure), result ? "returned_nonnull" : "returned_null",
          hasErrorCode ? errorText : "none",
          errorStatus ? errorStatus : "unknown", sink ? "non-null" : "null",
          exported ? "complete" : (shouldExport ? "failed" : "skipped"),
          exportedPath[0] ? exportedPath : "none",
          stackText[0] ? stackText : "none");
    }
    return result;
  } catch (...) {
    g_unwound.fetch_add(1, std::memory_order_relaxed);
    uint32_t errorCode = 0;
    const char *errorStatus = nullptr;
    const bool hasErrorCode = readObserverErrorCode(sink, &errorCode, &errorStatus);
    char errorText[32]{};
    if (hasErrorCode)
      (void)snprintf(errorText, sizeof(errorText), "0x%x", errorCode);
    logFormat(
        "observer compile sequence=%u time_ns=%llu tid=%llu caller=0x%x "
        "context=%s stage=%s size=%u sha256=%s capture=%s result=unwound "
        "error=%s error_status=%s sink=%s export=skipped path=none stack=%s\n",
        sequence, static_cast<unsigned long long>(realtimeNanos()),
        static_cast<unsigned long long>(currentThreadId()),
        g_observer_scratch.caller_offset, context, stage,
        g_observer_scratch.size, sourceValid ? sourceSha : "none",
        failureText(failure), hasErrorCode ? errorText : "none",
        errorStatus ? errorStatus : "unknown", sink ? "non-null" : "null",
        stackText[0] ? stackText : "none");
    throw;
  }
}

const char *transformStatusText(
    yaagl::metal_ir::Unorm24TransformStatus status) {
  switch (status) {
  case yaagl::metal_ir::Unorm24TransformStatus::kSuccess:
    return "success";
  case yaagl::metal_ir::Unorm24TransformStatus::kNoMatch:
    return "no_match";
  case yaagl::metal_ir::Unorm24TransformStatus::kTooLarge:
    return "too_large";
  case yaagl::metal_ir::Unorm24TransformStatus::kUnhandledFp64:
    return "unhandled_fp64";
  }
  return "unknown";
}

void selectCachedFunctionalObject(const FunctionalCacheEntry &entry,
                                  FunctionalSelection *selection,
                                  const char *kind) {
  if (!selection)
    return;
  selection->object = entry.object;
  selection->kind = kind;
  selection->reason = "transformed";
  selection->graph_count = entry.graph_count;
  selection->output_size = entry.size;
  selection->has_output_digest = true;
  std::memcpy(selection->output_digest, entry.output_digest,
              sizeof(selection->output_digest));
}

bool selectCachedFunctionalNegativeResult(const uint8_t *sourceDigest,
                                          FunctionalSelection *selection) {
  if (!sourceDigest || !selection)
    return false;
  for (uint32_t i = 0; i < g_functional_negative_cache_count; ++i) {
    const FunctionalNegativeCacheEntry &entry =
        g_functional_negative_cache[i];
    if (!entry.occupied ||
        std::memcmp(entry.source_digest, sourceDigest,
                    sizeof(entry.source_digest)) != 0)
      continue;
    selection->object = nullptr;
    selection->kind = "original";
    selection->reason = transformStatusText(entry.status);
    selection->graph_count = entry.graph_count;
    selection->output_size = 0;
    selection->has_output_digest = false;
    std::memset(selection->output_digest, 0, sizeof(selection->output_digest));
    return true;
  }
  return false;
}

void cacheDeterministicFunctionalNegativeResult(
    const uint8_t *sourceDigest,
    yaagl::metal_ir::Unorm24TransformStatus status, uint32_t graphCount) {
  // Only these transform outcomes depend solely on the immutable source
  // bytes. DXC/provider/assembly failures may be transient and must keep
  // retrying on later calls.
  if (!sourceDigest ||
      (status != yaagl::metal_ir::Unorm24TransformStatus::kNoMatch &&
       status != yaagl::metal_ir::Unorm24TransformStatus::kUnhandledFp64))
    return;

  for (uint32_t i = 0; i < g_functional_negative_cache_count; ++i) {
    const FunctionalNegativeCacheEntry &entry =
        g_functional_negative_cache[i];
    if (entry.occupied &&
        std::memcmp(entry.source_digest, sourceDigest,
                    sizeof(entry.source_digest)) == 0)
      return;
  }
  if (g_functional_negative_cache_count >= kFunctionalNegativeCacheCap)
    return;

  FunctionalNegativeCacheEntry &entry =
      g_functional_negative_cache[g_functional_negative_cache_count];
  entry = FunctionalNegativeCacheEntry{};
  entry.occupied = true;
  std::memcpy(entry.source_digest, sourceDigest, sizeof(entry.source_digest));
  entry.status = status;
  entry.graph_count = graphCount;
  ++g_functional_negative_cache_count;
}

bool selectFunctionalObject(const Slot &slot, FunctionalSelection *selection) {
  if (!selection)
    return false;
  *selection = FunctionalSelection{};
  selection->object = nullptr;

  if (!g_functional_ready.load(std::memory_order_acquire) ||
      !g_functional_replacement_object || !g_dxc_runtime) {
    selection->reason = "runtime_unavailable";
    return false;
  }

  if (matchesFunctionalSource(slot.size, slot.digest)) {
    selection->object = g_functional_replacement_object;
    selection->kind = "exact_asset";
    selection->reason = "known_hash";
    selection->graph_count = 4;
    selection->output_size = kFunctionalReplacementBytes;
    return true;
  }

  if (pthread_mutex_lock(&g_functional_mutex) != 0) {
    selection->reason = "mutex_failed";
    return false;
  }
  struct MutexGuard {
    ~MutexGuard() { (void)pthread_mutex_unlock(&g_functional_mutex); }
  } mutexGuard;

  for (uint32_t i = 0; i < g_functional_cache_count; ++i) {
    const FunctionalCacheEntry &entry = g_functional_cache[i];
    if (entry.occupied &&
        std::memcmp(entry.source_digest, slot.digest,
                    sizeof(entry.source_digest)) == 0) {
      selectCachedFunctionalObject(entry, selection, "structural_cache");
      return true;
    }
  }
  // This lookup remains inside the existing functional mutex.  A cached
  // negative result skips DXC disassembly while preserving the transform
  // reason and graph count reported for the original object.
  if (selectCachedFunctionalNegativeResult(slot.digest, selection))
    return false;
  if (g_functional_cache_count >= kFunctionalCacheCap) {
    selection->reason = "cache_full";
    return false;
  }

  try {
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> sourceBlob;
    if (!yaagl::dxc::succeeded(g_dxc_runtime->utils()->CreateBlob(
            slot.bytes, slot.size, yaagl::dxc::kUtf8,
            sourceBlob.put())) ||
        !sourceBlob) {
      selection->reason = "source_blob_failed";
      return false;
    }

    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> disassembly;
    if (!yaagl::dxc::succeeded(g_dxc_runtime->compiler()->Disassemble(
            sourceBlob.get(), disassembly.put())) ||
        !disassembly || !disassembly->GetBufferPointer() ||
        disassembly->GetBufferSize() == 0 ||
        disassembly->GetBufferSize() > 1024 * 1024) {
      selection->reason = "disassemble_failed";
      return false;
    }

    std::string transformed;
    const std::string_view llvm(
        static_cast<const char *>(disassembly->GetBufferPointer()),
        disassembly->GetBufferSize());
    const bool knownInjectCache =
        matchesInjectCacheSource(slot.size, slot.digest);
    const auto transform =
        knownInjectCache
            ? yaagl::metal_ir::transformKnownInjectCache843Only(llvm,
                                                                  &transformed)
            : yaagl::metal_ir::transformUnorm24Only(llvm, &transformed);
    selection->reason = transformStatusText(transform.status);
    selection->graph_count = static_cast<uint32_t>(transform.graph_count);
    if (transform.status !=
        yaagl::metal_ir::Unorm24TransformStatus::kSuccess) {
      cacheDeterministicFunctionalNegativeResult(
          slot.digest, transform.status, selection->graph_count);
      return false;
    }
    if (transformed.empty() || transformed.size() > UINT32_MAX)
      return false;

    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> transformedBlob;
    if (!yaagl::dxc::succeeded(g_dxc_runtime->utils()->CreateBlob(
            transformed.data(), static_cast<uint32_t>(transformed.size()),
            yaagl::dxc::kUtf8, transformedBlob.put())) ||
        !transformedBlob) {
      selection->reason = "transformed_blob_failed";
      return false;
    }

    yaagl::dxc::ComPtr<yaagl::dxc::OperationResult> operation;
    if (!yaagl::dxc::succeeded(
            g_dxc_runtime->assembler()->AssembleToContainer(
                transformedBlob.get(), operation.put())) ||
        !operation) {
      selection->reason = "assemble_call_failed";
      return false;
    }
    yaagl::dxc::HRESULT status = -1;
    if (!yaagl::dxc::succeeded(operation->GetStatus(&status)) ||
        !yaagl::dxc::succeeded(status)) {
      selection->reason = "assemble_failed";
      return false;
    }

    yaagl::dxc::ComPtr<yaagl::dxc::Blob> output;
    if (!yaagl::dxc::succeeded(operation->GetResult(output.put())) ||
        !output || !output->GetBufferPointer() ||
        output->GetBufferSize() == 0 ||
        output->GetBufferSize() > kFunctionalAssembledCap) {
      selection->reason = "assembled_output_invalid";
      return false;
    }

    uint8_t outputDigest[CC_SHA256_DIGEST_LENGTH]{};
    if (!digest(output->GetBufferPointer(), output->GetBufferSize(),
                outputDigest)) {
      selection->reason = "output_digest_failed";
      return false;
    }

    const uint8_t *persistentBytes = nullptr;
    IRObject *persistentObject = nullptr;
    if (!createPersistentDxilObject(output->GetBufferPointer(),
                                    output->GetBufferSize(),
                                    &persistentBytes, &persistentObject)) {
      selection->reason = "provider_object_failed";
      return false;
    }

    FunctionalCacheEntry &entry =
        g_functional_cache[g_functional_cache_count];
    entry = FunctionalCacheEntry{};
    entry.occupied = true;
    std::memcpy(entry.source_digest, slot.digest,
                sizeof(entry.source_digest));
    std::memcpy(entry.output_digest, outputDigest,
                sizeof(entry.output_digest));
    entry.bytes = persistentBytes;
    entry.size = output->GetBufferSize();
    entry.object = persistentObject;
    entry.graph_count = static_cast<uint32_t>(transform.graph_count);
    ++g_functional_cache_count;
    selectCachedFunctionalObject(entry, selection,
                                 knownInjectCache
                                     ? "structural_inject_cache"
                                     : "structural_unorm");
    return true;
  } catch (...) {
    selection->reason = "transform_exception";
    return false;
  }
}

IRObject *invokeFunctionalCompile(IRCompiler *compiler,
                                  const std::vector<std::string> &args,
                                  const IRObject *object, IRError **sink,
                                  CompileAndLink original,
                                  uintptr_t returnAddress) {
  const uint32_t sequence =
      g_functional_observations.fetch_add(1, std::memory_order_relaxed);
  // Source export and source-to-error/PSO correlation records are bounded to
  // the first 32 CompileAndLink observations. Aggregate counters remain exact.
  const bool report = sequence < kFunctionalObservationCap;
  // Each compiler thread owns a fixed 64 KiB scratch slot, so concurrent
  // CompileAndLink calls cannot make the exact target silently fall back to the
  // unmodified object merely because another observation is being persisted.
  g_functional_scratch = Slot{};
  g_functional_scratch.sequence = sequence;
  g_functional_scratch.caller_offset = static_cast<uint32_t>(
      returnAddress - reinterpret_cast<uintptr_t>(g_d3dmetal));
  const CaptureFailure failure =
      snapshotObject(object, &g_functional_scratch);
  char sourceSha[65]{};
  const bool sourceValid =
      failure == kFailureNone &&
      hexBytes(g_functional_scratch.digest,
               sizeof(g_functional_scratch.digest), sourceSha,
               sizeof(sourceSha));
  FunctionalSelection selection{};
  const bool selectedFunctional =
      sourceValid && selectFunctionalObject(g_functional_scratch, &selection);
  const bool matched = selectedFunctional && selection.object &&
                       selection.object != object;
  const IRObject *selected = matched ? selection.object : object;
  char outputSha[65]{};
  if (matched && std::strcmp(selection.kind, "exact_asset") == 0) {
    std::strncpy(outputSha, kFunctionalReplacementSha256,
                 sizeof(outputSha) - 1);
  } else if (matched && selection.has_output_digest) {
    (void)hexBytes(selection.output_digest, sizeof(selection.output_digest),
                   outputSha, sizeof(outputSha));
  }
  char exportedPath[PATH_MAX]{};
  const bool exported =
      report && sourceValid &&
      exportFunctionalSource(g_functional_scratch, sourceSha, exportedPath,
                             sizeof(exportedPath));
  const bool identityLog =
      matched &&
      !g_functional_identity_logged.exchange(true, std::memory_order_acq_rel);
  if (matched)
    g_functional_matches.fetch_add(1, std::memory_order_relaxed);
  if (report) {
    if (sourceValid) {
      logFormat("probe observation sequence=%u size=%u sha256=%s selected=%s reason=%s graphs=%u output_size=%zu output_sha256=%s export=%s path=%s\n",
                sequence, g_functional_scratch.size, sourceSha,
                matched ? selection.kind : "original",
                selection.reason, selection.graph_count,
                matched ? selection.output_size : 0,
                outputSha[0] ? outputSha : "none",
                exported ? "complete" : "failed",
                exportedPath[0] ? exportedPath : "none");
    } else {
      logFormat("probe observation sequence=%u capture=%s selected=original\n",
                sequence, failureText(failure));
    }
  }
  if (identityLog) {
    logFormat("probe target-entry caller=D3DMetal offset=0x%x sink=%s\n",
              g_functional_scratch.caller_offset,
              sink ? "non-null" : "null");
    logFormat("probe source-sha256=%s\n", sourceSha);
    logFormat("probe replacement-sha256=%s\n",
              outputSha[0] ? outputSha : "none");
    logFormat("probe replacement-kind=%s graphs=%u\n",
              selection.kind, selection.graph_count);
    logFormat("probe original-object=%p\n", object);
    logFormat("probe replacement-object=%p\n", selection.object);
  }

  const char *stage = inferObserverStage(args);
  char stackText[320]{};
  const char *context =
      inferObserverContext(returnAddress, stage, stackText, sizeof(stackText));
  const uint64_t correlationTimeNs = realtimeNanos();
  const uint64_t correlationThreadId = currentThreadId();
  uintptr_t psoObject = 0;
  uint64_t psoId = 0;
  const bool hasPsoCorrelation =
      YaaglReadCurrentComputeCorrelation(&psoObject, &psoId);
  char psoObjectText[32]{};
  char psoIdText[32]{};
  if (hasPsoCorrelation) {
    (void)snprintf(psoObjectText, sizeof(psoObjectText), "0x%llx",
                   static_cast<unsigned long long>(psoObject));
    (void)snprintf(psoIdText, sizeof(psoIdText), "%llu",
                   static_cast<unsigned long long>(psoId));
  } else {
    std::strncpy(psoObjectText, "none", sizeof(psoObjectText) - 1);
    std::strncpy(psoIdText, "none", sizeof(psoIdText) - 1);
  }

  g_original_calls.fetch_add(1, std::memory_order_relaxed);
  try {
    IRObject *result = original(compiler, args, selected, sink);
    if (result)
      g_returned_nonnull.fetch_add(1, std::memory_order_relaxed);
    else
      g_returned_null.fetch_add(1, std::memory_order_relaxed);
    uint32_t errorCode = 0;
    const char *errorStatus = nullptr;
    const bool hasErrorCode =
        readObserverErrorCode(sink, &errorCode, &errorStatus);
    const bool error19 = hasErrorCode && errorCode == 0x13;
    if (error19)
      g_functional_error19.fetch_add(1, std::memory_order_relaxed);
    if (report) {
      char errorText[32]{};
      if (hasErrorCode)
        (void)snprintf(errorText, sizeof(errorText), "0x%x", errorCode);
      logFormat(
          "observer compile sequence=%u time_ns=%llu tid=%llu caller=0x%x "
          "context=%s stage=%s size=%u sha256=%s capture=%s "
          "result=%s error=%s error_status=%s sink=%s export=%s path=%s "
          "pso_object=%s pso_id=%s selection=%s selection_reason=%s stack=%s\n",
          sequence, static_cast<unsigned long long>(correlationTimeNs),
          static_cast<unsigned long long>(correlationThreadId),
          g_functional_scratch.caller_offset, context, stage,
          g_functional_scratch.size, sourceValid ? sourceSha : "none",
          failureText(failure), result ? "returned_nonnull" : "returned_null",
          hasErrorCode ? errorText : "none",
          errorStatus ? errorStatus : "unknown", sink ? "non-null" : "null",
          exported ? "complete"
                   : (report && sourceValid ? "failed" : "skipped"),
          exportedPath[0] ? exportedPath : "none", psoObjectText, psoIdText,
          matched ? selection.kind : "original", selection.reason,
          stackText[0] ? stackText : "none");
    }
    if (report)
      logFormat("probe observation-result sequence=%u result=%p selected=%s\n",
                sequence, result,
                matched ? selection.kind : "original");
    if (matched && result) {
      g_functional_successes.fetch_add(1, std::memory_order_relaxed);
      if (!g_functional_success_logged.exchange(true,
                                                std::memory_order_acq_rel))
        logLine("probe replacement-compile-succeeded\n");
    }
    if (identityLog) {
      logFormat("probe target-result=%p\n", result);
      logFormat("probe target-selection=%s reason=%s graphs=%u\n",
                matched ? selection.kind : "original", selection.reason,
                selection.graph_count);
      if (!result)
        logLine("probe replacement-compile-failed\n");
    }
    return result;
  } catch (...) {
    g_unwound.fetch_add(1, std::memory_order_relaxed);
    uint32_t errorCode = 0;
    const char *errorStatus = nullptr;
    const bool hasErrorCode =
        readObserverErrorCode(sink, &errorCode, &errorStatus);
    const bool error19 = hasErrorCode && errorCode == 0x13;
    if (error19)
      g_functional_error19.fetch_add(1, std::memory_order_relaxed);
    if (report) {
      char errorText[32]{};
      if (hasErrorCode)
        (void)snprintf(errorText, sizeof(errorText), "0x%x", errorCode);
      logFormat(
          "observer compile sequence=%u time_ns=%llu tid=%llu caller=0x%x "
          "context=%s stage=%s size=%u sha256=%s capture=%s result=unwound "
          "error=%s error_status=%s sink=%s export=%s path=%s "
          "pso_object=%s pso_id=%s selection=%s selection_reason=%s stack=%s\n",
          sequence, static_cast<unsigned long long>(correlationTimeNs),
          static_cast<unsigned long long>(correlationThreadId),
          g_functional_scratch.caller_offset, context, stage,
          g_functional_scratch.size, sourceValid ? sourceSha : "none",
          failureText(failure), hasErrorCode ? errorText : "none",
          errorStatus ? errorStatus : "unknown", sink ? "non-null" : "null",
          exported ? "complete"
                   : (report && sourceValid ? "failed" : "skipped"),
          exportedPath[0] ? exportedPath : "none", psoObjectText, psoIdText,
          matched ? selection.kind : "original", selection.reason,
          stackText[0] ? stackText : "none");
    }
    if (report)
      logFormat("probe observation-result sequence=%u result=unwound selected=%s\n",
                sequence, matched ? selection.kind : "original");
    if (identityLog)
      logLine("probe replacement-compile-unwound\n");
    throw;
  }
}

extern "C" IRObject *
YaaglIRCompilerAllocCompileAndLinkProbe(IRCompiler *compiler,
                                        const std::vector<std::string> &args,
                                        const IRObject *object, IRError **sink) {
  CompileAndLink original = nullptr;
  if (!enterWrapper(&original)) {
    original = g_control.original.load(std::memory_order_acquire);
    // Observation failure is never process authority.  The immutable control
    // block is published before the GOT points here, but a defensive null
    // outcome is still preferable to terminating the game if that invariant
    // is ever broken by a loader race or future refactor.
    return original ? original(compiler, args, object, sink) : nullptr;
  }
  struct Guard { ~Guard() { leaveWrapper(); } } guard;
  const uintptr_t returnAddress =
      reinterpret_cast<uintptr_t>(__builtin_return_address(0));
  const uintptr_t base = reinterpret_cast<uintptr_t>(g_d3dmetal);
  const size_t size = textSize(g_d3dmetal);
  const bool callerInD3DMetal =
      g_d3dmetal && returnAddress >= base && returnAddress < base + size;
  const bool callerMatches =
      g_constructor_fixture
          ? callerInD3DMetal
          : (callerInD3DMetal &&
             isConfiguredCallerOffset(returnAddress, base));
  const bool functionalCallerMatches =
      callerInD3DMetal && isFunctionalCallerOffset(returnAddress, base);
  const RuntimeMode mode = runtimeMode();
  if (mode == kRuntimeObserver && callerInD3DMetal)
    return invokeObserverCompile(compiler, args, object, sink, original,
                                 returnAddress);
  if ((mode == kRuntimeFunctional || mode == kRuntimeFunctionalObserver) &&
      functionalCallerMatches)
    return invokeFunctionalCompile(compiler, args, object, sink, original,
                                   returnAddress);
  const bool target =
      g_protocol_state.load(std::memory_order_acquire) == kCapturing &&
      callerMatches;
  int prepared = -1;
  if (target) {
    const uint64_t sequence =
        g_exact_offset_matches.fetch_add(1, std::memory_order_relaxed);
    prepared = prepareSlot(object, returnAddress, sequence);
  }
  if (target)
    g_original_calls.fetch_add(1, std::memory_order_relaxed);
  try {
    IRObject *result = original(compiler, args, object, sink);
    OriginalOutcome outcome = result ? kOutcomeReturnedNonNull : kOutcomeReturnedNull;
    if (target) {
      if (outcome == kOutcomeReturnedNull)
        g_returned_null.fetch_add(1, std::memory_order_relaxed);
      else
        g_returned_nonnull.fetch_add(1, std::memory_order_relaxed);
    }
    if (prepared >= 0)
      finishSlot(prepared, outcome);
    if (g_oversize_failures.load(std::memory_order_acquire) != 0 ||
        g_slot_exhausted_failures.load(std::memory_order_acquire) != 0 ||
        g_blob_exhausted_failures.load(std::memory_order_acquire) != 0)
      beginDrain();
    return result;
  } catch (...) {
    if (target)
      g_unwound.fetch_add(1, std::memory_order_relaxed);
    if (prepared >= 0)
      finishSlot(prepared, kOutcomeUnwound);
    if (g_oversize_failures.load(std::memory_order_acquire) != 0 ||
        g_slot_exhausted_failures.load(std::memory_order_acquire) != 0 ||
        g_blob_exhausted_failures.load(std::memory_order_acquire) != 0)
      beginDrain();
    throw;
  }
}

bool consumeExact(const char *text, size_t size, size_t *at,
                  const char *literal) {
  const size_t length = std::strlen(literal);
  if (*at + length > size || std::memcmp(text + *at, literal, length) != 0)
    return false;
  *at += length;
  return true;
}
bool parseCompactUint(const char *text, size_t size, size_t *at,
                      uint64_t *out) {
  if (*at >= size || text[*at] < '0' || text[*at] > '9')
    return false;
  uint64_t value = 0;
  const size_t start = *at;
  do {
    uint64_t digit = static_cast<uint64_t>(text[*at] - '0');
    if (value > (UINT64_MAX - digit) / 10)
      return false;
    value = value * 10 + digit;
    ++*at;
  } while (*at < size && text[*at] >= '0' && text[*at] <= '9');
  if (*at - start > 1 && text[start] == '0')
    return false;
  *out = value;
  return true;
}
bool parseCompactString(const char *text, size_t size, size_t *at, char *out,
                        size_t cap) {
  if (*at >= size || text[*at] != '\"')
    return false;
  ++*at;
  size_t used = 0;
  while (*at < size && text[*at] != '\"') {
    const unsigned char value = static_cast<unsigned char>(text[*at]);
    if (value < 0x21 || value == '\\' || used + 1 >= cap)
      return false;
    out[used++] = static_cast<char>(value);
    ++*at;
  }
  if (*at >= size || text[*at] != '\"')
    return false;
  ++*at;
  out[used] = 0;
  return true;
}
bool parseBoundControlStrict(const char *text, size_t size,
                             const char *expectedState,
                             ArmMessage *message) {
  if (!text || !message || size == 0 || size > kArmMaxBytes)
    return false;
  *message = ArmMessage{};
  for (size_t i = 0; i < size; ++i)
    if (std::isspace(static_cast<unsigned char>(text[i])))
      return false;
  size_t at = 0;
  return consumeExact(text, size, &at, "{\"schema\":") &&
         parseCompactUint(text, size, &at, &message->schema) &&
         consumeExact(text, size, &at, ",\"mode\":") &&
         parseCompactString(text, size, &at, message->mode,
                            sizeof(message->mode)) &&
         consumeExact(text, size, &at, ",\"state\":") &&
         parseCompactString(text, size, &at, message->state,
                            sizeof(message->state)) &&
         consumeExact(text, size, &at, ",\"uid\":") &&
         parseCompactUint(text, size, &at, &message->uid) &&
         consumeExact(text, size, &at, ",\"pid\":") &&
         parseCompactUint(text, size, &at, &message->pid) &&
         consumeExact(text, size, &at, ",\"nonce\":") &&
         parseCompactString(text, size, &at, message->nonce,
                            sizeof(message->nonce)) &&
         consumeExact(text, size, &at, ",\"ack_sha256\":") &&
         parseCompactString(text, size, &at, message->ack_sha256,
                            sizeof(message->ack_sha256)) &&
         consumeExact(text, size, &at, "}") && at == size &&
         message->schema == 2 &&
         std::strcmp(message->state, expectedState) == 0 &&
         std::strcmp(message->mode, kMode) == 0 &&
         message->uid == static_cast<uint64_t>(getuid()) &&
         message->pid == static_cast<uint64_t>(getpid()) &&
         isLowerHex32(message->nonce) &&
         std::strcmp(message->nonce, g_nonce) == 0 &&
         isLowerHex64(message->ack_sha256) &&
         std::strcmp(message->ack_sha256, g_ack_raw_sha256) == 0;
}
bool parseArmStrict(const char *text, size_t size, ArmMessage *message) {
  return parseBoundControlStrict(text, size, "armed", message);
}
ArmCheck inspectArm() {
  if (g_arms_fd < 0 || !g_arm_leaf[0])
    return kArmMissing;
  int fd = openat(g_arms_fd, g_arm_leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return errno == ENOENT ? kArmMissing : kArmInvalid;
  struct stat status{};
  bool ok = fstat(fd, &status) == 0 && S_ISREG(status.st_mode) &&
            status.st_size > 0 && status.st_size <= kArmMaxBytes;
  char body[kArmMaxBytes + 1]{};
  ssize_t readCount = ok ? read(fd, body, sizeof(body) - 1) : -1;
  if (close(fd) != 0)
    ok = false;
  if (!ok || readCount <= 0 || static_cast<off_t>(readCount) != status.st_size)
    return kArmInvalid;
  ArmMessage message{};
  if (!parseArmStrict(body, static_cast<size_t>(readCount), &message))
    return kArmInvalid;
  return kArmAccepted;
}
ArmCheck inspectStop() {
  if (g_controls_fd < 0 || !g_stop_leaf[0])
    return kArmMissing;
  int fd =
      openat(g_controls_fd, g_stop_leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return errno == ENOENT ? kArmMissing : kArmInvalid;
  struct stat status{};
  bool ok = fstat(fd, &status) == 0 && S_ISREG(status.st_mode) &&
            status.st_uid == getuid() && status.st_nlink == 1 &&
            (status.st_mode & 0777) == 0600 && status.st_size > 0 &&
            status.st_size <= kArmMaxBytes;
  char body[kArmMaxBytes + 1]{};
  ssize_t readCount = ok ? read(fd, body, sizeof(body) - 1) : -1;
  if (close(fd) != 0)
    ok = false;
  if (!ok || readCount <= 0 || static_cast<off_t>(readCount) != status.st_size)
    return kArmInvalid;
  ArmMessage message{};
  return parseBoundControlStrict(body, static_cast<size_t>(readCount), "stop",
                                 &message)
             ? kArmAccepted
             : kArmInvalid;
}
bool writeArmedAck() {
  if (g_ack_written.load(std::memory_order_acquire))
    return true;
  if (!g_slot || !g_install_verified.load(std::memory_order_acquire) ||
      !g_install_readback_ok.load(std::memory_order_acquire) ||
      !g_install_protection_restored.load(std::memory_order_acquire) ||
      !validProtocolText(g_run_id, sizeof(g_run_id)) ||
      !validProtocolText(g_attempt_id, sizeof(g_attempt_id)) ||
      !validProtocolText(g_ack_token, sizeof(g_ack_token)) ||
      !validProtocolText(g_session_root, sizeof(g_session_root)) ||
      !validProtocolText(g_instance_id, sizeof(g_instance_id)) ||
      !validProtocolText(g_manifest_rel, sizeof(g_manifest_rel)) ||
      !validProtocolText(g_artifact_dir_rel, sizeof(g_artifact_dir_rel)) ||
      !validProtocolText(g_process_executable, sizeof(g_process_executable)) ||
      !validProtocolText(g_configured_game_executable,
                         sizeof(g_configured_game_executable)) ||
      !isLowerHex32(g_nonce) || !isLowerHex64(g_capture_sha256) ||
      !isLowerHex64(g_d3dmetal_sha256) || !isLowerHex64(g_provider_sha256) ||
      !validProtocolText(g_got_slot, sizeof(g_got_slot)))
    return false;
  int n = snprintf(g_ack_leaf, sizeof(g_ack_leaf), "ack-%d-%s.json", getpid(),
                   g_nonce);
  if (n <= 0 || static_cast<size_t>(n) >= sizeof(g_ack_leaf))
    return false;
  char body[16384]{};
  size_t at = 0;
  bool ok = appendText(body, sizeof(body), &at, "{\"schema\":2,\"mode\":") &&
            appendQuoted(body, sizeof(body), &at, kMode) &&
            appendText(body, sizeof(body), &at, ",\"state\":\"installed\",\"uid\":") &&
            appendUint(body, sizeof(body), &at, getuid()) &&
            appendText(body, sizeof(body), &at, ",\"pid\":") &&
            appendUint(body, sizeof(body), &at, getpid()) &&
            appendText(body, sizeof(body), &at, ",\"nonce\":") &&
            appendQuoted(body, sizeof(body), &at, g_nonce) &&
            appendText(body, sizeof(body), &at, ",\"token\":") &&
            appendQuoted(body, sizeof(body), &at, g_ack_token) &&
            appendText(body, sizeof(body), &at, ",\"attempt_id\":") &&
            appendQuoted(body, sizeof(body), &at, g_attempt_id) &&
            appendText(body, sizeof(body), &at, ",\"run_id\":") &&
            appendQuoted(body, sizeof(body), &at, g_run_id) &&
            appendText(body, sizeof(body), &at, ",\"session_root\":") &&
            appendQuoted(body, sizeof(body), &at, g_session_root) &&
            appendText(body, sizeof(body), &at, ",\"instance_id\":") &&
            appendQuoted(body, sizeof(body), &at, g_instance_id) &&
            appendText(body, sizeof(body), &at, ",\"manifest_rel\":") &&
            appendQuoted(body, sizeof(body), &at, g_manifest_rel) &&
            appendText(body, sizeof(body), &at, ",\"artifact_dir_rel\":") &&
            appendQuoted(body, sizeof(body), &at, g_artifact_dir_rel) &&
            appendText(body, sizeof(body), &at, ",\"capture_sha256\":") &&
            appendQuoted(body, sizeof(body), &at, g_capture_sha256) &&
            appendText(body, sizeof(body), &at, ",\"module_sha256\":") &&
            appendQuoted(body, sizeof(body), &at, g_capture_sha256) &&
            appendText(body, sizeof(body), &at, ",\"d3dmetal_sha256\":") &&
            appendQuoted(body, sizeof(body), &at, g_d3dmetal_sha256) &&
            appendText(body, sizeof(body), &at, ",\"provider_sha256\":") &&
            appendQuoted(body, sizeof(body), &at, g_provider_sha256) &&
            appendText(body, sizeof(body), &at, ",\"configured_offset\":") &&
            appendQuoted(body, sizeof(body), &at, kConfiguredOffsetText) &&
            appendText(body, sizeof(body), &at,
                       ",\"target_predicate\":\"exact-offset-precall-dxil\",\"process_executable\":") &&
            appendQuoted(body, sizeof(body), &at, g_process_executable) &&
            appendText(body, sizeof(body), &at, ",\"configured_game_executable\":") &&
            appendQuoted(body, sizeof(body), &at, g_configured_game_executable) &&
            appendText(body, sizeof(body), &at, ",\"got_slot\":") &&
            appendQuoted(body, sizeof(body), &at, g_got_slot) &&
            appendText(body, sizeof(body), &at,
                       ",\"got_readback\":true,\"protection_restored\":true}");
  uint8_t rawHash[32]{};
  if (!ok || !digest(body, at, rawHash) ||
      !hexBytes(rawHash, sizeof(rawHash), g_ack_raw_sha256,
                sizeof(g_ack_raw_sha256)) ||
      !writeImmutableAt(g_acks_fd, g_ack_leaf, body, at))
    return false;
  n = snprintf(g_arm_leaf, sizeof(g_arm_leaf), "arm-%d-%s.json", getpid(),
               g_nonce);
  if (n <= 0 || static_cast<size_t>(n) >= sizeof(g_arm_leaf))
    return false;
  n = snprintf(g_stop_leaf, sizeof(g_stop_leaf), "stop-%d-%s.json", getpid(),
               g_nonce);
  if (n <= 0 || static_cast<size_t>(n) >= sizeof(g_stop_leaf))
    return false;
  g_ack_written.store(true, std::memory_order_release);
  g_protocol_state.store(kInstalledAcked, std::memory_order_release);
  g_auth_started_ns.store(monotonicNanos(), std::memory_order_release);
  return true;
}
bool startWorkerAfterArm() {
  uint8_t expected = kArmed;
  if (!g_protocol_state.compare_exchange_strong(expected, kCapturing,
                                                std::memory_order_acq_rel))
    return expected == kCapturing;
  if (pthread_create(&g_worker_thread, nullptr, worker, nullptr) != 0) {
    g_protocol_state.store(kDraining, std::memory_order_release);
    g_publication_failed.store(true, std::memory_order_release);
    return false;
  }
  g_worker_started.store(true, std::memory_order_release);
  char marker[512]{};
  const int markerLength = snprintf(
      marker, sizeof(marker),
      "{\"schema\":2,\"mode\":\"metal-ir-capture-v2\","
      "\"state\":\"capturing\",\"pid\":%d,\"nonce\":\"%s\","
      "\"ack_sha256\":\"%s\"}",
      getpid(), g_nonce, g_ack_raw_sha256);
  if (markerLength <= 0 || static_cast<size_t>(markerLength) >= sizeof(marker) ||
      !writeImmutableAt(g_instance_fd, "capturing.json", marker,
                        static_cast<size_t>(markerLength))) {
    g_publication_failed.store(true, std::memory_order_release);
    beginDrain();
    return false;
  }
  return true;
}
void closeAuthorizationOnly() {
  g_control.admission_refcount.fetch_and(~uint64_t(1), std::memory_order_acq_rel);
  if (!restoreGot())
    g_restore_failed.store(true, std::memory_order_release);
  g_protocol_state.store(kAuthClosed, std::memory_order_release);
}
void beginDrain() {
  g_protocol_state.store(kDraining, std::memory_order_release);
  g_control.admission_refcount.fetch_and(~uint64_t(1), std::memory_order_acq_rel);
  if (!restoreGot())
    g_restore_failed.store(true, std::memory_order_release);
  g_producers_stopped.store(true, std::memory_order_release);
  g_stop.store(true, std::memory_order_release);
  wakeWorker();
}
const char *terminalFailureOutcome(TerminalReason reason) {
  switch (reason) {
  case kTerminalProtocolInvalid: return "protocol_invalid";
  case kTerminalArmExpired: return "arm_expired";
  case kTerminalProtocolConflict: return "protocol_conflict";
  case kTerminalNormal: break;
  }
  return "capture_failure";
}
bool writeTerminalOnce() {
  if (!g_instance_sealed.load(std::memory_order_acquire))
    return false;
  if (g_terminal_written.exchange(true, std::memory_order_acq_rel))
    return true;
  while (g_terminal_lock.test_and_set(std::memory_order_acquire))
    sched_yield();
  const TerminalReason reason =
      static_cast<TerminalReason>(g_terminal_reason.load(std::memory_order_acquire));
  const uint32_t records = g_record_count.load(std::memory_order_acquire);
  const uint32_t persisted = g_records_persisted.load(std::memory_order_acquire);
  uint32_t captureCount = 0;
  for (uint32_t i = 0; i < records; ++i)
    if (g_records[i].failure == kFailureNone)
      ++captureCount;
  const char *status = "complete";
  const char *outcome = "count_divergent";
  if (reason != kTerminalNormal) {
    status = "failed";
    outcome = terminalFailureOutcome(reason);
  } else if (g_restore_failed.load(std::memory_order_acquire)) {
    status = "failed";
    outcome = "restore_failed";
  } else if (g_oversize_failures.load(std::memory_order_acquire) != 0) {
    status = "failed";
    outcome = "blob_too_large";
  } else if (g_slot_exhausted_failures.load(std::memory_order_acquire) != 0) {
    status = "failed";
    outcome = "slot_overflow";
  } else if (g_blob_exhausted_failures.load(std::memory_order_acquire) != 0) {
    status = "failed";
    outcome = "persistence_failed";
  } else if (g_publication_failed.load(std::memory_order_acquire) ||
             records != persisted) {
    status = "failed";
    outcome = "persistence_failed";
  } else if (captureCount == 0) {
    status = "incomplete";
    outcome = "capture_empty";
  } else if (captureCount <= 10) {
    outcome = "partial_count";
  } else if (captureCount == 11) {
    outcome = "expected_count";
  }
  char body[4096]{};
  int n = snprintf(body, sizeof(body),
      "{\"schema\":2,\"kind\":\"terminal\",\"instance_id\":\"%s\","
      "\"run_id\":\"%s\",\"pid\":%d,"
      "\"status\":\"%s\",\"outcome\":\"%s\",\"capture_count\":%u,"
      "\"configured_offset\":\"%s\","
      "\"drain\":{\"records\":%u,\"persisted\":%u,\"in_flight\":%u,"
      "\"active_wrappers\":%u,\"got_restored\":%s,"
      "\"protection_restored\":%s,\"worker_joined\":%s},"
      "\"outcomes\":{\"original_calls\":%u,\"returned_null\":%u,\"returned_nonnull\":%u,\"unwound\":%u},"
      "\"failures\":{\"oversize\":%u,\"invalid_object\":%u,\"unreadable\":%u,\"slot_exhausted\":%u,\"blob_exhausted\":%u}}",
      g_instance_id, g_run_id, getpid(), status, outcome, captureCount,
      kConfiguredOffsetText,
      records, persisted, g_in_flight.load(), g_in_flight.load(),
      g_got_restored.load() ? "true" : "false",
      g_got_restored.load() ? "true" : "false",
      g_worker_started.load() ? "false" : "true", g_original_calls.load(),
      g_returned_null.load(), g_returned_nonnull.load(), g_unwound.load(),
      g_oversize_failures.load(), g_invalid_failures.load(),
      g_unreadable_failures.load(), g_slot_exhausted_failures.load(),
      g_blob_exhausted_failures.load());
  bool ok = n > 0 && static_cast<size_t>(n) < sizeof(body) &&
            writeImmutableAt(g_instance_fd, "terminal.json", body,
                             static_cast<size_t>(n));
  if (!ok)
    g_publication_failed.store(true, std::memory_order_release);
  g_terminal_lock.clear(std::memory_order_release);
  return ok;
}
bool createFailureInstance(TerminalReason reason) {
  closeAuthorizationOnly();
  if (!makeInstance())
    return false;
  g_terminal_reason.store(reason, std::memory_order_release);
  g_producers_stopped.store(true, std::memory_order_release);
  g_stop.store(true, std::memory_order_release);
  (void)writeTerminalOnce();
  g_protocol_state.store(kTerminal, std::memory_order_release);
  return true;
}
bool controlStep(uint64_t now) {
  const uint8_t state = g_protocol_state.load(std::memory_order_acquire);
  if (state != kInstalledAcked && state != kAuthClosed)
    return false;
  const ArmCheck arm = inspectArm();
  if (state == kInstalledAcked && arm == kArmAccepted) {
    uint8_t expected = kInstalledAcked;
    if (!g_protocol_state.compare_exchange_strong(expected, kArmed,
                                                   std::memory_order_acq_rel))
      return false;
    if (!makeInstance() || !startWorkerAfterArm()) {
      g_publication_failed.store(true, std::memory_order_release);
      beginDrain();
    }
    return g_worker_started.load(std::memory_order_acquire);
  }
  if (state == kInstalledAcked && arm == kArmInvalid)
    return createFailureInstance(kTerminalProtocolInvalid);
  if (state == kAuthClosed && arm != kArmMissing)
    return createFailureInstance(kTerminalArmExpired);
  const uint64_t started = g_auth_started_ns.load(std::memory_order_acquire);
  if (state == kInstalledAcked && started && now >= started &&
      now - started >= kAuthorizationWindowNs) {
    g_auth_timeout.store(true, std::memory_order_release);
    closeAuthorizationOnly();
  }
  return false;
}
void *control(void *) {
  while (!g_stop.load(std::memory_order_acquire)) {
    const uint8_t state = g_protocol_state.load(std::memory_order_acquire);
    if (state == kCapturing) {
      const ArmCheck stop = inspectStop();
      if (stop != kArmMissing) {
        g_terminal_reason.store(stop == kArmAccepted
                                    ? kTerminalNormal
                                    : kTerminalProtocolConflict,
                                std::memory_order_release);
        beginDrain();
        if (g_worker_started.exchange(false, std::memory_order_acq_rel))
          pthread_join(g_worker_thread, nullptr);
        while (g_in_flight.load(std::memory_order_acquire) != 0)
          sched_yield();
        (void)writeTerminalOnce();
        g_protocol_state.store(kTerminal, std::memory_order_release);
        return nullptr;
      }
    } else if (state != kInstalledAcked && state != kAuthClosed) {
      break;
    } else {
      (void)controlStep(monotonicNanos());
    }
    pollfd p{g_pipe[0], POLLIN, 0};
    (void)poll(&p, 1, 50);
  }
  return nullptr;
}
void *worker(void *) {
  for (;;) {
    pollfd p{g_pipe[0], POLLIN, 0};
    int ready = poll(&p, 1, 100);
    if (ready > 0 && (p.revents & POLLIN)) {
      uint8_t discarded[256];
      while (read(g_pipe[0], discarded, sizeof(discarded)) > 0)
        ;
    }
    const uint32_t count = g_record_count.load(std::memory_order_acquire);
    for (uint32_t i = 0; i < count; ++i) {
      if (g_record_state[i].load(std::memory_order_acquire) == kRecordFinal &&
          !writeRecord(i))
        g_publication_failed.store(true, std::memory_order_release);
    }
    if (g_stop.load(std::memory_order_acquire) &&
        g_producers_stopped.load(std::memory_order_acquire) &&
        g_in_flight.load(std::memory_order_acquire) == 0 &&
        g_records_persisted.load(std::memory_order_acquire) >=
            g_record_count.load(std::memory_order_acquire))
      break;
  }
  return nullptr;
}
void added(const mach_header *, intptr_t) {
  g_image_generation.fetch_add(1, std::memory_order_release);
}
void closeFd(int *fd) {
  if (*fd >= 0)
    close(*fd);
  *fd = -1;
}
void cleanup() {
  if (!g_initialized.exchange(false, std::memory_order_acq_rel))
    return;
  beginDrain();
  if (g_lifecycle_started.exchange(false, std::memory_order_acq_rel))
    pthread_join(g_lifecycle_thread, nullptr);
  if (g_control_started.exchange(false, std::memory_order_acq_rel))
    pthread_join(g_control_thread, nullptr);
  if (g_worker_started.exchange(false, std::memory_order_acq_rel))
    pthread_join(g_worker_thread, nullptr);
  if (g_instance_sealed.load(std::memory_order_acquire) &&
      !g_terminal_written.load(std::memory_order_acquire))
    (void)writeTerminalOnce();
  closeFd(&g_pipe[0]);
  closeFd(&g_pipe[1]);
  closeFd(&g_instance_fd);
  closeFd(&g_instances_fd);
  closeFd(&g_acks_fd);
  closeFd(&g_arms_fd);
  closeFd(&g_controls_fd);
  closeFd(&g_root_fd);
  const RuntimeMode mode = runtimeMode();
  const bool hadOutputObservers =
      mode == kRuntimeObserver || mode == kRuntimeFunctionalObserver;
  const bool computeCorrelationRestored =
      hadOutputObservers ? YaaglRestoreComputeCorrelationObserver() : true;
  const bool rtRestored =
      hadOutputObservers ? YaaglRestoreRtOutputObserver() : true;
  if (mode == kRuntimeObserver) {
    logFormat("observer summary observations=%u error19=%u exports=%u "
              "returned_null=%u returned_nonnull=%u unwound=%u "
              "rt_output_installed=%s rt_output_restored=%s "
              "compute_correlation_installed=%s compute_correlation_restored=%s\n",
              g_observer_observations.load(std::memory_order_acquire),
              g_observer_error19.load(std::memory_order_acquire),
              g_observer_exports.load(std::memory_order_acquire),
              g_returned_null.load(std::memory_order_acquire),
              g_returned_nonnull.load(std::memory_order_acquire),
              g_unwound.load(std::memory_order_acquire),
              g_rt_output_observer_installed.load(std::memory_order_acquire)
                  ? "true"
                  : "false",
              rtRestored ? "true" : "false",
              g_compute_correlation_observer_installed.load(
                  std::memory_order_acquire)
                  ? "true"
                  : "false",
              computeCorrelationRestored ? "true" : "false");
  } else if (mode == kRuntimeFunctional ||
             mode == kRuntimeFunctionalObserver) {
    logFormat("probe summary observations=%u matches=%u successes=%u error19=%u "
              "returned_null=%u returned_nonnull=%u unwound=%u "
              "rt_output_installed=%s rt_output_restored=%s "
              "compute_correlation_installed=%s compute_correlation_restored=%s\n",
              g_functional_observations.load(std::memory_order_acquire),
              g_functional_matches.load(std::memory_order_acquire),
              g_functional_successes.load(std::memory_order_acquire),
              g_functional_error19.load(std::memory_order_acquire),
              g_returned_null.load(std::memory_order_acquire),
              g_returned_nonnull.load(std::memory_order_acquire),
              g_unwound.load(std::memory_order_acquire),
              g_rt_output_observer_installed.load(std::memory_order_acquire)
                  ? "true"
                  : "false",
              rtRestored ? "true" : "false",
              g_compute_correlation_observer_installed.load(
                  std::memory_order_acquire)
                  ? "true"
                  : "false",
              computeCorrelationRestored ? "true" : "false");
  }
  closeFd(&g_log);
  g_protocol_state.store(kTerminal, std::memory_order_release);
  g_runtime_mode.store(kRuntimeNone, std::memory_order_release);
}

void *lifecycle(void *) {
  uint64_t observedGeneration = 0;
  while (!g_stop.load(std::memory_order_acquire)) {
    const uint64_t generation =
        g_image_generation.load(std::memory_order_acquire);
    if (generation != observedGeneration) {
      observedGeneration = generation;
      if (!imagesReady())
        continue;
      if (g_stop.load(std::memory_order_acquire) ||
          !g_initialized.load(std::memory_order_acquire))
        return nullptr;
      if (!install()) {
        const RuntimeMode mode = runtimeMode();
        logFormat("%s install failure\n",
                  mode == kRuntimeFunctional || mode == kRuntimeObserver ||
                          mode == kRuntimeFunctionalObserver
                      ? "probe"
                      : "metal-ir-capture-v2");
        return nullptr;
      }
      if (runtimeMode() == kRuntimeFunctional ||
          runtimeMode() == kRuntimeObserver ||
          runtimeMode() == kRuntimeFunctionalObserver)
        return nullptr;
      if (!writeArmedAck()) {
        logLine("metal-ir-capture-v2 acknowledgement failure\n");
        return nullptr;
      }
      if (g_stop.load(std::memory_order_acquire) ||
          !g_initialized.load(std::memory_order_acquire))
        return nullptr;
      if (pthread_create(&g_control_thread, nullptr, control, nullptr) != 0) {
        g_publication_failed.store(true, std::memory_order_release);
        return nullptr;
      }
      g_control_started.store(true, std::memory_order_release);
      return nullptr;
    }
    usleep(1000);
  }
  return nullptr;
}

extern "C" int YaaglMetalIrV2FixtureState() {
  if (!g_constructor_fixture)
    return -1;
  return static_cast<int>(g_protocol_state.load(std::memory_order_acquire));
}

extern "C" bool YaaglMetalIrV2FixtureDrain() {
  if (!g_constructor_fixture)
    return false;
  cleanup();
  return g_got_restored.load(std::memory_order_acquire) &&
         g_terminal_written.load(std::memory_order_acquire);
}

#ifndef YAAGL_CAPTURE_CONTRACT_TEST
__attribute__((destructor)) void fini() { cleanup(); }
__attribute__((constructor)) void init() {
  const char *mode = getenv("YAAGL_RUNTIME_MODE");
  RuntimeMode selectedMode = kRuntimeNone;
  if (mode && std::strcmp(mode, kMode) == 0)
    selectedMode = kRuntimeCapture;
  else if (mode && std::strcmp(mode, kFunctionalMode) == 0)
    selectedMode = kRuntimeFunctional;
  else if (mode && std::strcmp(mode, kFunctionalObserverMode) == 0)
    selectedMode = kRuntimeFunctionalObserver;
  else if (mode && std::strcmp(mode, kObserverMode) == 0)
    selectedMode = kRuntimeObserver;
  else
    return;
  g_runtime_mode.store(selectedMode, std::memory_order_release);

  const char *log = getenv("YAAGL_METAL_IR_LOG");
  if (log)
    g_log = open(log, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0600);
  copyEnv(g_functional_capture_path, sizeof(g_functional_capture_path),
          "YAAGL_METAL_IR_CAPTURE_PATH");
  uint32_t executablePathSize = sizeof(g_process_executable);
  if (_NSGetExecutablePath(g_process_executable, &executablePathSize) != 0)
    g_process_executable[0] = 0;

  if (selectedMode == kRuntimeCapture) {
    copyEnv(g_run_id, sizeof(g_run_id), "YAAGL_METAL_IR_RUN_ID");
    copyEnv(g_attempt_id, sizeof(g_attempt_id), "YAAGL_METAL_IR_ATTEMPT_ID");
    copyEnv(g_ack_token, sizeof(g_ack_token), "YAAGL_METAL_IR_ACK_TOKEN");
    copyEnv(g_capture_sha256, sizeof(g_capture_sha256),
            "YAAGL_METAL_IR_CAPTURE_SHA256");
    copyEnv(g_d3dmetal_sha256, sizeof(g_d3dmetal_sha256),
            "YAAGL_METAL_IR_D3DMETAL_SHA256");
    copyEnv(g_provider_sha256, sizeof(g_provider_sha256),
            "YAAGL_METAL_IR_PROVIDER_SHA256");
    copyEnv(g_configured_game_executable,
            sizeof(g_configured_game_executable),
            "YAAGL_METAL_IR_GAME_EXECUTABLE");
    g_constructor_fixture =
        std::getenv("YAAGL_METAL_IR_V2_CONSTRUCTOR_FIXTURE") != nullptr;
    if (g_constructor_fixture &&
        !parseFixtureOffset("YAAGL_METAL_IR_FIXTURE_GOT_OFFSET",
                            &g_fixture_got_offset))
      return;
  }

  g_initialized.store(true, std::memory_order_release);
  if (selectedMode == kRuntimeCapture) {
    if (!generateNonce() || !prepareSession() || pipe(g_pipe) != 0) {
      logLine("metal-ir-capture-v2 initialization failure\n");
      cleanup();
      return;
    }
    int writeFlags = fcntl(g_pipe[1], F_GETFL, 0);
    int readFlags = fcntl(g_pipe[0], F_GETFL, 0);
    if (writeFlags < 0 || readFlags < 0 ||
        fcntl(g_pipe[1], F_SETFL, writeFlags | O_NONBLOCK) != 0 ||
        fcntl(g_pipe[0], F_SETFL, readFlags | O_NONBLOCK) != 0) {
      cleanup();
      return;
    }
  } else {
    const char *modeText =
        selectedMode == kRuntimeObserver
            ? kObserverMode
            : (selectedMode == kRuntimeFunctionalObserver
                   ? kFunctionalObserverMode
                   : kFunctionalMode);
    logFormat("%s loaded mode=%s\n",
              selectedMode == kRuntimeObserver ? "observer" : "probe",
              modeText);
  }

  _dyld_register_func_for_add_image(added);
  if (pthread_create(&g_lifecycle_thread, nullptr, lifecycle, nullptr) != 0) {
    cleanup();
    return;
  }
  g_lifecycle_started.store(true, std::memory_order_release);
}
#endif

}  // namespace

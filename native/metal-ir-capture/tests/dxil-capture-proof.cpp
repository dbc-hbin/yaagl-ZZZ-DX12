#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <mach/mach.h>
#include <sys/mman.h>
#include <unistd.h>
#include <thread>
#include <utility>
#include <vector>

#if !defined(__x86_64__)
#error "dxil-capture-proof must model the x86_64 target ABI"
#endif

static_assert(sizeof(void *) == 8, "dxil-capture-proof requires 64-bit pointers");

namespace {

constexpr size_t kCaptureLimit = 4096;

int g_dxil_vtable_token;
int g_other_vtable_token;
const void *const kDxilVtable = &g_dxil_vtable_token;

// Mirrors only the validated IRObject_DXIL fields used by the proposed probe.
struct IRObjectDXIL {
  const void *vtable;       // +0x00
  uint64_t reserved;        // +0x08
  const uint8_t *bytes;     // +0x10
  uint32_t size;            // +0x18
  uint8_t type;             // +0x1c
  uint8_t owns_bytes;       // +0x1d
  uint16_t padding;
};

static_assert(offsetof(IRObjectDXIL, bytes) == 0x10,
              "DXIL byte pointer offset changed");
static_assert(offsetof(IRObjectDXIL, size) == 0x18,
              "DXIL byte size offset changed");
static_assert(offsetof(IRObjectDXIL, type) == 0x1c,
              "DXIL object type offset changed");
static_assert(offsetof(IRObjectDXIL, owns_bytes) == 0x1d,
              "DXIL ownership offset changed");

struct IRError {
  uint32_t code;
  std::atomic<int> getter_calls{0};
  std::atomic<int> destroy_calls{0};
  std::atomic<bool> destroyed{false};
};

uint32_t getErrorCode(IRError *error) {
  error->getter_calls.fetch_add(1, std::memory_order_relaxed);
  return error->code;
}

void destroyError(IRError *error) {
  error->destroy_calls.fetch_add(1, std::memory_order_relaxed);
  error->destroyed.store(true, std::memory_order_release);
}

struct Metadata {
  const void *vtable = nullptr;
  const uint8_t *bytes = nullptr;
  uint32_t size = 0;
  uint8_t type = 0;
  uint8_t owns_bytes = 0;
};

Metadata snapshot(const IRObjectDXIL *object) {
  if (!object) return {};
  return {object->vtable, object->bytes, object->size, object->type,
          object->owns_bytes};
}

bool operator==(const Metadata &left, const Metadata &right) {
  return left.vtable == right.vtable && left.bytes == right.bytes &&
         left.size == right.size && left.type == right.type &&
         left.owns_bytes == right.owns_bytes;
}

enum class CaptureReason {
  None,
  Copied,
  NoError,
  NonNullResult,
  UnexpectedErrorCode,
  MetadataMismatch,
  NullObject,
  InvalidVtable,
  InvalidType,
  OwnsBytes,
  ZeroSize,
  Oversize,
  AddressOverflow,
  Unreadable,
};

struct Capture {
  std::array<uint8_t, kCaptureLimit> private_copy{};
  size_t private_size = 0;
  uint32_t error_code = 0;
  Metadata metadata{};
  CaptureReason reason = CaptureReason::None;
  std::atomic<int> phase{0};  // 0=unclaimed, 1=caller owns it, 2=published
  std::atomic<int> copy_attempts{0};
};

struct Readability {
  const uint8_t *start = nullptr;
  size_t size = 0;
  bool allow = true;
  std::atomic<int> checks{0};

  bool contains(const uint8_t *address, size_t length) {
    checks.fetch_add(1, std::memory_order_relaxed);
    return allow && address == start && length <= size;
  }
};

enum class Mutation {
  None,
  Vtable,
  Bytes,
  Size,
  Type,
  Ownership,
};

struct ScriptedOriginal {
  IRObjectDXIL *result = nullptr;
  IRError *error_for_non_null_sink = nullptr;
  Mutation mutation = Mutation::None;
  const uint8_t *replacement_bytes = nullptr;
  std::atomic<int> calls{0};
  std::atomic<int> null_sinks{0};
  std::atomic<int> non_null_sinks{0};
  std::atomic<IRError **> last_sink{nullptr};

  IRObjectDXIL *call(IRObjectDXIL *object, IRError **sink) {
    calls.fetch_add(1, std::memory_order_relaxed);
    last_sink.store(sink, std::memory_order_release);
    if (sink) {
      non_null_sinks.fetch_add(1, std::memory_order_relaxed);
      if (error_for_non_null_sink) *sink = error_for_non_null_sink;
    } else {
      null_sinks.fetch_add(1, std::memory_order_relaxed);
    }

    if (!object) return result;
    switch (mutation) {
      case Mutation::None:
        break;
      case Mutation::Vtable:
        object->vtable = &g_other_vtable_token;
        break;
      case Mutation::Bytes:
        object->bytes = replacement_bytes;
        break;
      case Mutation::Size:
        ++object->size;
        break;
      case Mutation::Type:
        ++object->type;
        break;
      case Mutation::Ownership:
        object->owns_bytes = 1;
        break;
    }
    return result;
  }
};

class DxilCaptureProbe {
 public:
  DxilCaptureProbe(ScriptedOriginal &original, Readability &readability)
      : original_(original), readability_(readability) {}

  IRObjectDXIL *invoke(bool target_caller, IRObjectDXIL *object,
                        IRError **caller_sink) {
    int expected_phase = 0;
    const bool claimant = target_caller && caller_sink == nullptr &&
                          capture.phase.compare_exchange_strong(
                              expected_phase, 1, std::memory_order_acq_rel,
                              std::memory_order_acquire);
    if (!claimant) return original_.call(object, caller_sink);

    const Metadata before = snapshot(object);
    IRError *local_error = nullptr;
    IRObjectDXIL *const result = original_.call(object, &local_error);

    if (local_error) capture.error_code = getErrorCode(local_error);
    if (object == nullptr) {
      capture.reason = CaptureReason::NullObject;
    } else if (!(before == snapshot(object))) {
      capture.reason = CaptureReason::MetadataMismatch;
    } else if (result != nullptr) {
      capture.reason = CaptureReason::NonNullResult;
    } else if (!local_error) {
      capture.reason = CaptureReason::NoError;
    } else if (capture.error_code != 0x13) {
      capture.reason = CaptureReason::UnexpectedErrorCode;
    } else {
      capture.reason = copyIfValid(before);
    }

    if (local_error) destroyError(local_error);
    capture.phase.store(2, std::memory_order_release);
    return result;
  }

  Capture capture;

 private:
  CaptureReason copyIfValid(const Metadata &metadata) {
    if (metadata.vtable != kDxilVtable) return CaptureReason::InvalidVtable;
    if (metadata.type != 2) return CaptureReason::InvalidType;
    if (metadata.owns_bytes != 0) return CaptureReason::OwnsBytes;
    if (metadata.size == 0) return CaptureReason::ZeroSize;
    if (metadata.size > kCaptureLimit) return CaptureReason::Oversize;
    if (!metadata.bytes) return CaptureReason::Unreadable;

    const uintptr_t begin = reinterpret_cast<uintptr_t>(metadata.bytes);
    if (begin > std::numeric_limits<uintptr_t>::max() - metadata.size)
      return CaptureReason::AddressOverflow;
    if (!readability_.contains(metadata.bytes, metadata.size))
      return CaptureReason::Unreadable;

    capture.copy_attempts.fetch_add(1, std::memory_order_relaxed);
    std::memcpy(capture.private_copy.data(), metadata.bytes, metadata.size);
    capture.private_size = metadata.size;
    capture.metadata = metadata;
    return CaptureReason::Copied;
  }

  ScriptedOriginal &original_;
  Readability &readability_;
};

IRObjectDXIL makeDxilObject(const std::vector<uint8_t> &bytes) {
  return {kDxilVtable, 0, bytes.data(), static_cast<uint32_t>(bytes.size()), 2,
          0, 0};
}

bool expect(bool condition, const char *message) {
  if (condition) return true;
  std::fprintf(stderr, "dxil-capture-proof: %s\n", message);
  return false;
}

#define EXPECT(condition)               \
  do {                                  \
    if (!expect((condition), #condition)) return false; \
  } while (false)

bool expectErrorDisposedOnce(const IRError &error) {
  return expect(error.getter_calls.load(std::memory_order_acquire) == 1,
                "error getter must run exactly once") &&
         expect(error.destroy_calls.load(std::memory_order_acquire) == 1,
                "error destroy must run exactly once") &&
         expect(error.destroyed.load(std::memory_order_acquire),
                "error must be destroyed");
}

bool testExactResultIdentity() {
  const std::vector<uint8_t> bytes{1, 2, 3, 4};
  IRObjectDXIL input = makeDxilObject(bytes);
  IRObjectDXIL expected_result{};
  Readability readability{bytes.data(), bytes.size()};
  ScriptedOriginal original;
  original.result = &expected_result;
  DxilCaptureProbe probe(original, readability);

  EXPECT(probe.invoke(true, &input, nullptr) == &expected_result);
  EXPECT(original.calls.load(std::memory_order_acquire) == 1);
  EXPECT(original.non_null_sinks.load(std::memory_order_acquire) == 1);
  EXPECT(probe.capture.reason == CaptureReason::NonNullResult);
  EXPECT(probe.capture.copy_attempts.load(std::memory_order_acquire) == 0);
  EXPECT(probe.capture.phase.load(std::memory_order_acquire) == 2);
  return true;
}

bool testValidCopyAndErrorLifetime() {
  std::vector<uint8_t> bytes(257);
  for (size_t index = 0; index < bytes.size(); ++index)
    bytes[index] = static_cast<uint8_t>((index * 37) ^ 0x5a);
  IRObjectDXIL input = makeDxilObject(bytes);
  IRError error{0x13};
  Readability readability{bytes.data(), bytes.size()};
  ScriptedOriginal original;
  original.error_for_non_null_sink = &error;
  DxilCaptureProbe probe(original, readability);

  EXPECT(probe.invoke(true, &input, nullptr) == nullptr);
  EXPECT(probe.capture.reason == CaptureReason::Copied);
  EXPECT(probe.capture.error_code == 0x13);
  EXPECT(probe.capture.private_size == bytes.size());
  EXPECT(std::memcmp(probe.capture.private_copy.data(), bytes.data(),
                     bytes.size()) == 0);
  EXPECT(probe.capture.metadata == snapshot(&input));
  EXPECT(probe.capture.copy_attempts.load(std::memory_order_acquire) == 1);
  EXPECT(readability.checks.load(std::memory_order_acquire) == 1);
  return expectErrorDisposedOnce(error);
}

bool testInvalidMetadataAndReadabilityRefusals() {
  std::vector<uint8_t> normal(32, 0x7c);
  std::vector<uint8_t> oversize(kCaptureLimit + 1, 0x3e);

  struct Case {
    CaptureReason expected;
    void (*mutate)(IRObjectDXIL &, const std::vector<uint8_t> &,
                   const std::vector<uint8_t> &);
    bool readable;
    bool expect_readability_check;
  };

  const Case cases[] = {
      {CaptureReason::InvalidVtable,
       [](IRObjectDXIL &object, const std::vector<uint8_t> &,
          const std::vector<uint8_t> &) { object.vtable = &g_other_vtable_token; },
       true, false},
      {CaptureReason::InvalidType,
       [](IRObjectDXIL &object, const std::vector<uint8_t> &,
          const std::vector<uint8_t> &) { object.type = 3; },
       true, false},
      {CaptureReason::OwnsBytes,
       [](IRObjectDXIL &object, const std::vector<uint8_t> &,
          const std::vector<uint8_t> &) { object.owns_bytes = 1; },
       true, false},
      {CaptureReason::ZeroSize,
       [](IRObjectDXIL &object, const std::vector<uint8_t> &,
          const std::vector<uint8_t> &) { object.size = 0; },
       true, false},
      {CaptureReason::Oversize,
       [](IRObjectDXIL &object, const std::vector<uint8_t> &,
          const std::vector<uint8_t> &large) {
         object.bytes = large.data();
         object.size = static_cast<uint32_t>(large.size());
       },
       true, false},
      {CaptureReason::AddressOverflow,
       [](IRObjectDXIL &object, const std::vector<uint8_t> &,
          const std::vector<uint8_t> &) {
         object.bytes = reinterpret_cast<const uint8_t *>(
             std::numeric_limits<uintptr_t>::max() - 3);
         object.size = 8;
       },
       true, false},
      {CaptureReason::Unreadable,
       [](IRObjectDXIL &, const std::vector<uint8_t> &,
          const std::vector<uint8_t> &) {},
       false, true},
  };

  for (const Case &test_case : cases) {
    IRObjectDXIL input = makeDxilObject(normal);
    test_case.mutate(input, normal, oversize);
    IRError error{0x13};
    Readability readability{input.bytes, input.size, test_case.readable};
    ScriptedOriginal original;
    original.error_for_non_null_sink = &error;
    DxilCaptureProbe probe(original, readability);

    EXPECT(probe.invoke(true, &input, nullptr) == nullptr);
    EXPECT(probe.capture.reason == test_case.expected);
    EXPECT(probe.capture.copy_attempts.load(std::memory_order_acquire) == 0);
    EXPECT((readability.checks.load(std::memory_order_acquire) != 0) ==
           test_case.expect_readability_check);
    EXPECT(expectErrorDisposedOnce(error));
  }
  return true;
}

bool testMetadataMismatches() {
  const std::vector<uint8_t> normal(64, 0x4d);
  const std::vector<uint8_t> replacement(64, 0x1b);
  const Mutation mutations[] = {Mutation::Vtable, Mutation::Bytes,
                                Mutation::Size, Mutation::Type,
                                Mutation::Ownership};

  for (Mutation mutation : mutations) {
    IRObjectDXIL input = makeDxilObject(normal);
    IRError error{0x13};
    Readability readability{normal.data(), normal.size()};
    ScriptedOriginal original;
    original.error_for_non_null_sink = &error;
    original.mutation = mutation;
    original.replacement_bytes = replacement.data();
    DxilCaptureProbe probe(original, readability);

    EXPECT(probe.invoke(true, &input, nullptr) == nullptr);
    EXPECT(probe.capture.reason == CaptureReason::MetadataMismatch);
    EXPECT(probe.capture.copy_attempts.load(std::memory_order_acquire) == 0);
    EXPECT(readability.checks.load(std::memory_order_acquire) == 0);
    EXPECT(expectErrorDisposedOnce(error));
  }
  return true;
}

bool testAllNonNullErrorsAreDisposed() {
  const std::vector<uint8_t> bytes(16, 0x42);
  IRObjectDXIL input = makeDxilObject(bytes);
  IRObjectDXIL successful_result{};
  IRError error{0x99};
  Readability readability{bytes.data(), bytes.size()};
  ScriptedOriginal original;
  original.result = &successful_result;
  original.error_for_non_null_sink = &error;
  DxilCaptureProbe probe(original, readability);

  EXPECT(probe.invoke(true, &input, nullptr) == &successful_result);
  EXPECT(probe.capture.reason == CaptureReason::NonNullResult);
  return expectErrorDisposedOnce(error);
}

bool testNonTargetPreservesCallerSink() {
  const std::vector<uint8_t> bytes(16, 0x91);
  IRObjectDXIL input = makeDxilObject(bytes);
  IRObjectDXIL expected_result{};
  IRError caller_error{0x77};
  IRError *caller_sink = &caller_error;
  Readability readability{bytes.data(), bytes.size()};
  ScriptedOriginal original;
  original.result = &expected_result;
  DxilCaptureProbe probe(original, readability);

  EXPECT(probe.invoke(false, &input, &caller_sink) == &expected_result);
  EXPECT(original.last_sink.load(std::memory_order_acquire) == &caller_sink);
  EXPECT(caller_sink == &caller_error);
  EXPECT(original.null_sinks.load(std::memory_order_acquire) == 0);
  EXPECT(probe.capture.phase.load(std::memory_order_acquire) == 0);
  EXPECT(caller_error.getter_calls.load(std::memory_order_acquire) == 0);
  EXPECT(caller_error.destroy_calls.load(std::memory_order_acquire) == 0);
  return true;
}

bool testTwoTargetsHaveOneClaimant() {
  const std::vector<uint8_t> bytes(96, 0x3a);
  IRObjectDXIL input = makeDxilObject(bytes);
  IRError error{0x13};
  Readability readability{bytes.data(), bytes.size()};
  ScriptedOriginal original;
  original.error_for_non_null_sink = &error;
  DxilCaptureProbe probe(original, readability);
  std::atomic<int> ready{0};
  std::atomic<bool> release{false};
  IRObjectDXIL *first_result = reinterpret_cast<IRObjectDXIL *>(1);
  IRObjectDXIL *second_result = reinterpret_cast<IRObjectDXIL *>(1);

  auto run = [&](IRObjectDXIL **result) {
    ready.fetch_add(1, std::memory_order_release);
    while (!release.load(std::memory_order_acquire)) std::this_thread::yield();
    *result = probe.invoke(true, &input, nullptr);
  };
  std::thread first(run, &first_result);
  std::thread second(run, &second_result);
  while (ready.load(std::memory_order_acquire) != 2) std::this_thread::yield();
  release.store(true, std::memory_order_release);
  first.join();
  second.join();

  EXPECT(first_result == nullptr);
  EXPECT(second_result == nullptr);
  EXPECT(original.calls.load(std::memory_order_acquire) == 2);
  EXPECT(original.non_null_sinks.load(std::memory_order_acquire) == 1);
  EXPECT(original.null_sinks.load(std::memory_order_acquire) == 1);
  EXPECT(probe.capture.reason == CaptureReason::Copied);
  EXPECT(probe.capture.copy_attempts.load(std::memory_order_acquire) == 1);
  EXPECT(expectErrorDisposedOnce(error));
  return true;
}

bool testWorkerSeesPrivateCopyAfterSourceInvalidation() {
  std::vector<uint8_t> source(211);
  for (size_t index = 0; index < source.size(); ++index)
    source[index] = static_cast<uint8_t>(index ^ 0xa7);
  const std::vector<uint8_t> expected = source;
  IRObjectDXIL input = makeDxilObject(source);
  IRError error{0x13};
  Readability readability{source.data(), source.size()};
  ScriptedOriginal original;
  original.error_for_non_null_sink = &error;
  DxilCaptureProbe probe(original, readability);
  std::atomic<bool> source_invalidated{false};
  std::atomic<bool> worker_saw_complete_copy{false};

  std::thread worker([&] {
    while (probe.capture.phase.load(std::memory_order_acquire) != 2)
      std::this_thread::yield();
    while (!source_invalidated.load(std::memory_order_acquire))
      std::this_thread::yield();
    const bool complete =
        probe.capture.reason == CaptureReason::Copied &&
        probe.capture.private_size == expected.size() &&
        std::memcmp(probe.capture.private_copy.data(), expected.data(),
                    expected.size()) == 0;
    worker_saw_complete_copy.store(complete, std::memory_order_release);
  });

  EXPECT(probe.invoke(true, &input, nullptr) == nullptr);
  std::vector<uint8_t>().swap(source);  // The worker must not retain this pointer.
  source_invalidated.store(true, std::memory_order_release);
  worker.join();

  EXPECT(worker_saw_complete_copy.load(std::memory_order_acquire));
  return expectErrorDisposedOnce(error);
}

bool safeSelfCopy(const void *source, size_t length, void *destination) {
  const uintptr_t begin = reinterpret_cast<uintptr_t>(source);
  if (!source || !destination || length == 0 ||
      begin > std::numeric_limits<uintptr_t>::max() - length)
    return false;
  vm_size_t copied = 0;
  return vm_read_overwrite(mach_task_self(),
                           reinterpret_cast<vm_address_t>(source), length,
                           reinterpret_cast<vm_address_t>(destination),
                           &copied) == KERN_SUCCESS &&
         copied == length;
}

bool testFailureReportingSelfCopyAcrossVmRegions() {
  const size_t page = static_cast<size_t>(getpagesize());
  const size_t length = page * 3;
  auto *source = static_cast<uint8_t *>(
      mmap(nullptr, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1,
           0));
  auto *destination = static_cast<uint8_t *>(
      mmap(nullptr, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1,
           0));
  EXPECT(source != MAP_FAILED);
  EXPECT(destination != MAP_FAILED);
  for (size_t index = 0; index < length; ++index)
    source[index] = static_cast<uint8_t>((index * 13) ^ 0xa5);

  EXPECT(safeSelfCopy(source, length, destination));
  EXPECT(std::memcmp(source, destination, length) == 0);
  EXPECT(mprotect(source + page, page, PROT_NONE) == 0);
  std::memset(destination, 0, length);
  EXPECT(!safeSelfCopy(source, length, destination));
  EXPECT(mprotect(source + page, page, PROT_READ | PROT_WRITE) == 0);
  EXPECT(!safeSelfCopy(nullptr, length, destination));
  EXPECT(!safeSelfCopy(
      reinterpret_cast<const void *>(
          std::numeric_limits<uintptr_t>::max() - 3),
      8, destination));
  EXPECT(munmap(source, length) == 0);
  EXPECT(munmap(destination, length) == 0);
  return true;
}

}  // namespace

int main() {
  return testExactResultIdentity() && testValidCopyAndErrorLifetime() &&
                 testInvalidMetadataAndReadabilityRefusals() &&
                 testMetadataMismatches() && testAllNonNullErrorsAreDisposed() &&
                 testNonTargetPreservesCallerSink() &&
                 testTwoTargetsHaveOneClaimant() &&
                 testWorkerSeesPrivateCopyAfterSourceInvalidation() &&
                 testFailureReportingSelfCopyAcrossVmRegions()
             ? 0
             : 1;
}

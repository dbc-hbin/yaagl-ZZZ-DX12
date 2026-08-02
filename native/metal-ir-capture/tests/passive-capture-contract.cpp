#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <thread>
#include <unistd.h>

#define YAAGL_CAPTURE_CONTRACT_TEST 1
#include "../metal-ir-capture.cpp"

struct IRCompiler {};
struct IRObject {};
struct IRError {};

namespace {

int g_observer_original_calls = 0;
const IRObject *g_observer_original_object = nullptr;

IRObject *observerOriginal(IRCompiler *, const std::vector<std::string> &,
                           const IRObject *object, IRError **) {
  ++g_observer_original_calls;
  g_observer_original_object = object;
  return const_cast<IRObject *>(object);
}

void exact_passive_target_only() {
  static_assert(kConfiguredCallerOffset == 0x87ec9);
  assert(std::strcmp(kConfiguredOffsetText, "0x87ec9") == 0);
  const uintptr_t base = 0x100000000ULL;
  assert(isConfiguredCallerOffset(base + 0x87ec9, base));
  assert(!isConfiguredCallerOffset(base + 0x87ec8, base));
  assert(!isConfiguredCallerOffset(base + 0x87eca, base));
  assert(isFunctionalCallerOffset(base + 0x87ec9, base));
  assert(isFunctionalCallerOffset(base + 0x9a12f, base));
  assert(!isFunctionalCallerOffset(base + 0x9a12e, base));
}

void exact_functional_source_identity() {
  static_assert(kFunctionalSourceBytes == 26964);
  static_assert(kFunctionalReplacementBytes == 17720);
  uint8_t sourceDigest[32]{};
  for (size_t i = 0; i < sizeof(sourceDigest); ++i) {
    const char pair[] = {kFunctionalSourceSha256[i * 2],
                         kFunctionalSourceSha256[i * 2 + 1], 0};
    sourceDigest[i] = static_cast<uint8_t>(std::strtoul(pair, nullptr, 16));
  }
  assert(matchesFunctionalSource(kFunctionalSourceBytes, sourceDigest));
  assert(!matchesFunctionalSource(kFunctionalSourceBytes - 1, sourceDigest));
  sourceDigest[0] ^= 1;
  assert(!matchesFunctionalSource(kFunctionalSourceBytes, sourceDigest));
}

void functional_scratch_is_thread_local() {
  Slot *mainScratch = &g_functional_scratch;
  Slot *workerScratch = nullptr;
  Slot *mainObserverScratch = &g_observer_scratch;
  Slot *workerObserverScratch = nullptr;
  std::thread worker([&] {
    workerScratch = &g_functional_scratch;
    workerObserverScratch = &g_observer_scratch;
  });
  worker.join();
  assert(workerScratch != nullptr);
  assert(workerScratch != mainScratch);
  assert(workerObserverScratch != nullptr);
  assert(workerObserverScratch != mainObserverScratch);
}

void observer_compile_is_inert_and_correlated() {
  assert(std::strcmp(inferObserverStage({"-stage=compute"}), "compute") == 0);
  assert(std::strcmp(inferObserverStage({"target=fragment"}), "fragment") == 0);
  assert(std::strcmp(inferObserverStage({"lib_6_6", "closesthit"}),
                     "closesthit") == 0);

  struct FakeError {
    void *vtable = nullptr;
    uint32_t code = 0x13;
    uint32_t padding = 0;
  } error;
  IRError *errorPointer = reinterpret_cast<IRError *>(&error);
  uint32_t code = 0;
  const char *status = nullptr;
  assert(readObserverErrorCode(&errorPointer, &code, &status));
  assert(code == 0x13 && std::strcmp(status, "code") == 0);

  const uintptr_t base = 0x100000000ULL;
  g_d3dmetal = reinterpret_cast<const mach_header_64 *>(base);
  char stackText[64]{};
  assert(std::strcmp(inferObserverContext(base + kHistoricalRtCallerOffset,
                                          "unknown", stackText,
                                          sizeof(stackText)),
                     "rt") == 0);

  struct FakeObjectLayout {
    void *vtable = nullptr;
    uint64_t reserved = 0;
    const uint8_t *bytes = nullptr;
    uint32_t size = 0;
    uint8_t type = 2;
    uint8_t owns = 0;
    uint16_t padding = 0;
  } object;
  static_assert(sizeof(FakeObjectLayout) == 0x20);
  const uint8_t payload[] = {'D', 'X', 'B', 'C'};
  object.bytes = payload;
  object.size = sizeof(payload);
  g_constructor_fixture = true;
  g_provider = reinterpret_cast<const mach_header_64 *>(uintptr_t(1));
  g_functional_capture_path[0] = 0;
  g_observer_original_calls = 0;
  g_observer_original_object = nullptr;
  IRCompiler compiler;
  IRError *noError = nullptr;
  const IRObject *input = reinterpret_cast<const IRObject *>(&object);
  IRObject *result = invokeObserverCompile(
      &compiler, {"-stage=compute"}, input, &noError, &observerOriginal,
      base + kConfiguredCallerOffset);
  assert(result == input);
  assert(g_observer_original_calls == 1);
  assert(g_observer_original_object == input);
  assert(object.bytes == payload && object.size == sizeof(payload));
  g_constructor_fixture = false;
  g_provider = nullptr;
  g_d3dmetal = nullptr;
}

void bounded_functional_source_export() {
  const auto root = std::filesystem::temp_directory_path() /
                    "yaagl-metal-ir-functional-export";
  std::filesystem::remove_all(root);
  std::filesystem::create_directories(root);
  const std::string capture = (root / "probe.log").string();
  std::strncpy(g_functional_capture_path, capture.c_str(),
               sizeof(g_functional_capture_path) - 1);
  Slot slot{};
  slot.size = 4;
  std::memcpy(slot.bytes, "DXIL", slot.size);
  assert(digest(slot.bytes, slot.size, slot.digest));
  char hash[65]{};
  char path[PATH_MAX]{};
  assert(hexBytes(slot.digest, sizeof(slot.digest), hash, sizeof(hash)));
  assert(exportFunctionalSource(slot, hash, path, sizeof(path)));
  assert(std::ifstream(path, std::ios::binary).good());
  assert(exportFunctionalSource(slot, hash, path, sizeof(path)));
  std::filesystem::remove_all(root);
  g_functional_capture_path[0] = 0;
}

void strict_seven_field_arm_parser() {
  std::strcpy(g_nonce,
              "0123456789abcdef0123456789abcdef");
  std::strcpy(g_ack_raw_sha256,
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const char *valid =
      "{\"schema\":2,\"mode\":\"metal-ir-capture-v2\",\"state\":\"armed\","
      "\"uid\":%u,\"pid\":%d,\"nonce\":\"%s\","
      "\"ack_sha256\":\"%s\"}";
  char body[512]{};
  int n = std::snprintf(body, sizeof(body), valid, getuid(), getpid(), g_nonce,
                        g_ack_raw_sha256);
  ArmMessage message{};
  assert(n > 0 && parseArmStrict(body, static_cast<size_t>(n), &message));
  const char *extra =
      "{\"schema\":2,\"mode\":\"metal-ir-capture-v2\",\"state\":\"armed\","
      "\"uid\":1,\"pid\":1,\"nonce\":\"x\",\"ack_sha256\":\"x\",\"extra\":1}";
  assert(!parseArmStrict(extra, std::strlen(extra), &message));
  const char *duplicate =
      "{\"schema\":2,\"schema\":2,\"mode\":\"metal-ir-capture-v2\","
      "\"state\":\"armed\",\"uid\":1,\"pid\":1,\"nonce\":\"x\","
      "\"ack_sha256\":\"x\"}";
  assert(!parseArmStrict(duplicate, std::strlen(duplicate), &message));
}

void descriptor_relative_exclusive_persistence() {
  const auto root = std::filesystem::temp_directory_path() /
                    "yaagl-metal-ir-v2-descriptor-contract";
  std::filesystem::remove_all(root);
  std::filesystem::create_directories(root);
  int rootFd = open(root.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  assert(rootFd >= 0);
  const char bytes[] = "one";
  assert(writeImmutableAt(rootFd, "item.json", bytes, sizeof(bytes) - 1));
  assert(!writeImmutableAt(rootFd, "item.json", bytes, sizeof(bytes) - 1));
  std::filesystem::create_symlink(root / "item.json", root / "link.json");
  assert(!writeImmutableAt(rootFd, "link.json", bytes, sizeof(bytes) - 1));
  close(rootFd);
  std::filesystem::remove_all(root);
}

void fixed_capacity_is_preallocated() {
  static_assert(sizeof(g_slots) / sizeof(g_slots[0]) == kSlotCap);
  static_assert(sizeof(g_blobs) / sizeof(g_blobs[0]) == kBlobCap);
  static_assert(sizeof(g_functional_cache) / sizeof(g_functional_cache[0]) ==
                kFunctionalCacheCap);
  static_assert(sizeof(g_functional_negative_cache) /
                    sizeof(g_functional_negative_cache[0]) ==
                kFunctionalNegativeCacheCap);
  static_assert(sizeof(g_slots[0].bytes) == kPayloadBytes);
  static_assert(sizeof(g_blobs[0].bytes) == kPayloadBytes);
  assert(kSlotCap == 32 && kBlobCap == 32 && kPayloadBytes == 65536);
}

void deterministic_functional_negative_cache_is_separate_and_exact() {
  g_functional_cache_count = 0;
  g_functional_negative_cache_count = 0;
  std::memset(g_functional_cache, 0, sizeof(g_functional_cache));
  std::memset(g_functional_negative_cache, 0,
              sizeof(g_functional_negative_cache));

  uint8_t unhandledDigest[CC_SHA256_DIGEST_LENGTH]{};
  uint8_t noMatchDigest[CC_SHA256_DIGEST_LENGTH]{};
  unhandledDigest[0] = 0x11;
  noMatchDigest[0] = 0x22;

  FunctionalSelection selection{};
  assert(!selectCachedFunctionalNegativeResult(unhandledDigest, &selection));
  cacheDeterministicFunctionalNegativeResult(
      unhandledDigest, yaagl::metal_ir::Unorm24TransformStatus::kUnhandledFp64,
      27);
  assert(g_functional_negative_cache_count == 1);
  assert(g_functional_cache_count == 0);
  assert(selectCachedFunctionalNegativeResult(unhandledDigest, &selection));
  assert(selection.object == nullptr);
  assert(std::strcmp(selection.kind, "original") == 0);
  assert(std::strcmp(selection.reason, "unhandled_fp64") == 0);
  assert(selection.graph_count == 27);

  // Duplicate source records are idempotent, so a repeated shader cannot
  // consume capacity while it is returning its cached original object.
  cacheDeterministicFunctionalNegativeResult(
      unhandledDigest, yaagl::metal_ir::Unorm24TransformStatus::kUnhandledFp64,
      99);
  assert(g_functional_negative_cache_count == 1);
  selection = FunctionalSelection{};
  assert(selectCachedFunctionalNegativeResult(unhandledDigest, &selection));
  assert(selection.graph_count == 27);

  cacheDeterministicFunctionalNegativeResult(
      noMatchDigest, yaagl::metal_ir::Unorm24TransformStatus::kNoMatch, 0);
  assert(g_functional_negative_cache_count == 2);
  selection = FunctionalSelection{};
  assert(selectCachedFunctionalNegativeResult(noMatchDigest, &selection));
  assert(std::strcmp(selection.reason, "no_match") == 0);
  assert(selection.graph_count == 0);

  // Transient/runtime statuses deliberately cannot enter the negative cache.
  cacheDeterministicFunctionalNegativeResult(
      noMatchDigest, yaagl::metal_ir::Unorm24TransformStatus::kTooLarge, 3);
  assert(g_functional_negative_cache_count == 2);

  for (uint32_t i = 0; i < kFunctionalNegativeCacheCap - 2; ++i) {
    uint8_t digest[CC_SHA256_DIGEST_LENGTH]{};
    digest[0] = 0x33;
    digest[1] = static_cast<uint8_t>(i);
    cacheDeterministicFunctionalNegativeResult(
        digest, yaagl::metal_ir::Unorm24TransformStatus::kNoMatch, 0);
  }
  assert(g_functional_negative_cache_count == kFunctionalNegativeCacheCap);
  uint8_t overflowDigest[CC_SHA256_DIGEST_LENGTH]{};
  overflowDigest[0] = 0x44;
  cacheDeterministicFunctionalNegativeResult(
      overflowDigest, yaagl::metal_ir::Unorm24TransformStatus::kNoMatch, 0);
  assert(g_functional_negative_cache_count == kFunctionalNegativeCacheCap);
  selection = FunctionalSelection{};
  assert(selectCachedFunctionalNegativeResult(unhandledDigest, &selection));
  assert(selection.graph_count == 27);
  assert(!selectCachedFunctionalNegativeResult(overflowDigest, &selection));
  assert(g_functional_cache_count == 0);
}

void monotonic_authorization_window() {
  g_protocol_state.store(kInstalledAcked);
  g_arms_fd = -1;
  g_auth_started_ns.store(100);
  assert(!controlStep(100 + kAuthorizationWindowNs - 1));
  assert(!g_auth_timeout.load());
  // This unit exercises only the deadline predicate; it intentionally leaves
  // file descriptors absent, so terminal publication is not attempted here.
  g_protocol_state.store(kInstalledAcked);
  g_auth_started_ns.store(100);
  assert(!controlStep(100 + kAuthorizationWindowNs));
  assert(g_auth_timeout.load());
  assert(g_protocol_state.load() == kAuthClosed);
  g_protocol_state.store(kDormant);
}

}  // namespace

int main() {
  exact_passive_target_only();
  exact_functional_source_identity();
  functional_scratch_is_thread_local();
  observer_compile_is_inert_and_correlated();
  bounded_functional_source_export();
  strict_seven_field_arm_parser();
  descriptor_relative_exclusive_persistence();
  fixed_capacity_is_preallocated();
  deterministic_functional_negative_cache_is_separate_and_exact();
  monotonic_authorization_window();
  std::puts("passive-capture-contract: exact_targets observer_inert error19 thread_local_scratch bounded_export strict_arm descriptor_relative fixed_capacity negative_cache monotonic_auth");
  return 0;
}

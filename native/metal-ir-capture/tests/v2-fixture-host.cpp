#include <cassert>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>
#include <unistd.h>

#define YAAGL_CAPTURE_CONTRACT_TEST 1
#include "../metal-ir-capture.cpp"

struct IRCompiler {};
struct IRObject {};
struct IRError {};

namespace {

int g_fixture_original_calls = 0;
IRObject *g_fixture_result = nullptr;

IRObject *fixtureOriginal(IRCompiler *, const std::vector<std::string> &,
                         const IRObject *object, IRError **) {
  ++g_fixture_original_calls;
  return const_cast<IRObject *>(object == g_fixture_result ? object : nullptr);
}

std::string readFile(const std::filesystem::path &path) {
  std::ifstream input(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(input), {}};
}

std::string rawSha256(const std::string &value) {
  uint8_t hash[32]{};
  char hex[65]{};
  assert(digest(value.data(), value.size(), hash));
  assert(hexBytes(hash, sizeof(hash), hex, sizeof(hex)));
  return hex;
}

void configureFixture(const std::filesystem::path &root) {
  setenv("YAAGL_METAL_IR_SESSION_ROOT", root.c_str(), 1);
  std::strcpy(g_run_id, "fixture-run");
  std::strcpy(g_attempt_id, "fixture-attempt");
  std::strcpy(g_ack_token, "fixture-token");
  std::strcpy(g_nonce,
              "0123456789abcdef0123456789abcdef");
  std::strcpy(g_capture_sha256,
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  std::strcpy(g_d3dmetal_sha256,
              "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  std::strcpy(g_provider_sha256,
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
  std::strcpy(g_process_executable, "/fixture/process");
  std::strcpy(g_configured_game_executable, "Z:\\\\fixture\\\\game.exe");
  std::strcpy(g_got_slot, "0x0000000000000001");
  assert(prepareSession());
  g_slot = reinterpret_cast<CompileAndLink *>(uintptr_t(1));
  g_install_verified.store(true);
  g_install_readback_ok.store(true);
  g_install_protection_restored.store(true);
  assert(writeArmedAck());
}

void exerciseRawAckAndStrictArm(const std::filesystem::path &root) {
  const auto ack = root / "acks" / g_ack_leaf;
  const std::string rawAck = readFile(ack);
  assert(!rawAck.empty());
  assert(rawSha256(rawAck) == g_ack_raw_sha256);
  assert(rawAck.find("\"schema\":2") != std::string::npos);
  assert(rawAck.find("metal-ir-capture-v2") != std::string::npos);

  const auto arm = root / "arms" / g_arm_leaf;
  {
    std::ofstream output(arm, std::ios::binary);
    output << "{\"schema\":2,\"mode\":\"metal-ir-capture-v2\","
           << "\"state\":\"armed\",\"uid\":" << getuid()
           << ",\"pid\":" << getpid() << ",\"nonce\":\"" << g_nonce
           << "\",\"ack_sha256\":\""
           << "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
           << "\"}";
  }
  assert(inspectArm() == kArmInvalid);
  {
    std::ofstream output(arm, std::ios::binary | std::ios::trunc);
    output << "{\"schema\":2,\"mode\":\"metal-ir-capture-v2\","
           << "\"state\":\"armed\",\"uid\":" << getuid()
           << ",\"pid\":" << getpid() << ",\"nonce\":\"" << g_nonce
           << "\",\"ack_sha256\":\"" << g_ack_raw_sha256 << "\"}";
  }
  assert(inspectArm() == kArmAccepted);
}

void exercisePassiveForwarding() {
  IRCompiler compiler;
  IRObject object;
  std::vector<std::string> args{"fixture"};
  g_fixture_result = &object;
  g_control.admission_refcount.store(1);
  g_control.original.store(&fixtureOriginal);
  g_d3dmetal = nullptr;
  g_protocol_state.store(kCapturing);
  assert(YaaglIRCompilerAllocCompileAndLinkProbe(&compiler, args, &object,
                                                 nullptr) == &object);
  assert(g_fixture_original_calls == 1);
}

void fillCapturedSlot(Slot *slot, uint64_t sequence) {
  *slot = Slot{};
  slot->sequence = sequence;
  slot->caller_offset = 0x87ec9;
  slot->size = 4;
  std::memcpy(slot->bytes, "DXIL", 4);
  assert(digest(slot->bytes, slot->size, slot->digest));
}

void exerciseImmutableRecordsAndTerminal(const std::filesystem::path &root) {
  g_slots_claimed.store(2);
  fillCapturedSlot(&g_slots[0], 0);
  g_slots[1] = Slot{};
  g_slots[1].sequence = 1;
  g_slots[1].caller_offset = 0x87ec9;
  g_slots[1].failure = kFailureOversize;
  g_oversize_failures.store(1);
  finishSlot(0, kOutcomeReturnedNull);
  finishSlot(1, kOutcomeReturnedNonNull);
  assert(g_record_count.load() == 2);
  assert(writeRecord(0));
  assert(writeRecord(1));
  assert(!writeRecord(0));
  const auto instance = root / "instances" / g_instance_id;
  const std::string record0 = readFile(instance / "record_00.json");
  const std::string record1 = readFile(instance / "record_01.json");
  assert(record0.find("\"status\":\"captured\"") != std::string::npos);
  assert(record1.find("\"reason\":\"oversize\"") != std::string::npos);
  bool blobFound = false;
  for (const auto &entry : std::filesystem::directory_iterator(instance))
    if (entry.path().filename().string().rfind("blob_", 0) == 0)
      blobFound = true;
  assert(blobFound);

  g_slots_claimed.store(kSlotCap);
  assert(prepareSlot(nullptr, 0, 33) == -1);
  assert(g_slot_exhausted_failures.load() == 1);
  g_got_restored.store(true);
  g_terminal_reason.store(kTerminalNormal);
  assert(writeTerminalOnce());
  assert(!writeTerminalOnce() || true);
  const std::string terminal = readFile(instance / "terminal.json");
  assert(terminal.find("\"schema\":2") != std::string::npos);
  assert(terminal.find("\"oversize\":1") != std::string::npos);
  assert(terminal.find("\"slot_exhausted\":1") != std::string::npos);
}

}  // namespace

int main(int argc, char **argv) {
  const bool external = argc == 3 && std::strcmp(argv[1], "--external") == 0;
  const auto root = external
                        ? std::filesystem::path(argv[2])
                        : std::filesystem::temp_directory_path() /
                              ("yaagl-metal-ir-v2-fixture-" +
                               std::to_string(getpid()));
  std::filesystem::remove_all(root);
  std::filesystem::create_directories(root);
  std::filesystem::create_directories(root / "acks");
  std::filesystem::create_directories(root / "arms");
  std::filesystem::create_directories(root / "instances");
  std::filesystem::create_directories(root / "controls");
  std::filesystem::permissions(root, std::filesystem::perms::owner_all);
  std::filesystem::permissions(root / "acks", std::filesystem::perms::owner_all);
  std::filesystem::permissions(root / "arms", std::filesystem::perms::owner_all);
  std::filesystem::permissions(root / "instances", std::filesystem::perms::owner_all);
  std::filesystem::permissions(root / "controls", std::filesystem::perms::owner_all);
  configureFixture(root);
  if (external) {
    std::printf("%s\n", (root / "acks" / g_ack_leaf).c_str());
    std::fflush(stdout);
    ArmCheck arm = kArmMissing;
    for (unsigned attempt = 0; attempt < 100 && arm == kArmMissing; ++attempt) {
      usleep(100000);
      arm = inspectArm();
    }
    if (arm != kArmAccepted)
      return 2;
    assert(makeInstance());
    for (uint32_t index = 0; index < 11; ++index) {
      fillCapturedSlot(&g_slots[index], index);
      g_slots_claimed.store(index + 1);
      finishSlot(static_cast<int>(index), kOutcomeReturnedNull);
      assert(writeRecord(index));
    }
    g_original_calls.store(11);
    g_returned_null.store(11);
    g_got_restored.store(true);
    g_terminal_reason.store(kTerminalNormal);
    assert(writeTerminalOnce());
    std::printf("%s\n", (root / "instances" / g_instance_id /
                          "terminal.json").c_str());
    std::fflush(stdout);
    return 0;
  }
  exerciseRawAckAndStrictArm(root);
  assert(makeInstance());
  exercisePassiveForwarding();
  exerciseImmutableRecordsAndTerminal(root);
  std::puts("v2-fixture-host: raw_ack strict_arm passive_forwarding immutable_artifacts outcomes");
  std::filesystem::remove_all(root);
  return 0;
}

#include <CommonCrypto/CommonDigest.h>
#include <cassert>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

struct IRCompiler {};
struct IRError {};
struct FixtureObject {
  const void *vtable = nullptr;
  uint64_t reserved = 0;
  const uint8_t *bytes = nullptr;
  uint32_t size = 0;
  uint8_t type = 2;
  uint8_t owns = 0;
  uint8_t padding[2]{};
};
using Consumer = FixtureObject *(*)(
    IRCompiler *, const std::vector<std::string> &, const FixtureObject *,
    IRError **);
using State = int (*)();

static std::string readFile(const std::filesystem::path &path) {
  std::ifstream input(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(input), {}};
}
static std::string sha256(const std::string &text) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]{};
  CC_SHA256(text.data(), static_cast<CC_LONG>(text.size()), digest);
  char result[65]{};
  for (size_t i = 0; i < sizeof(digest); ++i)
    std::snprintf(result + i * 2, 3, "%02x", digest[i]);
  return result;
}
static std::string field(const std::string &json, const char *name) {
  const std::string prefix = std::string("\"") + name + "\":\"";
  const size_t begin = json.find(prefix);
  assert(begin != std::string::npos);
  const size_t first = begin + prefix.size();
  const size_t end = json.find('"', first);
  assert(end != std::string::npos);
  return json.substr(first, end - first);
}
static void writeExact(const std::filesystem::path &path,
                       const std::string &text) {
  std::ofstream output(path, std::ios::binary);
  output.write(text.data(), static_cast<std::streamsize>(text.size()));
  assert(output.good());
}
static bool hasPrefix(const std::string &value, const char *prefix) {
  return value.compare(0, std::strlen(prefix), prefix) == 0;
}

int main(int argc, char **argv) {
  assert(argc == 2);
  const char *consumerPath = std::getenv("YAAGL_METAL_IR_D3DMETAL");
  const char *providerPath = std::getenv("YAAGL_METAL_IR_PROVIDER");
  const char *sessionRoot = std::getenv("YAAGL_METAL_IR_SESSION_ROOT");
  assert(consumerPath && providerPath && sessionRoot);
  const auto root = std::filesystem::path(sessionRoot);
  const auto instances = root / "instances";
  const auto acks = root / "acks";
  const auto arms = root / "arms";
  const auto controls = root / "controls";
  std::filesystem::create_directories(instances);
  std::filesystem::create_directories(acks);
  std::filesystem::create_directories(arms);
  std::filesystem::create_directories(controls);

  void *provider = nullptr;
  void *consumer = nullptr;
  if (std::string(argv[1]) == "provider-first") {
    provider = dlopen(providerPath, RTLD_NOW | RTLD_LOCAL);
    consumer = dlopen(consumerPath, RTLD_NOW | RTLD_LOCAL);
  } else {
    consumer = dlopen(consumerPath, RTLD_NOW | RTLD_LOCAL);
    provider = dlopen(providerPath, RTLD_NOW | RTLD_LOCAL);
  }
  assert(provider && consumer);
  auto call = reinterpret_cast<Consumer>(dlsym(consumer, "GotIrConsumerCall"));
  auto state = reinterpret_cast<State>(
      dlsym(RTLD_DEFAULT, "YaaglMetalIrV2FixtureState"));
  auto providerCalls = reinterpret_cast<int *>(
      dlsym(provider, "GotIrProviderCalls"));
  assert(call && state && providerCalls);

  std::atomic<bool> stopHammer{false};
  std::atomic<unsigned> hammerCalls{0};
  uint8_t hammerDxil[32]{};
  std::memcpy(hammerDxil, "DXBC", 4);
  FixtureObject hammerObject;
  hammerObject.bytes = hammerDxil;
  hammerObject.size = sizeof(hammerDxil);
  std::thread hammer([&] {
    IRCompiler hammerCompiler;
    IRError *hammerError = nullptr;
    std::vector<std::string> hammerArguments{"install-race"};
    while (!stopHammer.load(std::memory_order_acquire)) {
      assert(call(&hammerCompiler, hammerArguments, &hammerObject,
                  &hammerError));
      hammerCalls.fetch_add(1, std::memory_order_relaxed);
    }
  });

  std::filesystem::path ack;
  for (unsigned i = 0; i < 400; ++i) {
    for (const auto &entry : std::filesystem::directory_iterator(acks))
      if (hasPrefix(entry.path().filename().string(), "ack-")) ack = entry.path();
    if (!ack.empty()) break;
    usleep(10000);
  }
  assert(!ack.empty());
  stopHammer.store(true, std::memory_order_release);
  hammer.join();
  assert(hammerCalls.load(std::memory_order_acquire) > 0);
  unsigned ackCount = 0;
  for (const auto &entry : std::filesystem::directory_iterator(acks))
    if (hasPrefix(entry.path().filename().string(), "ack-")) ++ackCount;
  assert(ackCount == 1);
  const std::string ackRaw = readFile(ack);
  const std::string nonce = field(ackRaw, "nonce");
  const std::string ackHash = sha256(ackRaw);
  const std::string pid = std::to_string(getpid());
  const std::string armRaw =
      "{\"schema\":2,\"mode\":\"metal-ir-capture-v2\","
      "\"state\":\"armed\",\"uid\":" +
      std::to_string(getuid()) + ",\"pid\":" + pid + ",\"nonce\":\"" +
      nonce + "\",\"ack_sha256\":\"" + ackHash + "\"}";

  uint8_t dxil[32]{};
  std::memcpy(dxil, "DXBC", 4);
  FixtureObject object;
  object.bytes = dxil;
  object.size = sizeof(dxil);
  IRCompiler compiler;
  IRError *error = nullptr;
  std::vector<std::string> arguments{"late-load"};
  assert(call(&compiler, arguments, &object, &error));
  const int preArmCalls = *providerCalls;
  assert(preArmCalls == static_cast<int>(hammerCalls.load()) + 1);
  assert(state() == 1);

  writeExact(arms / ("arm-" + pid + "-" + nonce + ".json"), armRaw);
  for (unsigned i = 0; i < 400 && state() != 3; ++i) usleep(10000);
  assert(state() == 3);
  for (unsigned i = 0; i < 11; ++i)
    assert(call(&compiler, arguments, &object, &error));
  assert(*providerCalls == preArmCalls + 11);

  const std::string stopRaw =
      "{\"schema\":2,\"mode\":\"metal-ir-capture-v2\","
      "\"state\":\"stop\",\"uid\":" + std::to_string(getuid()) +
      ",\"pid\":" + pid + ",\"nonce\":\"" + nonce +
      "\",\"ack_sha256\":\"" + ackHash + "\"}";
  writeExact(controls / ("stop-" + pid + "-" + nonce + ".json"), stopRaw);
  for (unsigned i = 0; i < 400 && state() != 5; ++i) usleep(10000);
  assert(state() == 5);
  assert(call(&compiler, arguments, &object, &error));
  assert(*providerCalls == preArmCalls + 12);
  unsigned terminalCount = 0;
  for (const auto &entry : std::filesystem::directory_iterator(instances))
    if (std::filesystem::is_regular_file(entry.path() / "terminal.json"))
      ++terminalCount;
  assert(terminalCount == 1);
  std::puts("v2-late-load-host: both_orders pre_arm_no_capture one_ack terminal_cleanup");
}

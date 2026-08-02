#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <filesystem>
#include <string>
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
static_assert(offsetof(FixtureObject, bytes) == 0x10);
static_assert(offsetof(FixtureObject, size) == 0x18);

using Consumer = FixtureObject *(*)(IRCompiler *,
                                     const std::vector<std::string> &,
                                     const FixtureObject *, IRError **);
using State = int (*)();

int main() {
  const char *consumerPath = std::getenv("YAAGL_METAL_IR_D3DMETAL");
  const char *providerPath = std::getenv("YAAGL_METAL_IR_PROVIDER");
  const char *sessionRoot = std::getenv("YAAGL_METAL_IR_SESSION_ROOT");
  if (!consumerPath || !providerPath || !sessionRoot)
    return 1;
  void *consumerHandle = dlopen(consumerPath, RTLD_NOW | RTLD_NOLOAD);
  void *providerHandle = dlopen(providerPath, RTLD_NOW | RTLD_NOLOAD);
  auto call = consumerHandle
                  ? reinterpret_cast<Consumer>(
                        dlsym(consumerHandle, "GotIrConsumerCall"))
                  : nullptr;
  auto state = reinterpret_cast<State>(
      dlsym(RTLD_DEFAULT, "YaaglMetalIrV2FixtureState"));
  auto providerCalls = providerHandle
                           ? reinterpret_cast<int *>(
                                 dlsym(providerHandle, "GotIrProviderCalls"))
                           : nullptr;
  auto compilerSeen = providerHandle
                          ? reinterpret_cast<IRCompiler **>(
                                dlsym(providerHandle, "GotIrCompilerSeen"))
                          : nullptr;
  auto objectSeen = providerHandle
                        ? reinterpret_cast<const FixtureObject **>(
                              dlsym(providerHandle, "GotIrObjectSeen"))
                        : nullptr;
  auto argumentsSeen = providerHandle
                           ? reinterpret_cast<const std::vector<std::string> **>(
                                 dlsym(providerHandle, "GotIrArgumentsSeen"))
                           : nullptr;
  auto sinkSeen = providerHandle
                      ? reinterpret_cast<IRError ***>(
                            dlsym(providerHandle, "GotIrSinkSeen"))
                      : nullptr;
  if (!call || !state || !providerCalls || !compilerSeen ||
      !objectSeen || !argumentsSeen || !sinkSeen)
    return 2;
  for (unsigned attempt = 0; attempt < 200 && state() != 3; ++attempt)
    usleep(50000);
  if (state() != 3)
    return 3;
  uint8_t dxil[32]{};
  std::memcpy(dxil, "DXBC", 4);
  FixtureObject object;
  object.bytes = dxil;
  object.size = sizeof(dxil);
  IRCompiler compiler;
  IRError *error = nullptr;
  std::vector<std::string> arguments{"constructor-fixture"};
  for (unsigned index = 0; index < 11; ++index)
    if (!call(&compiler, arguments, &object, &error))
      return 4;
  if (*providerCalls != 11 || *compilerSeen != &compiler ||
      *objectSeen != &object || *argumentsSeen != &arguments ||
      *sinkSeen != &error)
    return 5;
  std::printf("calls-complete\n");
  std::fflush(stdout);
  for (unsigned attempt = 0; attempt < 200 && state() != 5; ++attempt)
    usleep(50000);
  if (state() != 5)
    return 6;
  if (!call(&compiler, arguments, &object, &error) || *providerCalls != 12)
    return 7;
  const std::filesystem::path instances =
      std::filesystem::path(sessionRoot) / "instances";
  for (const auto &entry : std::filesystem::directory_iterator(instances)) {
    const auto terminal = entry.path() / "terminal.json";
    if (std::filesystem::is_regular_file(terminal)) {
      std::printf("%s\n", terminal.c_str());
      return 0;
    }
  }
  return 8;
}

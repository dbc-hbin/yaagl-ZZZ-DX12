#include <cstdlib>
#include <dlfcn.h>
#include <string>
#include <vector>
struct IRCompiler {};
struct IRObject {};
struct IRError {};
using Consumer = IRObject *(*)(IRCompiler *, const std::vector<std::string> &,
                               const IRObject *, IRError **);
using Wait = int (*)();
using Rollback = bool (*)();
int main() {
  const char *consumerPath = std::getenv("YAAGL_GOT_PROOF_CONSUMER");
  const char *providerPath = std::getenv("YAAGL_GOT_PROOF_PROVIDER");
  if (std::getenv("YAAGL_GOT_PROOF_PRELOAD_PROVIDER"))
    if (!dlopen(providerPath, RTLD_NOW | RTLD_LOCAL)) return 1;
  void *consumer = dlopen(consumerPath, RTLD_NOW | RTLD_LOCAL);
  if (!consumer) return 2;
  auto wait = reinterpret_cast<Wait>(dlsym(RTLD_DEFAULT, "GotProofWaitForState"));
  auto rollback = reinterpret_cast<Rollback>(dlsym(RTLD_DEFAULT, "GotProofRollback"));
  auto wrapperCalls = reinterpret_cast<Wait>(dlsym(RTLD_DEFAULT, "GotProofWrapperCalls"));
  auto call = reinterpret_cast<Consumer>(dlsym(consumer, "GotIrConsumerCall"));
  auto other = reinterpret_cast<int (*)(int)>(
      dlsym(consumer, "GotIrConsumerOtherCall"));
  if (!wait || !rollback || !wrapperCalls || !call || !other) return 3;
  const int state = wait();
  IRCompiler compiler;
  IRObject object;
  IRError *error = nullptr;
  std::vector<std::string> arguments{"exact-abi"};
  IRObject *result = call(&compiler, arguments, &object, &error);
  void *provider = dlopen(providerPath, RTLD_NOW | RTLD_NOLOAD);
  auto *providerCalls = reinterpret_cast<int *>(dlsym(provider, "GotIrProviderCalls"));
  auto *sinkSeen = reinterpret_cast<IRError ***>(dlsym(provider, "GotIrSinkSeen"));
  auto *compilerSeen = reinterpret_cast<IRCompiler **>(dlsym(provider, "GotIrCompilerSeen"));
  auto *objectSeen = reinterpret_cast<const IRObject **>(dlsym(provider, "GotIrObjectSeen"));
  auto *expectedResult = reinterpret_cast<IRObject **>(dlsym(provider, "GotIrResultAddress"));
  const bool failureRun = std::getenv("YAAGL_GOT_PROOF_FAIL") != nullptr;
  if (failureRun)
    return state == -1 && result == *expectedResult && *providerCalls == 1 &&
                   wrapperCalls() == 0
               ? 0
               : 4;
  if (state != 1 || result != *expectedResult || *providerCalls != 1 ||
      wrapperCalls() != 1 || *sinkSeen != &error || *compilerSeen != &compiler ||
      *objectSeen != &object || other(2) != 12)
    return 5;
  if (!rollback()) return 6;
  if (call(&compiler, arguments, &object, &error) != *expectedResult ||
      *providerCalls != 2 || wrapperCalls() != 1)
    return 7;
  return 0;
}

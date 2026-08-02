#include <string>
#include <vector>
struct IRCompiler {};
struct IRObject {};
struct IRError {};
static IRObject result;
extern "C" int GotIrProviderCalls = 0;
extern "C" int GotIrOtherCalls = 0;
extern "C" IRCompiler *GotIrCompilerSeen = nullptr;
extern "C" const IRObject *GotIrObjectSeen = nullptr;
extern "C" IRError **GotIrSinkSeen = nullptr;
extern "C" const std::vector<std::string> *GotIrArgumentsSeen = nullptr;
extern "C" IRObject *GotIrResultAddress = &result;
extern "C" IRObject *IRCompilerAllocCompileAndLink(
    IRCompiler *compiler, const std::vector<std::string> &arguments,
    const IRObject *object, IRError **error) {
  ++GotIrProviderCalls;
  GotIrCompilerSeen = compiler;
  GotIrArgumentsSeen = &arguments;
  GotIrObjectSeen = object;
  GotIrSinkSeen = error;
  return &result;
}
extern "C" int GotIrOtherTarget(int value) {
  ++GotIrOtherCalls;
  return value + 10;
}

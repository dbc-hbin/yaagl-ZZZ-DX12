#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

struct IRCompiler {};
struct IRObject {};
struct IRError {};

extern "C" IRObject *IRCompilerAllocCompileAndLink(
    IRCompiler *, const std::vector<std::string> &, const IRObject *, IRError **);
extern "C" int YaaglProviderCalls;
extern "C" IRError **YaaglProviderSink;

int main() {
  IRCompiler compiler;
  IRObject object;
  IRError *error = nullptr;
  std::vector<std::string> arguments{"probe"};
  IRObject *result =
      IRCompilerAllocCompileAndLink(&compiler, arguments, &object, &error);
  if (!result || YaaglProviderCalls != 1 || YaaglProviderSink != &error) {
    std::fprintf(stderr, "forwarding mismatch result=%p calls=%d sink=%p\n",
                 result, YaaglProviderCalls, YaaglProviderSink);
    return 1;
  }
  return 0;
}

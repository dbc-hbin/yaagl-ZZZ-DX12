#include <string>
#include <vector>

struct IRCompiler {};
struct IRObject {};
struct IRError {};

static IRObject result;
extern "C" int YaaglProviderCalls = 0;
extern "C" IRError **YaaglProviderSink = nullptr;

extern "C" IRObject *IRCompilerAllocCompileAndLink(
    IRCompiler *, const std::vector<std::string> &, const IRObject *,
    IRError **error) {
  ++YaaglProviderCalls;
  YaaglProviderSink = error;
  return &result;
}

#include <string>
#include <vector>
struct IRCompiler;
struct IRObject;
struct IRError;
extern "C" IRObject *IRCompilerAllocCompileAndLink(
    IRCompiler *, const std::vector<std::string> &, const IRObject *, IRError **);
extern "C" int GotIrOtherTarget(int);
extern "C" IRObject *GotIrConsumerCall(
    IRCompiler *compiler, const std::vector<std::string> &arguments,
    const IRObject *object, IRError **error) {
  return IRCompilerAllocCompileAndLink(compiler, arguments, object, error);
}
extern "C" int GotIrConsumerOtherCall(int value) {
  return GotIrOtherTarget(value);
}

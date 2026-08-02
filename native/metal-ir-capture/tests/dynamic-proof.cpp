#include <cstdio>
#include <dlfcn.h>
#include <mach-o/dyld.h>

struct dyld_interpose_tuple {
  const void *replacement;
  const void *replacee;
};
extern "C" void dyld_dynamic_interpose(
    const mach_header *, const dyld_interpose_tuple[], size_t);
extern "C" int DynamicProviderCalls;
extern "C" int DynamicProbeTarget(int);
extern "C" int DynamicConsumerCall(int);

extern "C" int DynamicReplacement(int value) {
  return DynamicProbeTarget(value) + 100;
}

int main() {
  if (DynamicConsumerCall(1) != 2 || DynamicProviderCalls != 1) return 10;
  Dl_info info{};
  if (!dladdr(reinterpret_cast<void *>(&DynamicConsumerCall), &info)) return 11;
  const dyld_interpose_tuple tuple = {
      reinterpret_cast<const void *>(&DynamicReplacement),
      reinterpret_cast<const void *>(&DynamicProbeTarget),
  };
  dyld_dynamic_interpose(
      reinterpret_cast<const mach_header *>(info.dli_fbase), &tuple, 1);
  const int result = DynamicConsumerCall(1);
  std::printf("dynamic-interpose result=%d provider-calls=%d\n", result,
              DynamicProviderCalls);
  return result == 102 && DynamicProviderCalls == 2 ? 0 : 20;
}

#include <dlfcn.h>
#include <mach-o/dyld.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>

namespace {

std::atomic<unsigned> g_validImages{0};
std::atomic<unsigned> g_invalidImages{0};

void imageAdded(const mach_header *header, intptr_t) {
  Dl_info info{};
  if (!header ||
      dladdr(reinterpret_cast<const void *>(header), &info) == 0 ||
      !info.dli_fname || info.dli_fbase != header) {
    g_invalidImages.fetch_add(1, std::memory_order_relaxed);
    return;
  }
  g_validImages.fetch_add(1, std::memory_order_relaxed);
}

} // namespace

int main() {
  _dyld_register_func_for_add_image(imageAdded);
  if (g_invalidImages.load(std::memory_order_relaxed) != 0) {
    std::fputs("FAIL: dladdr did not resolve a registered Mach-O header\n",
               stderr);
    return 1;
  }
  if (g_validImages.load(std::memory_order_relaxed) == 0) {
    std::fputs("FAIL: dyld registration did not enumerate loaded images\n",
               stderr);
    return 1;
  }
  std::puts("PASS: dyld image callback resolves only the supplied image");
  return 0;
}

#include <cstdint>

struct IRError;
extern "C" bool YaaglMetalIrTargetPredicate(const char *, uintptr_t, IRError **);

int main() {
  IRError **sink = reinterpret_cast<IRError **>(0x1);
  if (!YaaglMetalIrTargetPredicate("/tmp/D3DMetal", 0x9a12f, nullptr)) return 1;
  if (YaaglMetalIrTargetPredicate("/tmp/not-D3DMetal", 0x9a12f, nullptr)) return 2;
  if (YaaglMetalIrTargetPredicate("/tmp/D3DMetal", 0x9a130, nullptr)) return 3;
  if (YaaglMetalIrTargetPredicate("/tmp/D3DMetal", 0x9a12f, sink)) return 4;
  return 0;
}

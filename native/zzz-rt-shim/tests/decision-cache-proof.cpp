#include "../decision-cache.hpp"

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

namespace {

using Cache = yaagl::zzz_rt::DecisionCache<8, void *>;

std::array<uint8_t, 32> makeDigest(uint8_t suffix) {
  std::array<uint8_t, 32> digest{};
  // Keep the first eight bytes identical to force the open-addressing collision
  // path while retaining a unique full digest.
  for (size_t index = 8; index < digest.size(); ++index)
    digest[index] = static_cast<uint8_t>(suffix + index);
  return digest;
}

[[noreturn]] void fail(const char *message) {
  std::fprintf(stderr, "FAIL: %s\n", message);
  std::exit(1);
}

} // namespace

int main() {
  Cache cache;
  const auto negative = makeDigest(1);
  const auto positive = makeDigest(2);
  void *const marker =
      reinterpret_cast<void *>(static_cast<uintptr_t>(0x1234));

  if (cache.lookup(negative.data()).kind != yaagl::zzz_rt::DecisionKind::kMiss)
    fail("fresh digest must miss");
  if (!cache.publishNegative(negative.data()))
    fail("negative publish failed");
  if (cache.lookup(negative.data()).kind !=
      yaagl::zzz_rt::DecisionKind::kNegative)
    fail("negative lookup failed");
  if (!cache.publishPositive(positive.data(), marker))
    fail("positive publish failed");
  const auto found = cache.lookup(positive.data());
  if (found.kind != yaagl::zzz_rt::DecisionKind::kPositive ||
      found.value != marker)
    fail("positive lookup failed");

  for (uint8_t index = 3; index <= 8; ++index) {
    const auto digest = makeDigest(index);
    if (!cache.publishNegative(digest.data()))
      fail("table filled before capacity");
  }
  const auto overflow = makeDigest(9);
  if (cache.publishNegative(overflow.data()))
    fail("overflow publish unexpectedly succeeded");
  if (cache.lookup(overflow.data()).kind !=
      yaagl::zzz_rt::DecisionKind::kMiss)
    fail("overflow must remain a normal miss");

  std::puts("PASS: decision cache collision, lookup, and saturation contract");
  return 0;
}

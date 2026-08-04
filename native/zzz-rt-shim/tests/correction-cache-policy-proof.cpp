#include "../decision-cache.hpp"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

constexpr size_t kV1Capacity = 32;

using Digest = std::array<uint8_t, 32>;

Digest makeDigest(uint64_t seed) {
  Digest digest{};
  for (size_t offset = 0; offset < digest.size(); offset += sizeof(seed)) {
    const uint64_t word = seed + offset * UINT64_C(0x9e3779b97f4a7c15);
    std::memcpy(digest.data() + offset, &word, sizeof(word));
  }
  return digest;
}

class V1Policy {
public:
  bool correct(const Digest &digest, bool matchesStructuralPredicate) {
    for (size_t index = 0; index < positiveCount_; ++index) {
      if (positive_[index] == digest)
        return true;
    }
    for (size_t index = 0; index < negativeCount_; ++index) {
      if (negative_[index] == digest)
        return false;
    }

    // This reproduces v1's capacity-dependent behavior: once the positive
    // table is full, lookup reports kPositiveFull and skips transformation.
    if (positiveCount_ == positive_.size())
      return false;

    if (matchesStructuralPredicate) {
      positive_[positiveCount_++] = digest;
      return true;
    }
    if (negativeCount_ < negative_.size())
      negative_[negativeCount_++] = digest;
    return false;
  }

private:
  std::array<Digest, kV1Capacity> positive_{};
  std::array<Digest, kV1Capacity> negative_{};
  size_t positiveCount_ = 0;
  size_t negativeCount_ = 0;
};

template <size_t Capacity> class V2Policy {
public:
  bool correct(const Digest &digest, bool matchesStructuralPredicate) {
    const auto cached = cache_.lookup(digest.data());
    if (cached.kind == yaagl::zzz_rt::DecisionKind::kPositive)
      return true;
    if (cached.kind == yaagl::zzz_rt::DecisionKind::kNegative)
      return false;

    // V2 always returns the just-computed decision. Publication is optional:
    // capacity can change only future work, never this compile's correction.
    if (matchesStructuralPredicate) {
      cache_.publishPositive(digest.data(), reinterpret_cast<void *>(1));
      return true;
    }
    cache_.publishNegative(digest.data());
    return false;
  }

private:
  using Cache = yaagl::zzz_rt::DecisionCache<Capacity, void *>;
  Cache cache_;
};

void proveParityBelowV1Saturation() {
  V1Policy v1;
  V2Policy<128> v2;
  size_t v1Corrections = 0;
  size_t v2Corrections = 0;

  for (size_t index = 0; index < kV1Capacity - 1; ++index) {
    const auto positive = makeDigest(index + 1);
    const auto negative = makeDigest(index + 1000);
    v1Corrections += v1.correct(positive, true);
    v2Corrections += v2.correct(positive, true);
    v1Corrections += v1.correct(negative, false);
    v2Corrections += v2.correct(negative, false);
    // Repeated inputs must preserve the same correction count while using the
    // respective memoization policy.
    v1Corrections += v1.correct(positive, true);
    v2Corrections += v2.correct(positive, true);
    v1Corrections += v1.correct(negative, false);
    v2Corrections += v2.correct(negative, false);
  }

  assert(v1Corrections == v2Corrections);
  assert(v1Corrections == (kV1Capacity - 1) * 2);
}

void proveV2SaturationCannotDropCorrection() {
  V2Policy<8> v2;
  for (size_t index = 0; index < 8; ++index)
    assert(!v2.correct(makeDigest(index + 2000), false));

  // The table is full. A new matching source must still be corrected even
  // though its positive result cannot be memoized.
  const auto matching = makeDigest(3000);
  assert(v2.correct(matching, true));
  assert(v2.correct(matching, true));
}

void demonstrateV1BoundaryDifference() {
  V1Policy v1;
  for (size_t index = 0; index < kV1Capacity; ++index)
    assert(v1.correct(makeDigest(index + 4000), true));

  // This is the intentionally demonstrated v1 defect that v2 removes.
  assert(!v1.correct(makeDigest(5000), true));
}

} // namespace

int main() {
  proveParityBelowV1Saturation();
  proveV2SaturationCannotDropCorrection();
  demonstrateV1BoundaryDifference();
  std::puts("PASS: v1/v2 policy parity below v1 saturation and v2 saturation safety");
  return 0;
}

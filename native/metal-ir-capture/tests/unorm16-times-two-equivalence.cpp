#include <cmath>
#include <cstdint>
#include <cstring>

namespace {
uint32_t bits(float value) {
  uint32_t result = 0;
  std::memcpy(&result, &value, sizeof(result));
  return result;
}

double exactReferenceConstant() {
  const uint64_t encoded = 0x3f00001000100010ULL;
  double result = 0;
  std::memcpy(&result, &encoded, sizeof(result));
  return result;
}
}  // namespace

int main() {
  const double referenceConstant = exactReferenceConstant();
  const float denominator = 32767.5f;
  const float roundedReciprocal = static_cast<float>(referenceConstant);
  uint32_t previous = 0;
  uint32_t multiplyMismatchCount = 0;
  for (uint32_t input = 0; input <= 0xffffU; ++input) {
    const float reference =
        static_cast<float>(static_cast<double>(input) * referenceConstant);
    const float candidate = static_cast<float>(input) / denominator;
    const float multiplyCandidate =
        static_cast<float>(input) * roundedReciprocal;
    if (bits(reference) != bits(candidate) || !std::isfinite(candidate) ||
        candidate < 0.0f || candidate > 2.0f || bits(candidate) < previous)
      return 1;
    if (bits(reference) != bits(multiplyCandidate))
      ++multiplyMismatchCount;
    previous = bits(candidate);
  }
  if (bits(0.0f / denominator) != 0x00000000U ||
      bits(65535.0f / denominator) != 0x40000000U)
    return 2;
  if (multiplyMismatchCount == 0)
    return 3;
  return 0;
}

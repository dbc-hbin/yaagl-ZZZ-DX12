#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

namespace {
uint32_t bits(float value) {
  uint32_t result = 0;
  std::memcpy(&result, &value, sizeof(result));
  return result;
}

double exactReferenceConstant() {
  const uint64_t encoded = 0x3e70000010000010ULL;
  double result = 0;
  std::memcpy(&result, &encoded, sizeof(result));
  return result;
}
}  // namespace

int main() {
  const double referenceConstant = exactReferenceConstant();
  const float denominator = 16777215.0f;
  uint32_t previous = 0;
  for (uint32_t input = 0;; ++input) {
    const float reference =
        static_cast<float>(static_cast<double>(input) * referenceConstant);
    const float candidate = static_cast<float>(input) / denominator;
    if (bits(reference) != bits(candidate) || !std::isfinite(candidate) ||
        candidate < 0.0f || candidate > 1.0f || bits(candidate) < previous)
      return 1;
    previous = bits(candidate);
    if (input == 0x00ffffffU) break;
  }
  if (bits(0.0f / denominator) != 0x00000000U ||
      bits(16777215.0f / denominator) != 0x3f800000U)
    return 2;
  return 0;
}

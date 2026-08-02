#include <cstdint>
#include <cstring>

namespace {

uint32_t bits(float value) {
  uint32_t result = 0;
  std::memcpy(&result, &value, sizeof(result));
  return result;
}

float fromBits(uint32_t value) {
  float result = 0.0f;
  std::memcpy(&result, &value, sizeof(result));
  return result;
}

bool verifyMilliResult5Range() {
  // InjectCache accumulates at most an 8x8 workgroup of values rounded from
  // [0, 2000] (the direct [0,2] clamp multiplied by 1000), hence each
  // Result5 lane is in [0, 128000].  This is the full proven source range.
  for (uint32_t input = 0; input <= 128000; ++input) {
    const float reference =
        static_cast<float>(static_cast<double>(input) * 1.000000e-03);
    const float candidate = static_cast<float>(input) / 1000.0f;
    if (bits(reference) != bits(candidate)) return false;
  }
  return true;
}

bool verifyBorrowEncodeForEveryClampedFloat() {
  // Every finite f32 in [0, 2] is a valid direct FMax/FMin result.  This is
  // the complete input domain of the replacement, not a sampled test.
  for (uint32_t encoded = 0;; ++encoded) {
    const float value = fromBits(encoded);
    const int32_t reference =
        static_cast<int32_t>(static_cast<double>(value) * 32767.5);
    const float scaled = value * 32768.0f;
    const uint32_t whole = static_cast<uint32_t>(scaled);
    const float wholeFloat = static_cast<float>(whole);
    const float fraction = scaled - wholeFloat;
    // Mirrors the emitted DXIL 0x3EF0000000000000: 2^-16.  Since scaled is
    // x * 32768, this is exactly x / 2, not scaled / 2.
    const float half = scaled * 0x1p-16f;
    const uint32_t candidate = whole - (fraction < half ? 1U : 0U);
    if (reference < 0 || static_cast<uint32_t>(reference) != candidate)
      return false;
    if (encoded == 0x40000000U) break;
  }
  return true;
}

bool rejectsNaiveFloatMultiply() {
  // The direct f32 multiply loses the original f64 truncation behavior at
  // this first known boundary; it must not replace the borrow formulation.
  constexpr float kCounterexample = 0x1.0001p-15f;
  const int32_t reference = static_cast<int32_t>(
      static_cast<double>(kCounterexample) * 32767.5);
  const int32_t naive =
      static_cast<int32_t>(kCounterexample * 32767.5f);
  return reference == 0 && naive == 1;
}

}  // namespace

int main() {
  if (!verifyMilliResult5Range()) return 1;
  if (!verifyBorrowEncodeForEveryClampedFloat()) return 2;
  if (!rejectsNaiveFloatMultiply()) return 3;
  return 0;
}

#include "../pinned-sha256.hpp"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string_view>

namespace {

uint8_t nibble(char value) {
  if (value >= '0' && value <= '9')
    return static_cast<uint8_t>(value - '0');
  if (value >= 'a' && value <= 'f')
    return static_cast<uint8_t>(value - 'a' + 10);
  assert(false && "invalid hexadecimal digit");
  return 0;
}

std::array<uint8_t, 32> parse(std::string_view value) {
  assert(value.size() == 64);
  std::array<uint8_t, 32> result{};
  for (size_t index = 0; index < result.size(); ++index)
    result[index] = static_cast<uint8_t>((nibble(value[index * 2]) << 4) |
                                         nibble(value[index * 2 + 1]));
  return result;
}

void prove(std::string_view text,
           const yaagl::zzz_rt::Sha256Digest &expected) {
  const auto parsed = parse(text);
  assert(parsed == expected);
  assert(yaagl::zzz_rt::sha256Matches(parsed.data(), expected));
  auto mismatch = parsed;
  mismatch.back() ^= 1;
  assert(!yaagl::zzz_rt::sha256Matches(mismatch.data(), expected));
}

} // namespace

int main() {
  prove("02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869",
        yaagl::zzz_rt::kExactSourceSha256);
  prove("c64e67eabc3cf5ff89359c3075ebe00387c5a46d5136ea61dfbdd832b2f01717",
        yaagl::zzz_rt::kExactReplacementSha256);
  prove("843be9c95dd09b3e4da739d67b91257495fb746da91b57eb52f859e682dd55ff",
        yaagl::zzz_rt::kInjectCacheSourceSha256);
  prove("57dc9421af62c35b372adf7536f07b1e2c20ef32dc1f4c16930a42fc12ed1fd2",
        yaagl::zzz_rt::kDxcompilerSha256);
  assert(!yaagl::zzz_rt::sha256Matches(nullptr,
                                        yaagl::zzz_rt::kExactSourceSha256));
  std::puts("PASS: pinned SHA-256 byte identities and full-digest matching");
  return 0;
}

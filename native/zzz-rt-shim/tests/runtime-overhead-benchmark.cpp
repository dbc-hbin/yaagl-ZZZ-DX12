#include "../decision-cache.hpp"
#include "../pinned-sha256.hpp"

#include <CommonCrypto/CommonDigest.h>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <dlfcn.h>
#include <mach/mach.h>
#include <string_view>
#include <vector>

namespace {

volatile uint64_t g_sink = 0;

uint64_t splitmix64(uint64_t value) {
  value += UINT64_C(0x9e3779b97f4a7c15);
  value = (value ^ (value >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
  value = (value ^ (value >> 27)) * UINT64_C(0x94d049bb133111eb);
  return value ^ (value >> 31);
}

std::array<uint8_t, 32> makeDigest(uint64_t seed) {
  std::array<uint8_t, 32> digest{};
  for (size_t offset = 0; offset < digest.size(); offset += sizeof(uint64_t)) {
    const uint64_t word = splitmix64(seed + offset);
    std::memcpy(digest.data() + offset, &word, sizeof(word));
  }
  return digest;
}

template <typename Function>
double measure(size_t iterations, Function &&function) {
  double best = 1e100;
  for (int round = 0; round < 5; ++round) {
    function(128);
    const auto start = std::chrono::steady_clock::now();
    function(iterations);
    const auto end = std::chrono::steady_clock::now();
    const double elapsed =
        std::chrono::duration<double, std::nano>(end - start).count();
    const double perOperation = elapsed / static_cast<double>(iterations);
    if (perOperation < best)
      best = perOperation;
  }
  return best;
}

__attribute__((noinline)) bool legacyHexMatches(const uint8_t actual[32],
                                                 const char *expected) {
  static constexpr char table[] = "0123456789abcdef";
  char encoded[65];
  for (size_t index = 0; index < 32; ++index) {
    encoded[index * 2] = table[actual[index] >> 4];
    encoded[index * 2 + 1] = table[actual[index] & 0x0f];
  }
  encoded[64] = 0;
  return std::strcmp(encoded, expected) == 0;
}

__attribute__((noinline)) bool binaryMatches(
    const uint8_t actual[32], const yaagl::zzz_rt::Sha256Digest &expected) {
  return yaagl::zzz_rt::sha256Matches(actual, expected);
}

__attribute__((noinline)) uint8_t classifyCaller(uintptr_t caller,
                                                  uintptr_t base) {
  const uintptr_t offset = caller >= base ? caller - base : 0;
  if (offset == 0x9a12f)
    return 1;
  if (offset == 0x87ec9)
    return 2;
  return 0;
}

void benchmarkDigestComparison() {
  std::array<std::array<uint8_t, 32>, 2> values{
      yaagl::zzz_rt::kExactSourceSha256,
      yaagl::zzz_rt::kExactSourceSha256,
  };
  values[1].back() ^= 1;
  constexpr char expected[] =
      "02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869";
  constexpr size_t iterations = 5'000'000;
  const double binary = measure(iterations, [&](size_t count) {
    uint64_t matches = 0;
    for (size_t index = 0; index < count; ++index)
      matches += binaryMatches(values[index & 1].data(),
                               yaagl::zzz_rt::kExactSourceSha256);
    g_sink += matches;
  });
  const double legacy = measure(iterations, [&](size_t count) {
    uint64_t matches = 0;
    for (size_t index = 0; index < count; ++index)
      matches += legacyHexMatches(values[index & 1].data(), expected);
    g_sink += matches;
  });
  std::printf("digest_compare_binary_ns=%.3f\n", binary);
  std::printf("digest_compare_hex_ns=%.3f\n", legacy);
}

void benchmarkCallerClassification() {
  constexpr uintptr_t base = UINT64_C(0x100000000);
  constexpr size_t iterations = 20'000'000;
  const double nonTarget = measure(iterations, [&](size_t count) {
    uint64_t total = 0;
    for (size_t index = 0; index < count; ++index)
      total += classifyCaller(base + 0x12345 + (index & 1), base);
    g_sink += total;
  });
  const double targetMix = measure(iterations, [&](size_t count) {
    uint64_t total = 0;
    for (size_t index = 0; index < count; ++index)
      total += classifyCaller(base + ((index & 1) ? 0x9a12f : 0x87ec9), base);
    g_sink += total;
  });
  std::printf("caller_classify_non_target_ns=%.3f\n", nonTarget);
  std::printf("caller_classify_target_mix_ns=%.3f\n", targetMix);
}

void benchmarkSha256() {
  for (const size_t size : {size_t{20616}, size_t{26964}, size_t{33228}}) {
    std::vector<uint8_t> source(size);
    for (size_t index = 0; index < source.size(); ++index)
      source[index] = static_cast<uint8_t>(splitmix64(index) >> 56);
    const size_t iterations = 20'000;
    const double elapsed = measure(iterations, [&](size_t count) {
      std::array<uint8_t, CC_SHA256_DIGEST_LENGTH> digest{};
      uint64_t total = 0;
      for (size_t index = 0; index < count; ++index) {
        CC_SHA256(source.data(), static_cast<CC_LONG>(source.size()),
                  digest.data());
        total += digest[index & 31];
      }
      g_sink += total;
    });
    std::printf("sha256_%zu_bytes_ns=%.3f\n", size, elapsed);
  }
}

void benchmarkVmRead() {
  for (const size_t size : {size_t{32}, size_t{20616}, size_t{26964}}) {
    std::vector<uint8_t> source(size, 0x5a);
    std::vector<uint8_t> destination(size);
    const size_t iterations = size == 32 ? 500'000 : 20'000;
    const double vmRead = measure(iterations, [&](size_t count) {
      uint64_t total = 0;
      for (size_t index = 0; index < count; ++index) {
        vm_size_t copied = 0;
        const kern_return_t result = vm_read_overwrite(
            mach_task_self(), reinterpret_cast<vm_address_t>(source.data()), size,
            reinterpret_cast<vm_address_t>(destination.data()), &copied);
        total += static_cast<uint64_t>(result == KERN_SUCCESS ? copied : 0);
      }
      g_sink += total;
    });
    const double memoryCopy = measure(iterations, [&](size_t count) {
      uint64_t total = 0;
      for (size_t index = 0; index < count; ++index) {
        std::memcpy(destination.data(), source.data(), size);
        total += destination[index % size];
      }
      g_sink += total;
    });
    std::printf("vm_read_%zu_bytes_ns=%.3f\n", size, vmRead);
    std::printf("memcpy_%zu_bytes_ns=%.3f\n", size, memoryCopy);
  }
}

template <size_t Capacity>
void benchmarkDecisionCacheCapacity(size_t occupancy) {
  using Cache = yaagl::zzz_rt::DecisionCache<Capacity, void *>;
  Cache cache;
  std::vector<std::array<uint8_t, 32>> digests;
  digests.reserve(occupancy);
  for (size_t index = 0; index < occupancy; ++index) {
    digests.push_back(makeDigest(index + 1));
    if (index & 1) {
      cache.publishPositive(
          digests.back().data(),
          reinterpret_cast<void *>(static_cast<uintptr_t>(index + 1)));
    } else {
      cache.publishNegative(digests.back().data());
    }
  }
  const auto missing = makeDigest(10'000);
  constexpr size_t iterations = 5'000'000;
  const double hit = measure(iterations, [&](size_t count) {
    uint64_t total = 0;
    for (size_t index = 0; index < count; ++index) {
      const auto result = cache.lookup(digests[index % digests.size()].data());
      total += static_cast<uint8_t>(result.kind);
    }
    g_sink += total;
  });
  const double miss = measure(iterations, [&](size_t count) {
    uint64_t total = 0;
    for (size_t index = 0; index < count; ++index)
      total += static_cast<uint8_t>(cache.lookup(missing.data()).kind);
    g_sink += total;
  });

  Cache full;
  for (size_t index = 0; index < Capacity; ++index) {
    const auto digest = makeDigest(index + 20'000);
    full.publishNegative(digest.data());
  }
  const auto saturatedMiss = makeDigest(50'000);
  const double fullMiss = measure(20'000, [&](size_t count) {
    uint64_t total = 0;
    for (size_t index = 0; index < count; ++index)
      total += static_cast<uint8_t>(full.lookup(saturatedMiss.data()).kind);
    g_sink += total;
  });

  std::printf("decision_cache_%zu_bytes=%zu\n", Capacity, sizeof(Cache));
  std::printf("decision_cache_%zu_%zu_average_hit_ns=%.3f\n", Capacity,
              occupancy, hit);
  std::printf("decision_cache_%zu_%zu_miss_ns=%.3f\n", Capacity, occupancy,
              miss);
  std::printf("decision_cache_%zu_full_miss_ns=%.3f\n", Capacity, fullMiss);
}

void benchmarkDecisionCache() {
  constexpr size_t observedUniqueDigests = 424;
  benchmarkDecisionCacheCapacity<512>(observedUniqueDigests);
  benchmarkDecisionCacheCapacity<1024>(observedUniqueDigests);
  benchmarkDecisionCacheCapacity<2048>(observedUniqueDigests);
}

void benchmarkDladdr() {
  constexpr size_t iterations = 500'000;
  const double elapsed = measure(iterations, [&](size_t count) {
    uint64_t total = 0;
    for (size_t index = 0; index < count; ++index) {
      Dl_info info{};
      total += static_cast<uint64_t>(
          dladdr(reinterpret_cast<const void *>(&benchmarkDladdr), &info) != 0 &&
          info.dli_fname != nullptr);
    }
    g_sink += total;
  });
  std::printf("dladdr_supplied_image_ns=%.3f\n", elapsed);
}

} // namespace

int main() {
  benchmarkDigestComparison();
  benchmarkCallerClassification();
  benchmarkSha256();
  benchmarkVmRead();
  benchmarkDecisionCache();
  benchmarkDladdr();
  std::printf("benchmark_sink=%llu\n",
              static_cast<unsigned long long>(g_sink));
  return 0;
}

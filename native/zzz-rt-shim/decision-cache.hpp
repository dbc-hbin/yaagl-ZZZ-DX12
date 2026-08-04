#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace yaagl::zzz_rt {

enum class DecisionKind : uint8_t {
  kMiss = 0,
  kNegative = 1,
  kPositive = 2,
};

template <typename Value> struct DecisionLookup {
  DecisionKind kind = DecisionKind::kMiss;
  Value value{};
};

// Fixed, append-only decision table for shader source digests. Readers never
// block and entries are never removed. Publication uses a transient reserved
// state so a reader can safely ignore an entry that is still being written.
// Capacity exhaustion is deliberately represented as a normal miss: callers
// must still perform the transformation for the current compile and may only
// lose the ability to memoize that result.
template <size_t Capacity, typename Value> class DecisionCache {
  static_assert(Capacity > 0 && (Capacity & (Capacity - 1)) == 0,
                "DecisionCache capacity must be a power of two");

public:
  DecisionLookup<Value> lookup(const uint8_t digest[32]) const {
    if (!digest)
      return {};
    const size_t start = startIndex(digest);
    for (size_t probe = 0; probe < Capacity; ++probe) {
      const Entry &entry = entries_[(start + probe) & (Capacity - 1)];
      const State state =
          static_cast<State>(entry.state.load(std::memory_order_acquire));
      if (state == State::kEmpty)
        return {};
      if (state == State::kReserved)
        continue;
      if (std::memcmp(entry.digest, digest, 32) != 0)
        continue;
      if (state == State::kPositive)
        return {DecisionKind::kPositive, entry.value};
      if (state == State::kNegative)
        return {DecisionKind::kNegative, Value{}};
    }
    return {};
  }

  bool publishNegative(const uint8_t digest[32]) {
    return publish(digest, State::kNegative, Value{});
  }

  bool publishPositive(const uint8_t digest[32], Value value) {
    return publish(digest, State::kPositive, value);
  }

private:
  enum class State : uint8_t {
    kEmpty = 0,
    kReserved = 1,
    kNegative = 2,
    kPositive = 3,
  };

  struct Entry {
    std::atomic<uint8_t> state{static_cast<uint8_t>(State::kEmpty)};
    uint8_t digest[32]{};
    Value value{};
  };

  static size_t startIndex(const uint8_t digest[32]) {
    uint64_t value = 0;
    std::memcpy(&value, digest, sizeof(value));
    value ^= value >> 33;
    value *= UINT64_C(0xff51afd7ed558ccd);
    value ^= value >> 33;
    value *= UINT64_C(0xc4ceb9fe1a85ec53);
    value ^= value >> 33;
    return static_cast<size_t>(value) & (Capacity - 1);
  }

  bool publish(const uint8_t digest[32], State desired, Value value) {
    if (!digest)
      return false;
    const size_t start = startIndex(digest);
    for (size_t probe = 0; probe < Capacity; ++probe) {
      Entry &entry = entries_[(start + probe) & (Capacity - 1)];
      State state =
          static_cast<State>(entry.state.load(std::memory_order_acquire));
      if ((state == State::kPositive || state == State::kNegative) &&
          std::memcmp(entry.digest, digest, 32) == 0)
        return true;
      if (state != State::kEmpty)
        continue;
      uint8_t expected = static_cast<uint8_t>(State::kEmpty);
      if (!entry.state.compare_exchange_strong(
              expected, static_cast<uint8_t>(State::kReserved),
              std::memory_order_acq_rel, std::memory_order_acquire))
        continue;
      std::memcpy(entry.digest, digest, 32);
      entry.value = value;
      entry.state.store(static_cast<uint8_t>(desired),
                        std::memory_order_release);
      return true;
    }
    return false;
  }

  std::array<Entry, Capacity> entries_{};
};

} // namespace yaagl::zzz_rt

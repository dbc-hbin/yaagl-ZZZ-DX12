#include "../translation-synchronization.hpp"

#include <atomic>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <thread>

namespace {

enum class LookupStatus { kMiss, kHit, kNegative };

struct LookupResult {
  LookupStatus status = LookupStatus::kMiss;
  int value = 0;
};

void concurrentInitializationIsSingleFlight() {
  yaagl::metal_ir::RuntimeInitializationGate gate;
  std::atomic<int> calls{0};
  std::atomic<bool> firstResult{false};
  std::atomic<bool> secondResult{false};
  std::atomic<bool> secondStarted{false};
  std::atomic<bool> secondFinished{false};
  std::mutex mutex;
  std::condition_variable condition;
  bool entered = false;
  bool release = false;

  std::thread first([&] {
    firstResult.store(
        gate.ensure([&] {
          calls.fetch_add(1);
          std::unique_lock<std::mutex> lock(mutex);
          entered = true;
          condition.notify_all();
          condition.wait(lock, [&] { return release; });
          return true;
        }),
        std::memory_order_release);
  });

  {
    std::unique_lock<std::mutex> lock(mutex);
    condition.wait(lock, [&] { return entered; });
  }

  std::thread second([&] {
    secondStarted.store(true, std::memory_order_release);
    secondResult.store(
        gate.ensure([&] {
          calls.fetch_add(1);
          return true;
        }),
        std::memory_order_release);
    secondFinished.store(true, std::memory_order_release);
  });

  while (!secondStarted.load(std::memory_order_acquire))
    std::this_thread::yield();
  std::this_thread::sleep_for(std::chrono::milliseconds(10));
  assert(!secondFinished.load(std::memory_order_acquire));

  {
    std::lock_guard<std::mutex> lock(mutex);
    release = true;
  }
  condition.notify_all();
  first.join();
  second.join();

  assert(firstResult.load(std::memory_order_acquire));
  assert(secondResult.load(std::memory_order_acquire));
  assert(calls.load() == 1);
  assert(gate.ready());
}

void failedInitializationIsNotRetried() {
  yaagl::metal_ir::RuntimeInitializationGate gate;
  int calls = 0;
  assert(!gate.ensure([&] {
    ++calls;
    return false;
  }));
  assert(!gate.ensure([&] {
    ++calls;
    return true;
  }));
  assert(calls == 1);
  assert(!gate.ready());
}

void throwingInitializationFailsClosed() {
  yaagl::metal_ir::RuntimeInitializationGate gate;
  int calls = 0;
  assert(!gate.ensure([&]() -> bool {
    ++calls;
    throw 7;
  }));
  assert(!gate.ensure([&] {
    ++calls;
    return true;
  }));
  assert(calls == 1);
  assert(!gate.ready());
}

void duplicateMissTransformsOnce() {
  std::mutex transformMutex;
  std::atomic<int> cacheValue{0};
  std::atomic<int> transforms{0};
  std::mutex mutex;
  std::condition_variable condition;
  bool transformEntered = false;
  bool release = false;
  LookupResult firstResult;
  LookupResult secondResult;

  auto lookup = [&] {
    const int value = cacheValue.load(std::memory_order_acquire);
    return value == 0 ? LookupResult{} : LookupResult{LookupStatus::kHit, value};
  };
  auto isMiss = [](const LookupResult &result) {
    return result.status == LookupStatus::kMiss;
  };
  auto transform = [&] {
    transforms.fetch_add(1);
    std::unique_lock<std::mutex> lock(mutex);
    transformEntered = true;
    condition.notify_all();
    condition.wait(lock, [&] { return release; });
    cacheValue.store(7, std::memory_order_release);
    return LookupResult{LookupStatus::kHit, 7};
  };

  std::thread first([&] {
    firstResult = yaagl::metal_ir::lookupOrTransform(
        transformMutex, lookup, isMiss, transform);
  });
  {
    std::unique_lock<std::mutex> lock(mutex);
    condition.wait(lock, [&] { return transformEntered; });
  }
  std::thread second([&] {
    secondResult = yaagl::metal_ir::lookupOrTransform(
        transformMutex, lookup, isMiss, transform);
  });

  {
    std::lock_guard<std::mutex> lock(mutex);
    release = true;
  }
  condition.notify_all();
  first.join();
  second.join();

  assert(firstResult.status == LookupStatus::kHit && firstResult.value == 7);
  assert(secondResult.status == LookupStatus::kHit && secondResult.value == 7);
  assert(transforms.load() == 1);
}

void cacheHitDoesNotWaitForUnrelatedTransform() {
  std::mutex transformMutex;
  std::mutex mutex;
  std::condition_variable condition;
  bool transformEntered = false;
  bool release = false;
  std::atomic<bool> hitFinished{false};

  std::thread miss([&] {
    const auto result = yaagl::metal_ir::lookupOrTransform(
        transformMutex, [] { return LookupResult{}; },
        [](const LookupResult &value) {
          return value.status == LookupStatus::kMiss;
        },
        [&] {
          std::unique_lock<std::mutex> lock(mutex);
          transformEntered = true;
          condition.notify_all();
          condition.wait(lock, [&] { return release; });
          return LookupResult{LookupStatus::kNegative, 0};
        });
    assert(result.status == LookupStatus::kNegative);
  });

  {
    std::unique_lock<std::mutex> lock(mutex);
    condition.wait(lock, [&] { return transformEntered; });
  }

  std::thread hit([&] {
    const auto result = yaagl::metal_ir::lookupOrTransform(
        transformMutex, [] { return LookupResult{LookupStatus::kHit, 11}; },
        [](const LookupResult &value) {
          return value.status == LookupStatus::kMiss;
        },
        [] {
          assert(false && "cache hit must not enter transform");
          return LookupResult{};
        });
    assert(result.status == LookupStatus::kHit && result.value == 11);
    hitFinished.store(true, std::memory_order_release);
  });

  for (int attempt = 0;
       attempt < 100 && !hitFinished.load(std::memory_order_acquire); ++attempt)
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  assert(hitFinished.load(std::memory_order_acquire));

  {
    std::lock_guard<std::mutex> lock(mutex);
    release = true;
  }
  condition.notify_all();
  hit.join();
  miss.join();
}

} // namespace

int main() {
  concurrentInitializationIsSingleFlight();
  failedInitializationIsNotRetried();
  throwingInitializationFailsClosed();
  duplicateMissTransformsOnce();
  cacheHitDoesNotWaitForUnrelatedTransform();
  std::puts("translation-synchronization-proof: initialization single-flight cache-hit nonblocking");
  return 0;
}

#pragma once

#include <atomic>
#include <mutex>
#include <utility>

namespace yaagl::metal_ir {

class RuntimeInitializationGate {
public:
  RuntimeInitializationGate() = default;
  RuntimeInitializationGate(const RuntimeInitializationGate &) = delete;
  RuntimeInitializationGate &operator=(const RuntimeInitializationGate &) = delete;

  template <typename Initialize>
  bool ensure(Initialize &&initialize) {
    if (ready_.load(std::memory_order_acquire))
      return true;

    std::lock_guard<std::mutex> lock(mutex_);
    if (ready_.load(std::memory_order_relaxed))
      return true;
    if (attempted_)
      return false;

    attempted_ = true;
    try {
      if (!std::forward<Initialize>(initialize)())
        return false;
    } catch (...) {
      return false;
    }

    ready_.store(true, std::memory_order_release);
    return true;
  }

  bool ready() const { return ready_.load(std::memory_order_acquire); }

private:
  std::atomic<bool> ready_{false};
  std::mutex mutex_;
  bool attempted_ = false;
};

template <typename Lookup, typename IsMiss, typename Transform,
          typename OnLockWaitStart, typename OnLockAcquired>
auto lookupOrTransformObserved(std::mutex &transformMutex, Lookup &&lookup,
                               IsMiss &&isMiss, Transform &&transform,
                               OnLockWaitStart &&onLockWaitStart,
                               OnLockAcquired &&onLockAcquired)
    -> decltype(lookup()) {
  auto result = lookup();
  if (!isMiss(result))
    return result;

  onLockWaitStart();
  std::lock_guard<std::mutex> lock(transformMutex);
  onLockAcquired();
  result = lookup();
  if (!isMiss(result))
    return result;

  return transform();
}

template <typename Lookup, typename IsMiss, typename Transform>
auto lookupOrTransform(std::mutex &transformMutex, Lookup &&lookup,
                       IsMiss &&isMiss, Transform &&transform)
    -> decltype(lookup()) {
  return lookupOrTransformObserved(transformMutex, lookup, isMiss, transform,
                                   [] {}, [] {});
}

} // namespace yaagl::metal_ir

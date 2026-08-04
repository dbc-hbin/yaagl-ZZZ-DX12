#include "../compile-boundary-dispatch.hpp"

#include <cassert>
#include <cstdio>
#include <stdexcept>

namespace {

struct Object {};

} // namespace

int main() {
  Object original;
  Object replacement;

  int selectCalls = 0;
  int submitCalls = 0;
  Object *selected = yaagl::zzz_rt::submitWithOptionalCorrection(
      [&]() -> Object * {
        ++selectCalls;
        return &replacement;
      },
      [&](Object *correction) -> Object * {
        ++submitCalls;
        assert(correction == &replacement);
        return correction;
      });
  assert(selected == &replacement);
  assert(selectCalls == 1);
  assert(submitCalls == 1);

  selectCalls = 0;
  submitCalls = 0;
  Object *fallback = yaagl::zzz_rt::submitWithOptionalCorrection(
      [&]() -> Object * {
        ++selectCalls;
        throw std::runtime_error("selection failed");
      },
      [&](Object *correction) -> Object * {
        ++submitCalls;
        assert(correction == nullptr);
        return &original;
      });
  assert(fallback == &original);
  assert(selectCalls == 1);
  assert(submitCalls == 1);

  submitCalls = 0;
  bool providerExceptionPropagated = false;
  try {
    (void)yaagl::zzz_rt::submitWithOptionalCorrection(
        [&]() -> Object * { return nullptr; },
        [&](Object *) -> Object * {
          ++submitCalls;
          throw std::logic_error("provider failed");
        });
  } catch (const std::logic_error &) {
    providerExceptionPropagated = true;
  }
  assert(providerExceptionPropagated);
  assert(submitCalls == 1);

  std::puts(
      "PASS: correction selection is isolated from exactly-once provider submission");
  return 0;
}

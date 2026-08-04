#pragma once

#include <utility>

namespace yaagl::zzz_rt {

// Correction selection is fail-open, but the provider submission is not part
// of that recovery boundary. A provider exception must propagate to its caller
// and the provider must never be invoked a second time by the shim.
template <typename SelectCorrection, typename Submit>
decltype(auto) submitWithOptionalCorrection(SelectCorrection &&selectCorrection,
                                             Submit &&submit) {
  using Correction =
      decltype(std::forward<SelectCorrection>(selectCorrection)());
  Correction correction{};
  try {
    correction = std::forward<SelectCorrection>(selectCorrection)();
  } catch (...) {
    correction = Correction{};
  }
  return std::forward<Submit>(submit)(correction);
}

} // namespace yaagl::zzz_rt

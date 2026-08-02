#pragma once

#include <cstdint>

using YaaglRtOutputLog = void (*)(const char *line);

#ifndef YAAGL_CAPTURE_CONTRACT_TEST
extern "C" bool YaaglInstallRtOutputObserver(uintptr_t d3dmetalBase,
                                              YaaglRtOutputLog logCallback);
extern "C" bool YaaglRestoreRtOutputObserver();
extern "C" bool YaaglInstallComputeCorrelationObserver(
    uintptr_t d3dmetalBase, YaaglRtOutputLog logCallback);
extern "C" bool YaaglRestoreComputeCorrelationObserver();
extern "C" bool YaaglReadCurrentComputeCorrelation(uintptr_t *psoObject,
                                                     uint64_t *psoId);
#else
inline bool YaaglInstallRtOutputObserver(uintptr_t, YaaglRtOutputLog) {
  return true;
}
inline bool YaaglRestoreRtOutputObserver() { return true; }
inline bool YaaglInstallComputeCorrelationObserver(uintptr_t,
                                                    YaaglRtOutputLog) {
  return true;
}
inline bool YaaglRestoreComputeCorrelationObserver() { return true; }
inline bool YaaglReadCurrentComputeCorrelation(uintptr_t *, uint64_t *) {
  return false;
}
#endif

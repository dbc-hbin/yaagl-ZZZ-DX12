extern "C" int DynamicProviderCalls = 0;
extern "C" int DynamicOtherCalls = 0;
extern "C" int DynamicProbeTarget(int value) {
  ++DynamicProviderCalls;
  return value + 1;
}
extern "C" int DynamicOtherTarget(int value) {
  ++DynamicOtherCalls;
  return value + 10;
}

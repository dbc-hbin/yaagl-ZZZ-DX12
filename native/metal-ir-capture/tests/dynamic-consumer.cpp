extern "C" int DynamicProbeTarget(int);
extern "C" int DynamicOtherTarget(int);
extern "C" int DynamicConsumerCall(int value) {
  return DynamicProbeTarget(value);
}
extern "C" int DynamicConsumerOtherCall(int value) {
  return DynamicOtherTarget(value);
}

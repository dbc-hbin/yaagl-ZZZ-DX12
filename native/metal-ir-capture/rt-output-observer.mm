#include "rt-output-observer.hpp"

#include <atomic>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <Foundation/Foundation.h>
#include <mach/mach.h>
#include <objc/message.h>
#include <objc/runtime.h>
#include <pthread.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

namespace {

constexpr uintptr_t kDispatchRaysIndirectOffset = 0x16015b;
constexpr size_t kDispatchRaysIndirectPatchBytes = 17;
constexpr uintptr_t kComputePsoConstructorOffset = 0x10ed2c;
constexpr size_t kComputePsoConstructorPatchBytes = 18;
constexpr uintptr_t kComputePsoIdOffset = 0x20;
constexpr uint32_t kRtEventCap = 512;

using DispatchRaysIndirect =
    void (*)(void *, uint32_t, uint32_t, id, uint64_t);
using ComputePsoConstructor = void (*)(void *, void *, const void *);

struct MTLSizeValue {
  NSUInteger width;
  NSUInteger height;
  NSUInteger depth;
};

struct RangeValue {
  NSUInteger location;
  NSUInteger length;
};

std::atomic<bool> g_installed{false};
std::atomic<bool> g_compute_installed{false};
std::atomic<uint64_t> g_sequence{0};
std::atomic<uint32_t> g_event_count{0};
std::atomic<uint32_t> g_in_flight{0};
std::atomic<uint32_t> g_compute_in_flight{0};
uintptr_t g_d3dmetal_base = 0;
YaaglRtOutputLog g_log = nullptr;
void *g_target = nullptr;
void *g_trampoline_memory = nullptr;
DispatchRaysIndirect g_original_dispatch = nullptr;
vm_prot_t g_target_protection = VM_PROT_NONE;
uint8_t g_original_bytes[kDispatchRaysIndirectPatchBytes]{};
void *g_compute_target = nullptr;
void *g_compute_trampoline_memory = nullptr;
ComputePsoConstructor g_original_compute_constructor = nullptr;
vm_prot_t g_compute_target_protection = VM_PROT_NONE;
uint8_t g_compute_original_bytes[kComputePsoConstructorPatchBytes]{};

thread_local bool t_rt_active = false;
thread_local uint64_t t_sequence = 0;
thread_local void *t_encoder = nullptr;
thread_local const char *t_dispatch_path = "unobserved";
thread_local uint32_t t_dispatch_count = 0;
thread_local uint32_t t_resource_count = 0;
thread_local uint32_t t_barrier_count = 0;
thread_local void *t_compute_pso_object = nullptr;

uint64_t realtimeNanos() {
  timespec value{};
  if (clock_gettime(CLOCK_REALTIME, &value) != 0)
    return 0;
  return static_cast<uint64_t>(value.tv_sec) * 1000000000ULL +
         static_cast<uint64_t>(value.tv_nsec);
}

uint64_t threadId() {
  uint64_t value = 0;
  (void)pthread_threadid_np(nullptr, &value);
  return value;
}

void logLine(const char *format, ...) {
  if (!g_log || !format ||
      g_event_count.fetch_add(1, std::memory_order_relaxed) >= kRtEventCap)
    return;
  char body[1400]{};
  va_list args;
  va_start(args, format);
  const int bodyLength = vsnprintf(body, sizeof(body), format, args);
  va_end(args);
  if (bodyLength <= 0 || static_cast<size_t>(bodyLength) >= sizeof(body))
    return;
  char line[1700]{};
  const int length = snprintf(
      line, sizeof(line),
      "observer rt-output sequence=%llu time_ns=%llu tid=%llu encoder=%p %s\n",
      static_cast<unsigned long long>(t_sequence),
      static_cast<unsigned long long>(realtimeNanos()),
      static_cast<unsigned long long>(threadId()), t_encoder, body);
  if (length > 0 && static_cast<size_t>(length) < sizeof(line))
    g_log(line);
}

template <typename Function>
Function messageSend() {
  return reinterpret_cast<Function>(objc_msgSend);
}

bool responds(id object, const char *selectorName) {
  if (!object || !selectorName)
    return false;
  const SEL selector = sel_registerName(selectorName);
  const SEL respondsSelector = sel_registerName("respondsToSelector:");
  using Function = BOOL (*)(id, SEL, SEL);
  return messageSend<Function>()(object, respondsSelector, selector) != NO;
}

uint64_t readUnsigned(id object, const char *selectorName) {
  if (!responds(object, selectorName))
    return 0;
  using Function = NSUInteger (*)(id, SEL);
  return static_cast<uint64_t>(
      messageSend<Function>()(object, sel_registerName(selectorName)));
}

bool readIndirectDispatchGroups(id buffer, NSUInteger offset,
                                uint32_t groups[3],
                                const char **source) {
  if (source)
    *source = "invalid";
  if (!buffer || !groups || !responds(buffer, "contents")) {
    if (source)
      *source = "not_cpu_visible";
    return false;
  }
  const uint64_t length = readUnsigned(buffer, "length");
  if (static_cast<uint64_t>(offset) > length ||
      length - static_cast<uint64_t>(offset) < sizeof(uint32_t) * 3) {
    if (source)
      *source = "out_of_bounds";
    return false;
  }
  using ContentsFunction = void *(*)(id, SEL);
  void *contents = messageSend<ContentsFunction>()(
      buffer, sel_registerName("contents"));
  if (!contents) {
    if (source)
      *source = "not_cpu_visible";
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(contents);
  if (static_cast<uint64_t>(offset) > UINTPTR_MAX - base) {
    if (source)
      *source = "address_overflow";
    return false;
  }
  vm_size_t copied = 0;
  if (vm_read_overwrite(
          mach_task_self(), base + static_cast<uintptr_t>(offset),
          sizeof(uint32_t) * 3, reinterpret_cast<vm_address_t>(groups),
          &copied) != KERN_SUCCESS ||
      copied != sizeof(uint32_t) * 3) {
    if (source)
      *source = "unreadable";
    return false;
  }
  if (source)
    *source = "buffer_contents";
  return true;
}

uint64_t fnv1a(const void *bytes, size_t size) {
  const auto *cursor = static_cast<const uint8_t *>(bytes);
  uint64_t value = 1469598103934665603ULL;
  for (size_t index = 0; cursor && index < size; ++index) {
    value ^= cursor[index];
    value *= 1099511628211ULL;
  }
  return value;
}

const char *resourceState(const char *event, uint64_t usage) {
  if (event && std::strstr(event, "barrier"))
    return "barrier";
  if ((usage & 0x3) == 0x3)
    return "read_write";
  if (usage & 0x2)
    return "write";
  if (usage & 0x1)
    return "read";
  if (event && (std::strcmp(event, "set-buffer") == 0 ||
                std::strcmp(event, "set-texture") == 0 ||
                std::strcmp(event, "set-acceleration-structure") == 0))
    return "bound";
  return "unknown";
}

const char *resourceRole(uint64_t usage) {
  if (usage & 0x2)
    return "output_candidate";
  if (usage & 0x1)
    return "input";
  return "bound_or_unknown";
}

void logResource(const char *event, id resource, uint64_t usage,
                 uint64_t index, uint64_t offset) {
  if (!t_rt_active)
    return;
  ++t_resource_count;
  const bool texture = responds(resource, "pixelFormat");
  const bool buffer = responds(resource, "length");
  const uint64_t format = readUnsigned(resource, "pixelFormat");
  const uint64_t width = readUnsigned(resource, "width");
  const uint64_t height = readUnsigned(resource, "height");
  const uint64_t depth = readUnsigned(resource, "depth");
  const uint64_t length = readUnsigned(resource, "length");
  const uint64_t gpuAddress = readUnsigned(resource, "gpuAddress");
  const uint64_t gpuResourceId = readUnsigned(resource, "gpuResourceID");
  const uint64_t resourceId = readUnsigned(resource, "resourceID");
  const uint64_t declaredUsage = readUnsigned(resource, "usage");
  const uint64_t storage = readUnsigned(resource, "storageMode");
  const uint64_t hazard = readUnsigned(resource, "hazardTrackingMode");
  const uint64_t options = readUnsigned(resource, "resourceOptions");
  logLine(
      "event=%s resource=%p kind=%s usage=0x%llx index=%llu offset=%llu "
      "format=%llu extent=%llux%llux%llu length=%llu gpu_address=0x%llx "
      "gpu_resource_id=0x%llx resource_id=0x%llx declared_usage=0x%llx "
      "storage=%llu hazard=%llu options=0x%llx state=%s role=%s "
      "state_source=metal_usage",
      event ? event : "resource", resource,
      texture ? "texture" : (buffer ? "buffer" : "opaque"),
      static_cast<unsigned long long>(usage),
      static_cast<unsigned long long>(index),
      static_cast<unsigned long long>(offset),
      static_cast<unsigned long long>(format),
      static_cast<unsigned long long>(width),
      static_cast<unsigned long long>(height),
      static_cast<unsigned long long>(depth),
      static_cast<unsigned long long>(length),
      static_cast<unsigned long long>(gpuAddress),
      static_cast<unsigned long long>(gpuResourceId),
      static_cast<unsigned long long>(resourceId),
      static_cast<unsigned long long>(declaredUsage),
      static_cast<unsigned long long>(storage),
      static_cast<unsigned long long>(hazard),
      static_cast<unsigned long long>(options), resourceState(event, usage),
      resourceRole(usage));
}

#define YAAGL_ALIAS(name) "yaagl_rt_observer_" name

void setComputePipelineState(id self, SEL, id state) {
  if (t_rt_active)
    logLine("event=set-compute-pso pso=%p", state);
  using Function = void (*)(id, SEL, id);
  messageSend<Function>()(
      self, sel_registerName(YAAGL_ALIAS("setComputePipelineState:")), state);
}

void setBytes(id self, SEL, const void *bytes, NSUInteger length,
              NSUInteger index) {
  if (t_rt_active) {
    const size_t bounded = length > 256 ? 256 : static_cast<size_t>(length);
    uint64_t words[6]{};
    if (bytes && length >= sizeof(words))
      std::memcpy(words, bytes, sizeof(words));
    logLine(
        "event=set-bytes index=%llu length=%llu checksum=0x%llx "
        "word0=0x%llx word1=0x%llx word2=0x%llx word3=0x%llx "
        "word4=0x%llx word5=0x%llx argument_block=%s "
        "argument_id0=0x%llx argument_id1=0x%llx",
        static_cast<unsigned long long>(index),
        static_cast<unsigned long long>(length),
        static_cast<unsigned long long>(fnv1a(bytes, bounded)),
        static_cast<unsigned long long>(words[0]),
        static_cast<unsigned long long>(words[1]),
        static_cast<unsigned long long>(words[2]),
        static_cast<unsigned long long>(words[3]),
        static_cast<unsigned long long>(words[4]),
        static_cast<unsigned long long>(words[5]),
        index == 3 && length == 0x30 ? "rt-dispatch" : "other",
        static_cast<unsigned long long>(words[3]),
        static_cast<unsigned long long>(words[5]));
  }
  using Function = void (*)(id, SEL, const void *, NSUInteger, NSUInteger);
  messageSend<Function>()(
      self, sel_registerName(YAAGL_ALIAS("setBytes:length:atIndex:")), bytes,
      length, index);
}

void setBuffer(id self, SEL, id buffer, NSUInteger offset, NSUInteger index) {
  logResource("set-buffer", buffer, 0, index, offset);
  using Function = void (*)(id, SEL, id, NSUInteger, NSUInteger);
  messageSend<Function>()(
      self, sel_registerName(YAAGL_ALIAS("setBuffer:offset:atIndex:")),
      buffer, offset, index);
}

void setTexture(id self, SEL, id texture, NSUInteger index) {
  logResource("set-texture", texture, readUnsigned(texture, "usage"), index,
              0);
  using Function = void (*)(id, SEL, id, NSUInteger);
  messageSend<Function>()(
      self, sel_registerName(YAAGL_ALIAS("setTexture:atIndex:")), texture,
      index);
}

void setAccelerationStructure(id self, SEL, id accelerationStructure,
                              NSUInteger index) {
  if (t_rt_active) {
    ++t_resource_count;
    logLine("event=set-acceleration-structure index=%llu resource=%p "
            "gpu_resource_id=0x%llx resource_id=0x%llx state=read "
            "state_source=acceleration_structure",
            static_cast<unsigned long long>(index), accelerationStructure,
            static_cast<unsigned long long>(
                readUnsigned(accelerationStructure, "gpuResourceID")),
            static_cast<unsigned long long>(
                readUnsigned(accelerationStructure, "resourceID")));
  }
  using Function = void (*)(id, SEL, id, NSUInteger);
  messageSend<Function>()(
      self,
      sel_registerName(
          YAAGL_ALIAS("setAccelerationStructure:atBufferIndex:")),
      accelerationStructure, index);
}

void useResource(id self, SEL, id resource, NSUInteger usage) {
  logResource("use-resource", resource, usage, 0, 0);
  using Function = void (*)(id, SEL, id, NSUInteger);
  messageSend<Function>()(
      self, sel_registerName(YAAGL_ALIAS("useResource:usage:")), resource,
      usage);
}

void dispatchThreads(id self, SEL, MTLSizeValue grid,
                     MTLSizeValue threadsPerThreadgroup) {
  if (t_rt_active) {
    if (std::strcmp(t_dispatch_path, "unobserved") == 0)
      t_dispatch_path = "direct";
    ++t_dispatch_count;
    logLine(
        "event=dispatch-threads grid=%llux%llux%llu threads_per_group=%llux%llux%llu",
        static_cast<unsigned long long>(grid.width),
        static_cast<unsigned long long>(grid.height),
        static_cast<unsigned long long>(grid.depth),
        static_cast<unsigned long long>(threadsPerThreadgroup.width),
        static_cast<unsigned long long>(threadsPerThreadgroup.height),
        static_cast<unsigned long long>(threadsPerThreadgroup.depth));
  }
  using Function = void (*)(id, SEL, MTLSizeValue, MTLSizeValue);
  messageSend<Function>()(
      self,
      sel_registerName(YAAGL_ALIAS("dispatchThreads:threadsPerThreadgroup:")),
      grid, threadsPerThreadgroup);
}

void dispatchThreadgroups(id self, SEL, MTLSizeValue groups,
                          MTLSizeValue threadsPerThreadgroup) {
  if (t_rt_active) {
    if (std::strcmp(t_dispatch_path, "unobserved") == 0)
      t_dispatch_path = "direct";
    ++t_dispatch_count;
    logLine(
        "event=dispatch-threadgroups groups=%llux%llux%llu threads_per_group=%llux%llux%llu",
        static_cast<unsigned long long>(groups.width),
        static_cast<unsigned long long>(groups.height),
        static_cast<unsigned long long>(groups.depth),
        static_cast<unsigned long long>(threadsPerThreadgroup.width),
        static_cast<unsigned long long>(threadsPerThreadgroup.height),
        static_cast<unsigned long long>(threadsPerThreadgroup.depth));
  }
  using Function = void (*)(id, SEL, MTLSizeValue, MTLSizeValue);
  messageSend<Function>()(
      self,
      sel_registerName(
          YAAGL_ALIAS("dispatchThreadgroups:threadsPerThreadgroup:")),
      groups, threadsPerThreadgroup);
}

void dispatchThreadgroupsIndirect(id self, SEL, id buffer, NSUInteger offset,
                                  MTLSizeValue threadsPerThreadgroup) {
  if (t_rt_active) {
    t_dispatch_path = "direct";
    ++t_dispatch_count;
    logResource("dispatch-indirect-buffer", buffer, 1, 0, offset);
    uint32_t groups[3]{};
    const char *groupsSource = nullptr;
    if (readIndirectDispatchGroups(buffer, offset, groups, &groupsSource)) {
      logLine(
          "event=dispatch-indirect mode=per-record-indirect offset=%llu "
          "groups=%ux%ux%u groups_source=%s "
          "threads_per_group=%llux%llux%llu",
          static_cast<unsigned long long>(offset), groups[0], groups[1],
          groups[2], groupsSource,
          static_cast<unsigned long long>(threadsPerThreadgroup.width),
          static_cast<unsigned long long>(threadsPerThreadgroup.height),
          static_cast<unsigned long long>(threadsPerThreadgroup.depth));
    } else {
      logLine(
          "event=dispatch-indirect mode=per-record-indirect offset=%llu "
          "groups=unavailable groups_source=%s "
          "threads_per_group=%llux%llux%llu",
          static_cast<unsigned long long>(offset),
          groupsSource ? groupsSource : "unknown",
          static_cast<unsigned long long>(threadsPerThreadgroup.width),
          static_cast<unsigned long long>(threadsPerThreadgroup.height),
          static_cast<unsigned long long>(threadsPerThreadgroup.depth));
    }
  }
  using Function = void (*)(id, SEL, id, NSUInteger, MTLSizeValue);
  messageSend<Function>()(
      self,
      sel_registerName(YAAGL_ALIAS(
          "dispatchThreadgroupsWithIndirectBuffer:indirectBufferOffset:"
          "threadsPerThreadgroup:")),
      buffer, offset, threadsPerThreadgroup);
}

void memoryBarrierScope(id self, SEL, NSUInteger scope) {
  if (t_rt_active) {
    ++t_barrier_count;
    logLine("event=memory-barrier scope=0x%llx",
            static_cast<unsigned long long>(scope));
  }
  using Function = void (*)(id, SEL, NSUInteger);
  messageSend<Function>()(
      self, sel_registerName(YAAGL_ALIAS("memoryBarrierWithScope:")), scope);
}

void memoryBarrierResources(id self, SEL, const id *resources,
                            NSUInteger count) {
  if (t_rt_active) {
    ++t_barrier_count;
    logLine("event=memory-barrier-resources count=%llu",
            static_cast<unsigned long long>(count));
    const NSUInteger bounded = count > 16 ? 16 : count;
    for (NSUInteger index = 0; resources && index < bounded; ++index)
      logResource("barrier-resource", resources[index], 0, index, 0);
  }
  using Function = void (*)(id, SEL, const id *, NSUInteger);
  messageSend<Function>()(
      self,
      sel_registerName(YAAGL_ALIAS("memoryBarrierWithResources:count:")),
      resources, count);
}

void executeCommands(id self, SEL, id commandBuffer, RangeValue range) {
  if (t_rt_active) {
    t_dispatch_path = "icb";
    ++t_dispatch_count;
    logResource("execute-icb", commandBuffer, 1, range.location, range.length);
    logLine("event=execute-icb range_location=%llu range_length=%llu",
            static_cast<unsigned long long>(range.location),
            static_cast<unsigned long long>(range.length));
  }
  using Function = void (*)(id, SEL, id, RangeValue);
  messageSend<Function>()(
      self,
      sel_registerName(YAAGL_ALIAS("executeCommandsInBuffer:withRange:")),
      commandBuffer, range);
}

struct HookSpec {
  const char *selector;
  const char *alias;
  IMP implementation;
};

const HookSpec kHooks[] = {
    {"setComputePipelineState:", YAAGL_ALIAS("setComputePipelineState:"),
     reinterpret_cast<IMP>(&setComputePipelineState)},
    {"setBytes:length:atIndex:", YAAGL_ALIAS("setBytes:length:atIndex:"),
     reinterpret_cast<IMP>(&setBytes)},
    {"setBuffer:offset:atIndex:", YAAGL_ALIAS("setBuffer:offset:atIndex:"),
     reinterpret_cast<IMP>(&setBuffer)},
    {"setTexture:atIndex:", YAAGL_ALIAS("setTexture:atIndex:"),
     reinterpret_cast<IMP>(&setTexture)},
    {"setAccelerationStructure:atBufferIndex:",
     YAAGL_ALIAS("setAccelerationStructure:atBufferIndex:"),
     reinterpret_cast<IMP>(&setAccelerationStructure)},
    {"useResource:usage:", YAAGL_ALIAS("useResource:usage:"),
     reinterpret_cast<IMP>(&useResource)},
    {"dispatchThreads:threadsPerThreadgroup:",
     YAAGL_ALIAS("dispatchThreads:threadsPerThreadgroup:"),
     reinterpret_cast<IMP>(&dispatchThreads)},
    {"dispatchThreadgroups:threadsPerThreadgroup:",
     YAAGL_ALIAS("dispatchThreadgroups:threadsPerThreadgroup:"),
     reinterpret_cast<IMP>(&dispatchThreadgroups)},
    {"dispatchThreadgroupsWithIndirectBuffer:indirectBufferOffset:"
     "threadsPerThreadgroup:",
     YAAGL_ALIAS("dispatchThreadgroupsWithIndirectBuffer:indirectBufferOffset:"
                 "threadsPerThreadgroup:"),
     reinterpret_cast<IMP>(&dispatchThreadgroupsIndirect)},
    {"memoryBarrierWithScope:", YAAGL_ALIAS("memoryBarrierWithScope:"),
     reinterpret_cast<IMP>(&memoryBarrierScope)},
    {"memoryBarrierWithResources:count:",
     YAAGL_ALIAS("memoryBarrierWithResources:count:"),
     reinterpret_cast<IMP>(&memoryBarrierResources)},
    {"executeCommandsInBuffer:withRange:",
     YAAGL_ALIAS("executeCommandsInBuffer:withRange:"),
     reinterpret_cast<IMP>(&executeCommands)},
};

uint32_t installMethodObservers() {
  const int classCount = objc_getClassList(nullptr, 0);
  if (classCount <= 0)
    return 0;
  auto *classes = static_cast<Class *>(
      std::calloc(static_cast<size_t>(classCount), sizeof(Class)));
  if (!classes)
    return 0;
  const int loaded = objc_getClassList(classes, classCount);
  uint32_t installed = 0;
  for (int classIndex = 0; classIndex < loaded; ++classIndex) {
    unsigned methodCount = 0;
    Method *methods = class_copyMethodList(classes[classIndex], &methodCount);
    for (unsigned methodIndex = 0; methods && methodIndex < methodCount;
         ++methodIndex) {
      Method method = methods[methodIndex];
      const SEL selector = method_getName(method);
      for (const HookSpec &hook : kHooks) {
        if (!sel_isEqual(selector, sel_registerName(hook.selector)))
          continue;
        const SEL alias = sel_registerName(hook.alias);
        if (!class_addMethod(classes[classIndex], alias,
                             method_getImplementation(method),
                             method_getTypeEncoding(method)))
          continue;
        method_setImplementation(method, hook.implementation);
        ++installed;
      }
    }
    std::free(methods);
  }
  std::free(classes);
  return installed;
}

bool queryProtection(void *pointer, vm_prot_t *protection) {
  if (!pointer || !protection)
    return false;
  vm_address_t address = reinterpret_cast<vm_address_t>(pointer);
  vm_size_t size = 0;
  vm_region_basic_info_data_64_t info{};
  mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
  mach_port_t object = MACH_PORT_NULL;
  if (vm_region_64(mach_task_self(), &address, &size,
                   VM_REGION_BASIC_INFO_64,
                   reinterpret_cast<vm_region_info_t>(&info), &count,
                   &object) != KERN_SUCCESS)
    return false;
  *protection = info.protection;
  return true;
}

void writeAbsoluteJump(uint8_t *destination, const void *target,
                       size_t capacity) {
  if (!destination || capacity < 14)
    return;
  destination[0] = 0xff;
  destination[1] = 0x25;
  destination[2] = 0;
  destination[3] = 0;
  destination[4] = 0;
  destination[5] = 0;
  const uint64_t address = reinterpret_cast<uint64_t>(target);
  std::memcpy(destination + 6, &address, sizeof(address));
  for (size_t index = 14; index < capacity; ++index)
    destination[index] = 0x90;
}

void dispatchRaysIndirectObserver(void *encoder, uint32_t recordCount,
                                  uint32_t flags, id indirectBuffer,
                                  uint64_t indirectOffset) {
  if (!g_original_dispatch)
    return;
  if (t_rt_active) {
    g_original_dispatch(encoder, recordCount, flags, indirectBuffer,
                        indirectOffset);
    return;
  }
  struct ActiveGuard {
    ~ActiveGuard() {
      logLine(
          "event=end path=%s dispatches=%u resources=%u barriers=%u "
          "internal_barrier_src=4 internal_barrier_dst=4",
          t_dispatch_path, t_dispatch_count, t_resource_count,
          t_barrier_count);
      t_rt_active = false;
      t_sequence = 0;
      t_encoder = nullptr;
      t_dispatch_path = "unobserved";
      t_dispatch_count = 0;
      t_resource_count = 0;
      t_barrier_count = 0;
      g_in_flight.fetch_sub(1, std::memory_order_acq_rel);
    }
  } guard;
  g_in_flight.fetch_add(1, std::memory_order_acq_rel);
  t_rt_active = true;
  t_sequence = g_sequence.fetch_add(1, std::memory_order_relaxed);
  t_encoder = encoder;
  (void)installMethodObservers();
  logLine("event=begin caller=0x16015b records=%u flags=%u "
          "indirect_buffer=%p indirect_offset=%llu",
          recordCount, flags, indirectBuffer,
          static_cast<unsigned long long>(indirectOffset));
  logResource("dispatch-argument-buffer", indirectBuffer, 1, 0,
              indirectOffset);
  g_original_dispatch(encoder, recordCount, flags, indirectBuffer,
                      indirectOffset);
}

void computePsoConstructorObserver(void *object, void *device,
                                   const void *descriptor) {
  ComputePsoConstructor original = g_original_compute_constructor;
  if (!original)
    return;
  struct ActiveGuard {
    void *previous;
    explicit ActiveGuard(void *current) : previous(t_compute_pso_object) {
      g_compute_in_flight.fetch_add(1, std::memory_order_acq_rel);
      t_compute_pso_object = current;
    }
    ~ActiveGuard() {
      t_compute_pso_object = previous;
      g_compute_in_flight.fetch_sub(1, std::memory_order_acq_rel);
    }
  } guard(object);
  original(object, device, descriptor);
}

bool installComputeCorrelationHook() {
  static const uint8_t expected[kComputePsoConstructorPatchBytes] = {
      0x55, 0x41, 0x57, 0x41, 0x56, 0x41, 0x54, 0x53, 0x48,
      0x83, 0xec, 0x30, 0x49, 0x89, 0xd7, 0x49, 0x89, 0xf6};
  auto *target = reinterpret_cast<uint8_t *>(
      g_d3dmetal_base + kComputePsoConstructorOffset);
  if (std::memcmp(target, expected, sizeof(expected)) != 0)
    return false;
  if (!queryProtection(target, &g_compute_target_protection))
    return false;
  const size_t pageSize = static_cast<size_t>(getpagesize());
  void *trampoline = mmap(nullptr, pageSize, PROT_READ | PROT_WRITE,
                          MAP_PRIVATE | MAP_ANON, -1, 0);
  if (trampoline == MAP_FAILED)
    return false;
  std::memcpy(g_compute_original_bytes, target,
              sizeof(g_compute_original_bytes));
  std::memcpy(trampoline, target, sizeof(g_compute_original_bytes));
  writeAbsoluteJump(static_cast<uint8_t *>(trampoline) +
                        sizeof(g_compute_original_bytes),
                    target + sizeof(g_compute_original_bytes),
                    pageSize - sizeof(g_compute_original_bytes));
  if (mprotect(trampoline, pageSize, PROT_READ | PROT_EXEC) != 0) {
    (void)munmap(trampoline, pageSize);
    return false;
  }
  g_compute_target = target;
  g_compute_trampoline_memory = trampoline;
  g_original_compute_constructor =
      reinterpret_cast<ComputePsoConstructor>(trampoline);
  const vm_address_t page = reinterpret_cast<vm_address_t>(target) &
                            ~static_cast<vm_address_t>(pageSize - 1);
  if (vm_protect(mach_task_self(), page, pageSize, false,
                 g_compute_target_protection | VM_PROT_WRITE) != KERN_SUCCESS) {
    g_compute_target = nullptr;
    g_compute_trampoline_memory = nullptr;
    g_original_compute_constructor = nullptr;
    (void)munmap(trampoline, pageSize);
    return false;
  }
  uint8_t patch[kComputePsoConstructorPatchBytes]{};
  writeAbsoluteJump(
      patch, reinterpret_cast<const void *>(&computePsoConstructorObserver),
      sizeof(patch));
  std::memcpy(target, patch, sizeof(patch));
  __builtin___clear_cache(reinterpret_cast<char *>(target),
                          reinterpret_cast<char *>(target + sizeof(patch)));
  if (vm_protect(mach_task_self(), page, pageSize, false,
                 g_compute_target_protection) != KERN_SUCCESS) {
    std::memcpy(target, g_compute_original_bytes,
                sizeof(g_compute_original_bytes));
    __builtin___clear_cache(
        reinterpret_cast<char *>(target),
        reinterpret_cast<char *>(target + sizeof(g_compute_original_bytes)));
    g_compute_target = nullptr;
    g_compute_trampoline_memory = nullptr;
    g_original_compute_constructor = nullptr;
    (void)munmap(trampoline, pageSize);
    return false;
  }
  return true;
}

bool installInlineHook() {
  static const uint8_t expected[kDispatchRaysIndirectPatchBytes] = {
      0x55, 0x41, 0x57, 0x41, 0x56, 0x41, 0x55, 0x41, 0x54,
      0x53, 0x48, 0x81, 0xec, 0xf8, 0x00, 0x00, 0x00};
  auto *target = reinterpret_cast<uint8_t *>(
      g_d3dmetal_base + kDispatchRaysIndirectOffset);
  if (std::memcmp(target, expected, sizeof(expected)) != 0)
    return false;
  if (!queryProtection(target, &g_target_protection))
    return false;
  const size_t pageSize = static_cast<size_t>(getpagesize());
  void *trampoline = mmap(nullptr, pageSize, PROT_READ | PROT_WRITE,
                          MAP_PRIVATE | MAP_ANON, -1, 0);
  if (trampoline == MAP_FAILED)
    return false;
  std::memcpy(g_original_bytes, target, sizeof(g_original_bytes));
  std::memcpy(trampoline, target, sizeof(g_original_bytes));
  writeAbsoluteJump(static_cast<uint8_t *>(trampoline) +
                        sizeof(g_original_bytes),
                    target + sizeof(g_original_bytes),
                    pageSize - sizeof(g_original_bytes));
  if (mprotect(trampoline, pageSize, PROT_READ | PROT_EXEC) != 0) {
    (void)munmap(trampoline, pageSize);
    return false;
  }
  // Publish the pass-through target before the patched entry point can become
  // visible to another thread. A racing dispatch can therefore never be lost.
  g_target = target;
  g_trampoline_memory = trampoline;
  g_original_dispatch = reinterpret_cast<DispatchRaysIndirect>(trampoline);
  const vm_address_t page = reinterpret_cast<vm_address_t>(target) &
                            ~static_cast<vm_address_t>(pageSize - 1);
  if (vm_protect(mach_task_self(), page, pageSize, false,
                 g_target_protection | VM_PROT_WRITE) != KERN_SUCCESS) {
    g_target = nullptr;
    g_trampoline_memory = nullptr;
    g_original_dispatch = nullptr;
    (void)munmap(trampoline, pageSize);
    return false;
  }
  uint8_t patch[kDispatchRaysIndirectPatchBytes]{};
  writeAbsoluteJump(patch,
                    reinterpret_cast<const void *>(&dispatchRaysIndirectObserver),
                    sizeof(patch));
  std::memcpy(target, patch, sizeof(patch));
  __builtin___clear_cache(reinterpret_cast<char *>(target),
                          reinterpret_cast<char *>(target + sizeof(patch)));
  if (vm_protect(mach_task_self(), page, pageSize, false,
                 g_target_protection) != KERN_SUCCESS) {
    std::memcpy(target, g_original_bytes, sizeof(g_original_bytes));
    __builtin___clear_cache(reinterpret_cast<char *>(target),
                            reinterpret_cast<char *>(
                                target + sizeof(g_original_bytes)));
    g_target = nullptr;
    g_trampoline_memory = nullptr;
    g_original_dispatch = nullptr;
    (void)munmap(trampoline, pageSize);
    return false;
  }
  return true;
}

}  // namespace

extern "C" bool YaaglInstallRtOutputObserver(uintptr_t d3dmetalBase,
                                              YaaglRtOutputLog logCallback) {
  if (g_installed.load(std::memory_order_acquire))
    return true;
  if (!d3dmetalBase || !logCallback)
    return false;
  g_d3dmetal_base = d3dmetalBase;
  g_log = logCallback;
  const uint32_t methods = installMethodObservers();
  if (!installInlineHook()) {
    g_log = nullptr;
    return false;
  }
  g_installed.store(true, std::memory_order_release);
  char line[256]{};
  const int length = snprintf(
      line, sizeof(line),
      "observer rt-output installed target=0x16015b body_end=0x1607be "
      "method_hooks=%u\n",
      methods);
  if (length > 0 && static_cast<size_t>(length) < sizeof(line))
    logCallback(line);
  return true;
}

extern "C" bool YaaglInstallComputeCorrelationObserver(
    uintptr_t d3dmetalBase, YaaglRtOutputLog logCallback) {
  if (g_compute_installed.load(std::memory_order_acquire))
    return true;
  if (!d3dmetalBase || !logCallback)
    return false;
  g_d3dmetal_base = d3dmetalBase;
  g_log = logCallback;
  if (!installComputeCorrelationHook())
    return false;
  g_compute_installed.store(true, std::memory_order_release);
  char line[192]{};
  const int length = snprintf(
      line, sizeof(line),
      "observer compute-correlation installed target=0x10ed2c id_offset=0x20\n");
  if (length > 0 && static_cast<size_t>(length) < sizeof(line))
    logCallback(line);
  return true;
}

extern "C" bool YaaglReadCurrentComputeCorrelation(uintptr_t *psoObject,
                                                     uint64_t *psoId) {
  if (!t_compute_pso_object)
    return false;
  uint32_t identifier = 0;
  std::memcpy(&identifier,
              static_cast<const uint8_t *>(t_compute_pso_object) +
                  kComputePsoIdOffset,
              sizeof(identifier));
  if (psoObject)
    *psoObject = reinterpret_cast<uintptr_t>(t_compute_pso_object);
  if (psoId)
    *psoId = identifier;
  return true;
}

extern "C" bool YaaglRestoreComputeCorrelationObserver() {
  if (!g_compute_installed.load(std::memory_order_acquire))
    return true;
  if (g_compute_in_flight.load(std::memory_order_acquire) != 0 ||
      !g_compute_target)
    return false;
  const size_t pageSize = static_cast<size_t>(getpagesize());
  const vm_address_t page = reinterpret_cast<vm_address_t>(g_compute_target) &
                            ~static_cast<vm_address_t>(pageSize - 1);
  if (vm_protect(mach_task_self(), page, pageSize, false,
                 g_compute_target_protection | VM_PROT_WRITE) != KERN_SUCCESS)
    return false;
  std::memcpy(g_compute_target, g_compute_original_bytes,
              sizeof(g_compute_original_bytes));
  __builtin___clear_cache(
      reinterpret_cast<char *>(g_compute_target),
      reinterpret_cast<char *>(g_compute_target) +
          sizeof(g_compute_original_bytes));
  const bool protectedAgain =
      vm_protect(mach_task_self(), page, pageSize, false,
                 g_compute_target_protection) == KERN_SUCCESS;
  if (g_compute_trampoline_memory)
    (void)munmap(g_compute_trampoline_memory,
                 static_cast<size_t>(getpagesize()));
  g_compute_target = nullptr;
  g_compute_trampoline_memory = nullptr;
  g_original_compute_constructor = nullptr;
  g_compute_installed.store(false, std::memory_order_release);
  return protectedAgain;
}

extern "C" bool YaaglRestoreRtOutputObserver() {
  if (!g_installed.load(std::memory_order_acquire))
    return true;
  if (g_in_flight.load(std::memory_order_acquire) != 0 || !g_target)
    return false;
  const size_t pageSize = static_cast<size_t>(getpagesize());
  const vm_address_t page = reinterpret_cast<vm_address_t>(g_target) &
                            ~static_cast<vm_address_t>(pageSize - 1);
  if (vm_protect(mach_task_self(), page, pageSize, false,
                 g_target_protection | VM_PROT_WRITE) != KERN_SUCCESS)
    return false;
  std::memcpy(g_target, g_original_bytes, sizeof(g_original_bytes));
  __builtin___clear_cache(reinterpret_cast<char *>(g_target),
                          reinterpret_cast<char *>(g_target) +
                              sizeof(g_original_bytes));
  const bool protectedAgain =
      vm_protect(mach_task_self(), page, pageSize, false,
                 g_target_protection) == KERN_SUCCESS;
  if (g_trampoline_memory)
    (void)munmap(g_trampoline_memory, static_cast<size_t>(getpagesize()));
  g_target = nullptr;
  g_trampoline_memory = nullptr;
  g_original_dispatch = nullptr;
  g_installed.store(false, std::memory_order_release);
  return protectedAgain;
}

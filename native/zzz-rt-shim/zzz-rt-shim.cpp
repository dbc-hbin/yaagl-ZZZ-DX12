// ZZZ production RT shim.
//
// This is deliberately not a diagnostic sidecar: no capture protocol, worker
// threads, source exports, observers, or teardown hooks.  It replaces only
// the known broken DXIL codecs at the two verified D3DMetal compiler callers
// and otherwise tail-calls the provider's original CompileAndLink function.

#include <CommonCrypto/CommonDigest.h>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <dlfcn.h>
#include <fcntl.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach/mach.h>
#include <new>
#include <string>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

#include "../metal-ir-capture/dxc-runtime.hpp"
#include "../metal-ir-capture/unorm24-transform.hpp"

struct IRCompiler;
struct IRObject;
struct IRError;
using CompileAndLink = IRObject *(*)(IRCompiler *, const std::vector<std::string> &,
                                     const IRObject *, IRError **);
using CreateDxilObject = IRObject *(*)(const char *, size_t);

namespace {

constexpr const char *kMode = "zzz-rt-shim-v1";
constexpr uintptr_t kGotOffset = 0x4ae1a0;
constexpr uintptr_t kCityCompileCallerOffset = 0x87ec9;
constexpr uintptr_t kHistoricalRtCompileCallerOffset = 0x9a12f;
constexpr uintptr_t kProviderCompileAndLinkOffset = 0x92fe30;
constexpr uintptr_t kProviderCreateDxilOffset = 0x931b40;
constexpr uintptr_t kDxilVtableOffset = 0x14940e0;
constexpr size_t kDxilObjectHeaderBytes = 0x20;
constexpr size_t kSourceCap = 64 * 1024;
constexpr size_t kAssembledCap = 256 * 1024;
constexpr uint32_t kCacheCap = 32;
constexpr uint32_t kExactSourceBytes = 26964;
constexpr uint32_t kExactReplacementBytes = 17720;
constexpr const char *kExactSourceSha256 =
    "02d3db46e867f0b38da35a492101ae35544f5f93425fb4fb29120aeeea431869";
constexpr const char *kExactReplacementSha256 =
    "c64e67eabc3cf5ff89359c3075ebe00387c5a46d5136ea61dfbdd832b2f01717";
constexpr uint32_t kInjectCacheSourceBytes = 33228;
constexpr const char *kInjectCacheSourceSha256 =
    "843be9c95dd09b3e4da739d67b91257495fb746da91b57eb52f859e682dd55ff";
constexpr const char *kDxcompilerSha256 =
    "57dc9421af62c35b372adf7536f07b1e2c20ef32dc1f4c16930a42fc12ed1fd2";

struct ObjectSnapshot {
  uint32_t size = 0;
  uint8_t digest[CC_SHA256_DIGEST_LENGTH]{};
  alignas(64) uint8_t bytes[kSourceCap]{};
};
struct CacheEntry {
  bool occupied = false;
  uint8_t sourceDigest[CC_SHA256_DIGEST_LENGTH]{};
  IRObject *object = nullptr;
};
struct NegativeCacheEntry {
  bool occupied = false;
  uint8_t sourceDigest[CC_SHA256_DIGEST_LENGTH]{};
};

std::atomic<CompileAndLink> g_original{nullptr};
std::atomic<bool> g_installed{false};
std::atomic<bool> g_runtimeReady{false};
std::atomic<bool> g_runtimeAttempted{false};
std::atomic_flag g_installLock = ATOMIC_FLAG_INIT;
std::atomic_flag g_runtimeLock = ATOMIC_FLAG_INIT;
std::atomic_flag g_cacheLock = ATOMIC_FLAG_INIT;
const mach_header_64 *g_d3dmetal = nullptr;
const mach_header_64 *g_provider = nullptr;
CompileAndLink *g_slot = nullptr;
vm_prot_t g_slotProtection = VM_PROT_NONE;
yaagl::dxc::Runtime *g_dxc = nullptr;
const uint8_t *g_exactReplacementBytes = nullptr;
IRObject *g_exactReplacement = nullptr;
CacheEntry g_cache[kCacheCap];
uint32_t g_cacheCount = 0;
NegativeCacheEntry g_negativeCache[kCacheCap];
uint32_t g_negativeCacheCount = 0;
thread_local ObjectSnapshot g_snapshot;

bool image(const mach_header_64 *header) {
  return header && header->magic == MH_MAGIC_64 &&
         header->cputype == CPU_TYPE_X86_64;
}

bool hex(const uint8_t *bytes, size_t size, char *out, size_t capacity) {
  if (!bytes || !out || capacity < size * 2 + 1)
    return false;
  static constexpr char table[] = "0123456789abcdef";
  for (size_t index = 0; index < size; ++index) {
    out[index * 2] = table[bytes[index] >> 4];
    out[index * 2 + 1] = table[bytes[index] & 0x0f];
  }
  out[size * 2] = 0;
  return true;
}

bool digest(const void *bytes, size_t size, uint8_t output[32]) {
  return bytes && size <= UINT32_MAX &&
         CC_SHA256(bytes, static_cast<CC_LONG>(size), output) != nullptr;
}

bool digestMatches(const uint8_t value[32], const char *expected) {
  char actual[65]{};
  return expected && hex(value, 32, actual, sizeof(actual)) &&
         std::strcmp(actual, expected) == 0;
}

bool fileDigestMatches(const char *path, const char *expected) {
  if (!path || !*path || !expected)
    return false;
  struct stat status{};
  if (stat(path, &status) != 0 || !S_ISREG(status.st_mode) ||
      status.st_size <= 0 || status.st_size > INT32_MAX)
    return false;
  const int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0)
    return false;
  const size_t size = static_cast<size_t>(status.st_size);
  const void *mapping = mmap(nullptr, size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);
  uint8_t value[32]{};
  const bool ok = mapping != MAP_FAILED && digest(mapping, size, value) &&
                  digestMatches(value, expected);
  if (mapping != MAP_FAILED)
    munmap(const_cast<void *>(mapping), size);
  return ok;
}

bool pageProtection(void *pointer, vm_prot_t *output) {
  vm_address_t address = reinterpret_cast<vm_address_t>(pointer);
  vm_size_t size = 0;
  vm_region_basic_info_data_64_t info{};
  mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
  mach_port_t object = MACH_PORT_NULL;
  if (vm_region_64(mach_task_self(), &address, &size, VM_REGION_BASIC_INFO_64,
                   reinterpret_cast<vm_region_info_t>(&info), &count,
                   &object) != KERN_SUCCESS)
    return false;
  *output = info.protection;
  return true;
}

bool setPageProtection(void *pointer, vm_prot_t protection) {
  const vm_address_t page = reinterpret_cast<vm_address_t>(pointer) &
                            ~static_cast<vm_address_t>(getpagesize() - 1);
  return vm_protect(mach_task_self(), page, getpagesize(), false, protection) ==
         KERN_SUCCESS;
}

bool readObject(const IRObject *object, ObjectSnapshot *snapshot) {
  if (!object || !snapshot || !g_provider)
    return false;
  uint8_t header[kDxilObjectHeaderBytes]{};
  vm_size_t copied = 0;
  if (vm_read_overwrite(mach_task_self(), reinterpret_cast<vm_address_t>(object),
                        sizeof(header), reinterpret_cast<vm_address_t>(header),
                        &copied) != KERN_SUCCESS || copied != sizeof(header))
    return false;
  const void *vtable = nullptr;
  const uint8_t *bytes = nullptr;
  uint32_t size = 0;
  uint8_t type = 0;
  uint8_t owns = 1;
  std::memcpy(&vtable, header, sizeof(vtable));
  std::memcpy(&bytes, header + 0x10, sizeof(bytes));
  std::memcpy(&size, header + 0x18, sizeof(size));
  std::memcpy(&type, header + 0x1c, sizeof(type));
  std::memcpy(&owns, header + 0x1d, sizeof(owns));
  const void *expectedVtable = reinterpret_cast<const uint8_t *>(g_provider) +
                               kDxilVtableOffset;
  if (vtable != expectedVtable || type != 2 || owns != 0 || !bytes || size == 0 ||
      size > kSourceCap)
    return false;
  copied = 0;
  if (vm_read_overwrite(mach_task_self(), reinterpret_cast<vm_address_t>(bytes),
                        size, reinterpret_cast<vm_address_t>(snapshot->bytes),
                        &copied) != KERN_SUCCESS || copied != size)
    return false;
  snapshot->size = size;
  return digest(snapshot->bytes, size, snapshot->digest);
}

bool createBorrowedObject(const uint8_t *bytes, size_t size, IRObject **output) {
  if (!bytes || !size || size > UINT32_MAX || !output || !g_provider)
    return false;
  const auto create = reinterpret_cast<CreateDxilObject>(
      reinterpret_cast<uintptr_t>(g_provider) + kProviderCreateDxilOffset);
  IRObject *object = create(reinterpret_cast<const char *>(bytes), size);
  if (!object)
    return false;
  uint8_t header[kDxilObjectHeaderBytes]{};
  vm_size_t copied = 0;
  if (vm_read_overwrite(mach_task_self(), reinterpret_cast<vm_address_t>(object),
                        sizeof(header), reinterpret_cast<vm_address_t>(header),
                        &copied) != KERN_SUCCESS || copied != sizeof(header))
    return false;
  const void *vtable = nullptr;
  const uint8_t *storedBytes = nullptr;
  uint32_t storedSize = 0;
  uint8_t type = 0;
  uint8_t owns = 1;
  std::memcpy(&vtable, header, sizeof(vtable));
  std::memcpy(&storedBytes, header + 0x10, sizeof(storedBytes));
  std::memcpy(&storedSize, header + 0x18, sizeof(storedSize));
  std::memcpy(&type, header + 0x1c, sizeof(type));
  std::memcpy(&owns, header + 0x1d, sizeof(owns));
  if (vtable != reinterpret_cast<const uint8_t *>(g_provider) + kDxilVtableOffset ||
      storedBytes != bytes || storedSize != size || type != 2 || owns != 0)
    return false;
  *output = object;
  return true;
}

bool createPersistentObject(const void *bytes, size_t size, IRObject **output) {
  if (!bytes || !size || size > kAssembledCap || !output)
    return false;
  void *mapping = mmap(nullptr, size, PROT_READ | PROT_WRITE,
                       MAP_PRIVATE | MAP_ANON, -1, 0);
  if (mapping == MAP_FAILED)
    return false;
  std::memcpy(mapping, bytes, size);
  if (mprotect(mapping, size, PROT_READ) != 0 ||
      !createBorrowedObject(static_cast<const uint8_t *>(mapping), size, output)) {
    munmap(mapping, size);
    return false;
  }
  return true; // D3DMetal's IR object borrows this mapping for process lifetime.
}

bool initializeRuntime() {
  if (g_runtimeReady.load(std::memory_order_acquire))
    return true;
  if (g_runtimeAttempted.exchange(true, std::memory_order_acq_rel))
    return false;
  while (g_runtimeLock.test_and_set(std::memory_order_acquire)) {}
  struct Unlock { ~Unlock() { g_runtimeLock.clear(std::memory_order_release); } };
  const char *dxcompilerPath = getenv("YAAGL_ZZZ_RT_SHIM_DXCOMPILER");
  const char *replacementPath = getenv("YAAGL_ZZZ_RT_SHIM_REPLACEMENT");
  if (!dxcompilerPath || !replacementPath || !fileDigestMatches(dxcompilerPath, kDxcompilerSha256))
    return false;
  auto *dxc = new (std::nothrow) yaagl::dxc::Runtime();
  if (!dxc || !dxc->open(dxcompilerPath))
    return false;
  const int fd = open(replacementPath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0)
    return false;
  struct stat status{};
  const bool validSize = fstat(fd, &status) == 0 && S_ISREG(status.st_mode) &&
                         status.st_size == static_cast<off_t>(kExactReplacementBytes);
  void *mapping = validSize ? mmap(nullptr, kExactReplacementBytes, PROT_READ,
                                   MAP_PRIVATE, fd, 0)
                            : MAP_FAILED;
  close(fd);
  uint8_t replacementDigest[32]{};
  IRObject *replacement = nullptr;
  if (mapping == MAP_FAILED || !digest(mapping, kExactReplacementBytes, replacementDigest) ||
      !digestMatches(replacementDigest, kExactReplacementSha256) ||
      !createBorrowedObject(static_cast<const uint8_t *>(mapping),
                            kExactReplacementBytes, &replacement)) {
    if (mapping != MAP_FAILED)
      munmap(mapping, kExactReplacementBytes);
    return false;
  }
  g_dxc = dxc;
  g_exactReplacementBytes = static_cast<const uint8_t *>(mapping);
  g_exactReplacement = replacement;
  g_runtimeReady.store(true, std::memory_order_release);
  return true;
}

IRObject *selectReplacement(const ObjectSnapshot &source) {
  if (!initializeRuntime())
    return nullptr;
  if (source.size == kExactSourceBytes &&
      digestMatches(source.digest, kExactSourceSha256))
    return g_exactReplacement;

  while (g_cacheLock.test_and_set(std::memory_order_acquire)) {}
  struct Unlock { ~Unlock() { g_cacheLock.clear(std::memory_order_release); } };
  for (uint32_t index = 0; index < g_cacheCount; ++index)
    if (g_cache[index].occupied &&
        std::memcmp(g_cache[index].sourceDigest, source.digest, 32) == 0)
      return g_cache[index].object;
  // A source-only no-match/unhandled-FP64 outcome cannot change during the
  // process. Cache it so repeat city shaders do not repeatedly disassemble.
  for (uint32_t index = 0; index < g_negativeCacheCount; ++index)
    if (g_negativeCache[index].occupied &&
        std::memcmp(g_negativeCache[index].sourceDigest, source.digest, 32) == 0)
      return nullptr;
  if (g_cacheCount >= kCacheCap)
    return nullptr;

  try {
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> sourceBlob;
    if (!yaagl::dxc::succeeded(g_dxc->utils()->CreateBlob(
            source.bytes, source.size, yaagl::dxc::kUtf8, sourceBlob.put())) ||
        !sourceBlob)
      return nullptr;
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> disassembly;
    if (!yaagl::dxc::succeeded(g_dxc->compiler()->Disassemble(sourceBlob.get(),
                                                               disassembly.put())) ||
        !disassembly || !disassembly->GetBufferPointer() ||
        !disassembly->GetBufferSize() || disassembly->GetBufferSize() > 1024 * 1024)
      return nullptr;
    std::string transformed;
    const std::string_view llvm(
        static_cast<const char *>(disassembly->GetBufferPointer()),
        disassembly->GetBufferSize());
    const bool injectCache = source.size == kInjectCacheSourceBytes &&
                             digestMatches(source.digest, kInjectCacheSourceSha256);
    const auto result = injectCache
                            ? yaagl::metal_ir::transformKnownInjectCache843Only(llvm, &transformed)
                            : yaagl::metal_ir::transformUnorm24Only(llvm, &transformed);
    if (result.status != yaagl::metal_ir::Unorm24TransformStatus::kSuccess) {
      if ((result.status == yaagl::metal_ir::Unorm24TransformStatus::kNoMatch ||
           result.status == yaagl::metal_ir::Unorm24TransformStatus::kUnhandledFp64) &&
          g_negativeCacheCount < kCacheCap) {
        NegativeCacheEntry &entry = g_negativeCache[g_negativeCacheCount++];
        entry.occupied = true;
        std::memcpy(entry.sourceDigest, source.digest, sizeof(entry.sourceDigest));
      }
      return nullptr;
    }
    if (transformed.empty() || transformed.size() > UINT32_MAX)
      return nullptr;
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> transformedBlob;
    if (!yaagl::dxc::succeeded(g_dxc->utils()->CreateBlob(
            transformed.data(), static_cast<uint32_t>(transformed.size()),
            yaagl::dxc::kUtf8, transformedBlob.put())) || !transformedBlob)
      return nullptr;
    yaagl::dxc::ComPtr<yaagl::dxc::OperationResult> operation;
    if (!yaagl::dxc::succeeded(g_dxc->assembler()->AssembleToContainer(
            transformedBlob.get(), operation.put())) || !operation)
      return nullptr;
    yaagl::dxc::HRESULT status = -1;
    if (!yaagl::dxc::succeeded(operation->GetStatus(&status)) ||
        !yaagl::dxc::succeeded(status))
      return nullptr;
    yaagl::dxc::ComPtr<yaagl::dxc::Blob> output;
    if (!yaagl::dxc::succeeded(operation->GetResult(output.put())) || !output ||
        !output->GetBufferPointer() || !output->GetBufferSize() ||
        output->GetBufferSize() > kAssembledCap)
      return nullptr;
    IRObject *object = nullptr;
    if (!createPersistentObject(output->GetBufferPointer(), output->GetBufferSize(),
                                &object))
      return nullptr;
    CacheEntry &entry = g_cache[g_cacheCount++];
    entry.occupied = true;
    std::memcpy(entry.sourceDigest, source.digest, sizeof(entry.sourceDigest));
    entry.object = object;
    return object;
  } catch (...) {
    return nullptr;
  }
}

extern "C" IRObject *YaaglZzzRtShimCompileAndLink(
    IRCompiler *compiler, const std::vector<std::string> &args,
    const IRObject *object, IRError **sink) {
  CompileAndLink original = g_original.load(std::memory_order_acquire);
  if (!original)
    return nullptr;
  const uintptr_t caller = reinterpret_cast<uintptr_t>(__builtin_return_address(0));
  const uintptr_t base = reinterpret_cast<uintptr_t>(g_d3dmetal);
  const uintptr_t offset = caller >= base ? caller - base : 0;
  if (offset != kCityCompileCallerOffset && offset != kHistoricalRtCompileCallerOffset)
    return original(compiler, args, object, sink);
  g_snapshot = ObjectSnapshot{};
  if (!readObject(object, &g_snapshot))
    return original(compiler, args, object, sink);
  const IRObject *replacement = selectReplacement(g_snapshot);
  return original(compiler, args, replacement ? replacement : object, sink);
}

void tryInstall() {
  if (g_installed.load(std::memory_order_acquire) ||
      g_installLock.test_and_set(std::memory_order_acquire))
    return;
  struct Unlock { ~Unlock() { g_installLock.clear(std::memory_order_release); } };
  const char *d3dmetalPath = getenv("YAAGL_ZZZ_RT_SHIM_D3DMETAL");
  const char *providerPath = getenv("YAAGL_ZZZ_RT_SHIM_PROVIDER");
  if (!d3dmetalPath || !providerPath)
    return;
  for (uint32_t index = 0; index < _dyld_image_count(); ++index) {
    const char *name = _dyld_get_image_name(index);
    if (name && std::strcmp(name, d3dmetalPath) == 0)
      g_d3dmetal = reinterpret_cast<const mach_header_64 *>(_dyld_get_image_header(index));
    if (name && std::strcmp(name, providerPath) == 0)
      g_provider = reinterpret_cast<const mach_header_64 *>(_dyld_get_image_header(index));
  }
  if (!image(g_d3dmetal) || !image(g_provider))
    return;
  auto *slot = reinterpret_cast<CompileAndLink *>(
      reinterpret_cast<uintptr_t>(g_d3dmetal) + kGotOffset);
  CompileAndLink original = reinterpret_cast<CompileAndLink>(
      reinterpret_cast<uintptr_t>(g_provider) + kProviderCompileAndLinkOffset);
  CompileAndLink observed = nullptr;
  __atomic_load(slot, &observed, __ATOMIC_ACQUIRE);
  if (observed != original || !pageProtection(slot, &g_slotProtection) ||
      !setPageProtection(slot, g_slotProtection | VM_PROT_WRITE))
    return;
  // Publish the pass-through before making the wrapper reachable.
  g_original.store(original, std::memory_order_release);
  CompileAndLink wrapper = &YaaglZzzRtShimCompileAndLink;
  const bool installed = __atomic_compare_exchange(slot, &original, &wrapper, false,
                                                    __ATOMIC_ACQ_REL,
                                                    __ATOMIC_ACQUIRE);
  const bool protectedAgain = setPageProtection(slot, g_slotProtection);
  if (!installed || !protectedAgain) {
    if (installed && setPageProtection(slot, g_slotProtection | VM_PROT_WRITE)) {
      CompileAndLink current = wrapper;
      (void)__atomic_compare_exchange(slot, &current, &original, false,
                                      __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
      (void)setPageProtection(slot, g_slotProtection);
    }
    g_original.store(nullptr, std::memory_order_release);
    return;
  }
  g_slot = slot;
  g_installed.store(true, std::memory_order_release);
}

void imageAdded(const mach_header *, intptr_t) { tryInstall(); }

__attribute__((constructor)) void init() {
  const char *mode = getenv("YAAGL_RUNTIME_MODE");
  if (!mode || std::strcmp(mode, kMode) != 0)
    return;
  // Registration invokes imageAdded for already loaded images. The callback
  // performs only image lookup and an atomic GOT swap; DXC is loaded lazily
  // from the compiler call, so CEF/helper processes without D3DMetal remain inert.
  _dyld_register_func_for_add_image(imageAdded);
}

}  // namespace

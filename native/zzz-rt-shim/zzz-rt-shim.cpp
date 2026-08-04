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
#include <memory>
#include <mutex>
#include <new>
#include <string>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

#include "compile-boundary-dispatch.hpp"
#include "decision-cache.hpp"
#include "pinned-sha256.hpp"
#include "../metal-ir-capture/dxc-runtime.hpp"
#include "../metal-ir-capture/translation-synchronization.hpp"
#include "../metal-ir-capture/unorm24-transform.hpp"

struct IRCompiler;
struct IRObject;
struct IRError;
using CompileAndLink = IRObject *(*)(IRCompiler *, const std::vector<std::string> &,
                                     const IRObject *, IRError **);
using CreateDxilObject = IRObject *(*)(const char *, size_t);

namespace {

constexpr const char *kMode = "zzz-rt-shim-v2";
constexpr uintptr_t kGotOffset = 0x4ae1a0;
constexpr uintptr_t kCityCompileCallerOffset = 0x87ec9;
constexpr uintptr_t kHistoricalRtCompileCallerOffset = 0x9a12f;
constexpr uintptr_t kProviderCompileAndLinkOffset = 0x92fe30;
constexpr uintptr_t kProviderCreateDxilOffset = 0x931b40;
constexpr uintptr_t kDxilVtableOffset = 0x14940e0;
constexpr size_t kDxilObjectHeaderBytes = 0x20;
constexpr size_t kSourceCap = 64 * 1024;
constexpr size_t kAssembledCap = 256 * 1024;
constexpr size_t kDecisionCacheCapacity = 1024;
constexpr uint32_t kExactSourceBytes = 26964;
constexpr uint32_t kExactReplacementBytes = 17720;
constexpr uint32_t kInjectCacheSourceBytes = 33228;

struct ObjectHeader {
  const uint8_t *bytes = nullptr;
  uint32_t size = 0;
};
struct ObjectSnapshot {
  const uint8_t *bytes = nullptr;
  uint32_t size = 0;
  uint8_t digest[CC_SHA256_DIGEST_LENGTH]{};
};

std::atomic<CompileAndLink> g_original{nullptr};
std::atomic<bool> g_installed{false};
std::atomic_flag g_installLock = ATOMIC_FLAG_INIT;
yaagl::metal_ir::RuntimeInitializationGate g_exactReplacementInitializer;
yaagl::metal_ir::RuntimeInitializationGate g_dxcInitializer;
std::mutex g_transformMutex;
std::atomic<const mach_header_64 *> g_d3dmetal{nullptr};
std::atomic<const mach_header_64 *> g_provider{nullptr};
CompileAndLink *g_slot = nullptr;
vm_prot_t g_slotProtection = VM_PROT_NONE;
yaagl::dxc::Runtime *g_dxc = nullptr;
const uint8_t *g_exactReplacementBytes = nullptr;
IRObject *g_exactReplacement = nullptr;
yaagl::zzz_rt::DecisionCache<kDecisionCacheCapacity, IRObject *>
    g_decisionCache;
thread_local std::unique_ptr<uint8_t[]> g_snapshotStorage;
thread_local size_t g_snapshotCapacity = 0;
std::string g_d3dmetalPath;
std::string g_providerPath;

enum class CacheLookupStatus {
  kMiss,
  kPositive,
  kNegative,
  kTransientFailure,
};

struct CacheLookupResult {
  CacheLookupStatus status = CacheLookupStatus::kMiss;
  IRObject *object = nullptr;
};

bool image(const mach_header_64 *header) {
  return header && header->magic == MH_MAGIC_64 &&
         header->cputype == CPU_TYPE_X86_64;
}

bool digest(const void *bytes, size_t size, uint8_t output[32]) {
  return bytes && size <= UINT32_MAX &&
         CC_SHA256(bytes, static_cast<CC_LONG>(size), output) != nullptr;
}

bool fileDigestMatches(const char *path,
                       const yaagl::zzz_rt::Sha256Digest &expected) {
  if (!path || !*path)
    return false;
  const int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0)
    return false;
  struct stat status{};
  if (fstat(fd, &status) != 0 || !S_ISREG(status.st_mode) ||
      status.st_size <= 0 || status.st_size > INT32_MAX) {
    close(fd);
    return false;
  }
  const size_t size = static_cast<size_t>(status.st_size);
  const void *mapping = mmap(nullptr, size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);
  uint8_t value[32]{};
  const bool ok = mapping != MAP_FAILED && digest(mapping, size, value) &&
                  yaagl::zzz_rt::sha256Matches(value, expected);
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

bool readObjectHeader(const IRObject *object, ObjectHeader *output) {
  const mach_header_64 *provider =
      g_provider.load(std::memory_order_acquire);
  if (!object || !output || !provider)
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
  const void *expectedVtable = reinterpret_cast<const uint8_t *>(provider) +
                               kDxilVtableOffset;
  if (vtable != expectedVtable || type != 2 || owns != 0 || !bytes || size == 0 ||
      size > kSourceCap)
    return false;
  output->bytes = bytes;
  output->size = size;
  return true;
}

bool snapshotObject(const ObjectHeader &header, ObjectSnapshot *snapshot) {
  if (!snapshot || !header.bytes || header.size == 0 || header.size > kSourceCap)
    return false;
  if (header.size > g_snapshotCapacity) {
    std::unique_ptr<uint8_t[]> expanded(
        new (std::nothrow) uint8_t[header.size]);
    if (!expanded)
      return false;
    g_snapshotStorage = std::move(expanded);
    g_snapshotCapacity = header.size;
  }
  vm_size_t copied = 0;
  if (vm_read_overwrite(
          mach_task_self(), reinterpret_cast<vm_address_t>(header.bytes),
          header.size, reinterpret_cast<vm_address_t>(g_snapshotStorage.get()),
          &copied) != KERN_SUCCESS || copied != header.size)
    return false;
  snapshot->bytes = g_snapshotStorage.get();
  snapshot->size = header.size;
  return digest(snapshot->bytes, snapshot->size, snapshot->digest);
}

bool createBorrowedObject(const uint8_t *bytes, size_t size, IRObject **output) {
  const mach_header_64 *provider =
      g_provider.load(std::memory_order_acquire);
  if (!bytes || !size || size > UINT32_MAX || !output || !provider)
    return false;
  const auto create = reinterpret_cast<CreateDxilObject>(
      reinterpret_cast<uintptr_t>(provider) + kProviderCreateDxilOffset);
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
  if (vtable != reinterpret_cast<const uint8_t *>(provider) + kDxilVtableOffset ||
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

CacheLookupResult lookupCache(const uint8_t sourceDigest[32]) {
  const auto cached = g_decisionCache.lookup(sourceDigest);
  if (cached.kind == yaagl::zzz_rt::DecisionKind::kPositive)
    return {CacheLookupStatus::kPositive, cached.value};
  if (cached.kind == yaagl::zzz_rt::DecisionKind::kNegative)
    return {CacheLookupStatus::kNegative, nullptr};
  return {CacheLookupStatus::kMiss, nullptr};
}

bool initializeExactReplacement() {
  return g_exactReplacementInitializer.ensure([] {
    const char *replacementPath = getenv("YAAGL_ZZZ_RT_SHIM_REPLACEMENT");
    if (!replacementPath)
      return false;
    const int fd = open(replacementPath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0)
      return false;
    struct stat status{};
    bool valid = fstat(fd, &status) == 0 && S_ISREG(status.st_mode) &&
                 status.st_size == static_cast<off_t>(kExactReplacementBytes);
    void *mapping = valid ? mmap(nullptr, kExactReplacementBytes, PROT_READ,
                                 MAP_PRIVATE, fd, 0)
                          : MAP_FAILED;
    if (close(fd) != 0)
      valid = false;

    uint8_t replacementDigest[32]{};
    IRObject *replacement = nullptr;
    if (!valid || mapping == MAP_FAILED ||
        !digest(mapping, kExactReplacementBytes, replacementDigest) ||
        !yaagl::zzz_rt::sha256Matches(
            replacementDigest, yaagl::zzz_rt::kExactReplacementSha256) ||
        !createBorrowedObject(static_cast<const uint8_t *>(mapping),
                              kExactReplacementBytes, &replacement)) {
      if (mapping != MAP_FAILED)
        munmap(mapping, kExactReplacementBytes);
      return false;
    }

    g_exactReplacementBytes = static_cast<const uint8_t *>(mapping);
    g_exactReplacement = replacement;
    return true;
  });
}

bool initializeDxcRuntime() {
  return g_dxcInitializer.ensure([] {
    const char *dxcompilerPath = getenv("YAAGL_ZZZ_RT_SHIM_DXCOMPILER");
    if (!dxcompilerPath ||
        !fileDigestMatches(dxcompilerPath, yaagl::zzz_rt::kDxcompilerSha256))
      return false;
    std::unique_ptr<yaagl::dxc::Runtime> dxc(
        new (std::nothrow) yaagl::dxc::Runtime());
    if (!dxc || !dxc->open(dxcompilerPath))
      return false;
    g_dxc = dxc.release();
    return true;
  });
}

CacheLookupResult transformAndCache(const ObjectSnapshot &source) {
  try {
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> sourceBlob;
    if (!yaagl::dxc::succeeded(g_dxc->utils()->CreateBlob(
            source.bytes, source.size, yaagl::dxc::kUtf8, sourceBlob.put())) ||
        !sourceBlob)
      return {CacheLookupStatus::kTransientFailure, nullptr};
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> disassembly;
    if (!yaagl::dxc::succeeded(g_dxc->compiler()->Disassemble(sourceBlob.get(),
                                                               disassembly.put())) ||
        !disassembly || !disassembly->GetBufferPointer() ||
        !disassembly->GetBufferSize() ||
        disassembly->GetBufferSize() > 1024 * 1024)
      return {CacheLookupStatus::kTransientFailure, nullptr};
    std::string transformed;
    const std::string_view llvm(
        static_cast<const char *>(disassembly->GetBufferPointer()),
        disassembly->GetBufferSize());
    const bool injectCache =
        source.size == kInjectCacheSourceBytes &&
        yaagl::zzz_rt::sha256Matches(
            source.digest, yaagl::zzz_rt::kInjectCacheSourceSha256);
    const auto result = injectCache
                            ? yaagl::metal_ir::transformKnownInjectCache843Only(
                                  llvm, &transformed)
                            : yaagl::metal_ir::transformUnorm24Only(llvm,
                                                                    &transformed);
    if (result.status != yaagl::metal_ir::Unorm24TransformStatus::kSuccess) {
      if (result.status == yaagl::metal_ir::Unorm24TransformStatus::kNoMatch ||
          result.status ==
              yaagl::metal_ir::Unorm24TransformStatus::kUnhandledFp64) {
        (void)g_decisionCache.publishNegative(source.digest);
        return {CacheLookupStatus::kNegative, nullptr};
      }
      return {CacheLookupStatus::kTransientFailure, nullptr};
    }
    if (transformed.empty() || transformed.size() > UINT32_MAX)
      return {CacheLookupStatus::kTransientFailure, nullptr};
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> transformedBlob;
    if (!yaagl::dxc::succeeded(g_dxc->utils()->CreateBlob(
            transformed.data(), static_cast<uint32_t>(transformed.size()),
            yaagl::dxc::kUtf8, transformedBlob.put())) ||
        !transformedBlob)
      return {CacheLookupStatus::kTransientFailure, nullptr};
    yaagl::dxc::ComPtr<yaagl::dxc::OperationResult> operation;
    if (!yaagl::dxc::succeeded(g_dxc->assembler()->AssembleToContainer(
            transformedBlob.get(), operation.put())) ||
        !operation)
      return {CacheLookupStatus::kTransientFailure, nullptr};
    yaagl::dxc::HRESULT status = -1;
    if (!yaagl::dxc::succeeded(operation->GetStatus(&status)) ||
        !yaagl::dxc::succeeded(status))
      return {CacheLookupStatus::kTransientFailure, nullptr};
    yaagl::dxc::ComPtr<yaagl::dxc::Blob> output;
    if (!yaagl::dxc::succeeded(operation->GetResult(output.put())) || !output ||
        !output->GetBufferPointer() || !output->GetBufferSize() ||
        output->GetBufferSize() > kAssembledCap)
      return {CacheLookupStatus::kTransientFailure, nullptr};
    IRObject *object = nullptr;
    if (!createPersistentObject(output->GetBufferPointer(),
                                output->GetBufferSize(), &object))
      return {CacheLookupStatus::kTransientFailure, nullptr};
    // Saturation may prevent memoization, but never changes correctness for
    // the current compile: the freshly transformed object is still returned.
    (void)g_decisionCache.publishPositive(source.digest, object);
    return {CacheLookupStatus::kPositive, object};
  } catch (...) {
    return {CacheLookupStatus::kTransientFailure, nullptr};
  }
}

IRObject *selectExactReplacement(const ObjectSnapshot &source) {
  if (source.size != kExactSourceBytes ||
      !yaagl::zzz_rt::sha256Matches(
          source.digest, yaagl::zzz_rt::kExactSourceSha256) ||
      !initializeExactReplacement())
    return nullptr;
  return g_exactReplacement;
}

IRObject *selectStructuralReplacement(const ObjectSnapshot &source) {
  const CacheLookupResult result = yaagl::metal_ir::lookupOrTransform(
      g_transformMutex, [&] { return lookupCache(source.digest); },
      [](const CacheLookupResult &cached) {
        return cached.status == CacheLookupStatus::kMiss;
      },
      [&] {
        if (!initializeDxcRuntime())
          return CacheLookupResult{CacheLookupStatus::kTransientFailure,
                                   nullptr};
        return transformAndCache(source);
      });
  return result.status == CacheLookupStatus::kPositive ? result.object : nullptr;
}

__attribute__((noinline)) IRObject *compileTarget(
    CompileAndLink original, bool exactCaller, IRCompiler *compiler,
    const std::vector<std::string> &args, const IRObject *object,
    IRError **sink) {
  return yaagl::zzz_rt::submitWithOptionalCorrection(
      [&]() -> const IRObject * {
        ObjectHeader header{};
        if (!readObjectHeader(object, &header))
          return nullptr;
        // The historical RT caller has exactly one proven broken source. All
        // other RT libraries avoid the body copy, SHA, DXC initialization, and
        // cache path.
        if (exactCaller && header.size != kExactSourceBytes)
          return nullptr;
        ObjectSnapshot snapshot{};
        if (!snapshotObject(header, &snapshot))
          return nullptr;
        return exactCaller ? selectExactReplacement(snapshot)
                           : selectStructuralReplacement(snapshot);
      },
      [&](const IRObject *replacement) -> IRObject * {
        // Keep the provider outside the correction recovery boundary. Its
        // failures and exceptions remain authoritative and it runs once.
        return original(compiler, args, replacement ? replacement : object,
                        sink);
      });
}

extern "C" IRObject *YaaglZzzRtShimCompileAndLink(
    IRCompiler *compiler, const std::vector<std::string> &args,
    const IRObject *object, IRError **sink) {
  CompileAndLink original = g_original.load(std::memory_order_acquire);
  if (!original)
    return nullptr;
  const uintptr_t caller =
      reinterpret_cast<uintptr_t>(__builtin_return_address(0));
  const mach_header_64 *d3dmetal =
      g_d3dmetal.load(std::memory_order_acquire);
  const uintptr_t base = reinterpret_cast<uintptr_t>(d3dmetal);
  const uintptr_t offset = caller >= base ? caller - base : 0;
  const bool exactCaller = offset == kHistoricalRtCompileCallerOffset;
  if (!exactCaller && offset != kCityCompileCallerOffset)
    return original(compiler, args, object, sink);
  return compileTarget(original, exactCaller, compiler, args, object, sink);
}

void tryInstall() {
  if (g_installed.load(std::memory_order_acquire) ||
      g_installLock.test_and_set(std::memory_order_acquire))
    return;
  struct Unlock { ~Unlock() { g_installLock.clear(std::memory_order_release); } };
  const mach_header_64 *d3dmetal =
      g_d3dmetal.load(std::memory_order_acquire);
  const mach_header_64 *provider =
      g_provider.load(std::memory_order_acquire);
  if (!image(d3dmetal) || !image(provider))
    return;
  auto *slot = reinterpret_cast<CompileAndLink *>(
      reinterpret_cast<uintptr_t>(d3dmetal) + kGotOffset);
  CompileAndLink original = reinterpret_cast<CompileAndLink>(
      reinterpret_cast<uintptr_t>(provider) + kProviderCompileAndLinkOffset);
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
    bool restored = !installed;
    if (installed && setPageProtection(slot, g_slotProtection | VM_PROT_WRITE)) {
      CompileAndLink current = wrapper;
      restored = __atomic_compare_exchange(slot, &current, &original, false,
                                           __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
      (void)setPageProtection(slot, g_slotProtection);
    }
    // If rollback could not restore the slot, keep the original published so
    // the already-reachable wrapper remains a transparent pass-through.
    if (restored)
      g_original.store(nullptr, std::memory_order_release);
    return;
  }
  g_slot = slot;
  g_installed.store(true, std::memory_order_release);
}

void imageAdded(const mach_header *header, intptr_t) {
  if (!header || g_installed.load(std::memory_order_acquire))
    return;
  Dl_info info{};
  if (dladdr(reinterpret_cast<const void *>(header), &info) == 0 ||
      !info.dli_fname)
    return;
  const auto *imageHeader = reinterpret_cast<const mach_header_64 *>(header);
  if (g_d3dmetalPath == info.dli_fname) {
    const mach_header_64 *expected = nullptr;
    (void)g_d3dmetal.compare_exchange_strong(
        expected, imageHeader, std::memory_order_release,
        std::memory_order_relaxed);
  } else if (g_providerPath == info.dli_fname) {
    const mach_header_64 *expected = nullptr;
    (void)g_provider.compare_exchange_strong(
        expected, imageHeader, std::memory_order_release,
        std::memory_order_relaxed);
  }
  if (g_d3dmetal.load(std::memory_order_acquire) &&
      g_provider.load(std::memory_order_acquire))
    tryInstall();
}

__attribute__((constructor)) void init() {
  const char *mode = getenv("YAAGL_RUNTIME_MODE");
  if (!mode || std::strcmp(mode, kMode) != 0)
    return;
  const char *d3dmetalPath = getenv("YAAGL_ZZZ_RT_SHIM_D3DMETAL");
  const char *providerPath = getenv("YAAGL_ZZZ_RT_SHIM_PROVIDER");
  if (!d3dmetalPath || !*d3dmetalPath || !providerPath || !*providerPath)
    return;
  g_d3dmetalPath = d3dmetalPath;
  g_providerPath = providerPath;
  // Registration invokes imageAdded for already loaded images. Each callback
  // examines only the supplied image, avoiding repeated whole-image scans in
  // Wine helper processes. DXC remains lazy until a structural cache miss.
  _dyld_register_func_for_add_image(imageAdded);
}

}  // namespace

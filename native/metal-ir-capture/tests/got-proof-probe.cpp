#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <fcntl.h>
#include <mach-o/dyld.h>
#include <mach/mach.h>
#include <pthread.h>
#include <string>
#include <unistd.h>
#include <vector>

struct IRCompiler;
struct IRObject;
struct IRError;
using Target = IRObject *(*)(IRCompiler *, const std::vector<std::string> &,
                             const IRObject *, IRError **);

namespace {
std::atomic<Target> g_original{nullptr};
std::atomic<int> g_state{0};
std::atomic<int> g_wrapper_calls{0};
const mach_header *g_consumer = nullptr;
const char *g_consumer_path = nullptr;
const char *g_provider_path = nullptr;
const char *g_failure = nullptr;
uintptr_t g_got_offset = 0;
vm_prot_t g_original_protection = VM_PROT_NONE;
int g_image_pipe[2] = {-1, -1};
int g_log = -1;

void mark(const char *text) {
  if (g_log >= 0) (void)::write(g_log, text, std::strlen(text));
}

bool queryProtection(void *address, vm_prot_t *protection) {
  vm_address_t region = reinterpret_cast<vm_address_t>(address);
  vm_size_t size = 0;
  vm_region_basic_info_data_64_t info{};
  mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
  mach_port_t object = MACH_PORT_NULL;
  if (vm_region_64(mach_task_self(), &region, &size, VM_REGION_BASIC_INFO_64,
                   reinterpret_cast<vm_region_info_t>(&info), &count,
                   &object) != KERN_SUCCESS)
    return false;
  *protection = info.protection;
  return true;
}

bool setProtection(void *address, vm_prot_t protection) {
  const vm_address_t page = reinterpret_cast<vm_address_t>(address) &
                            ~static_cast<vm_address_t>(getpagesize() - 1);
  return vm_protect(mach_task_self(), page, getpagesize(), false, protection) ==
         KERN_SUCCESS;
}

extern "C" IRObject *GotProofReplacement(
    IRCompiler *compiler, const std::vector<std::string> &arguments,
    const IRObject *object, IRError **error) {
  g_wrapper_calls.fetch_add(1, std::memory_order_relaxed);
  return g_original.load(std::memory_order_acquire)(compiler, arguments, object,
                                                     error);
}

bool exactImageForAddress(void *address, const char *expectedPath) {
  Dl_info info{};
  return dladdr(address, &info) && info.dli_fname &&
         std::strcmp(info.dli_fname, expectedPath) == 0;
}

void install() {
  const mach_header *consumer = nullptr;
  for (uint32_t index = 0; index < _dyld_image_count(); ++index) {
    const char *name = _dyld_get_image_name(index);
    if (name && std::strcmp(name, g_consumer_path) == 0)
      consumer = _dyld_get_image_header(index);
  }
  if (!consumer) return;

  void *provider = dlopen(g_provider_path, RTLD_NOW | RTLD_NOLOAD);
  void *expected = provider ? dlsym(provider, "IRCompilerAllocCompileAndLink")
                            : nullptr;
  if (!expected || !exactImageForAddress(expected, g_provider_path)) {
    mark("got-proof exact-export-invalid\n");
    g_state.store(-1, std::memory_order_release);
    return;
  }

  auto *slot = reinterpret_cast<std::atomic<Target> *>(
      reinterpret_cast<uintptr_t>(consumer) + g_got_offset);
  static_assert(std::atomic<Target>::is_always_lock_free);
  if ((reinterpret_cast<uintptr_t>(slot) % alignof(Target)) != 0) {
    mark("got-proof alignment-invalid\n");
    g_state.store(-1, std::memory_order_release);
    return;
  }
  Target expectedTarget = reinterpret_cast<Target>(expected);
  if (slot->load(std::memory_order_acquire) != expectedTarget ||
      expectedTarget == &GotProofReplacement ||
      !queryProtection(slot, &g_original_protection)) {
    mark("got-proof slot-invalid\n");
    g_state.store(-1, std::memory_order_release);
    return;
  }
  if (!setProtection(slot, g_original_protection | VM_PROT_WRITE)) {
    mark("got-proof writable-failed\n");
    g_state.store(-1, std::memory_order_release);
    return;
  }
  if (g_failure && std::strcmp(g_failure, "after-writable") == 0) {
    (void)setProtection(slot, g_original_protection);
    mark("got-proof rollback-after-writable\n");
    g_state.store(-1, std::memory_order_release);
    return;
  }
  g_original.store(expectedTarget, std::memory_order_release);
  if (!slot->compare_exchange_strong(expectedTarget, &GotProofReplacement,
                                     std::memory_order_acq_rel)) {
    (void)setProtection(slot, g_original_protection);
    mark("got-proof cas-failed\n");
    g_state.store(-1, std::memory_order_release);
    return;
  }
  if (g_failure && std::strcmp(g_failure, "after-cas") == 0) {
    Target wrapper = &GotProofReplacement;
    (void)slot->compare_exchange_strong(wrapper, g_original.load(),
                                        std::memory_order_acq_rel);
    (void)setProtection(slot, g_original_protection);
    mark("got-proof rollback-after-cas\n");
    g_state.store(-1, std::memory_order_release);
    return;
  }
  if (!setProtection(slot, g_original_protection)) _exit(124);
  vm_prot_t restored = VM_PROT_NONE;
  if (!queryProtection(slot, &restored) || restored != g_original_protection)
    _exit(125);
  g_consumer = consumer;
  mark("got-proof installed\n");
  g_state.store(1, std::memory_order_release);
}

void *worker(void *) {
  while (g_state.load(std::memory_order_acquire) == 0) {
    char event = 0;
    if (::read(g_image_pipe[0], &event, 1) != 1) continue;
    install();
  }
  return nullptr;
}

void imageAdded(const mach_header *, intptr_t) {
  const char event = 1;
  (void)::write(g_image_pipe[1], &event, 1);
}

__attribute__((constructor)) void initialize() {
  g_consumer_path = std::getenv("YAAGL_GOT_PROOF_CONSUMER");
  g_provider_path = std::getenv("YAAGL_GOT_PROOF_PROVIDER");
  g_failure = std::getenv("YAAGL_GOT_PROOF_FAIL");
  const char *offset = std::getenv("YAAGL_GOT_PROOF_OFFSET");
  const char *logPath = std::getenv("YAAGL_GOT_PROOF_LOG");
  if (!g_consumer_path || !g_provider_path || !offset || !logPath) _exit(120);
  g_got_offset = std::strtoull(offset, nullptr, 0);
  g_log = ::open(logPath, O_WRONLY | O_APPEND | O_CLOEXEC);
  if (pipe(g_image_pipe) != 0) _exit(121);
  pthread_t thread;
  if (pthread_create(&thread, nullptr, worker, nullptr) != 0) _exit(122);
  pthread_detach(thread);
  mark("got-proof loaded\n");
  _dyld_register_func_for_add_image(imageAdded);
}
}  // namespace

extern "C" int GotProofWaitForState() {
  for (int count = 0; count < 500; ++count) {
    const int state = g_state.load(std::memory_order_acquire);
    if (state != 0) return state;
    usleep(1000);
  }
  return 0;
}

extern "C" int GotProofWrapperCalls() {
  return g_wrapper_calls.load(std::memory_order_acquire);
}

extern "C" bool GotProofRollback() {
  if (g_state.load(std::memory_order_acquire) != 1 || !g_consumer) return false;
  auto *slot = reinterpret_cast<std::atomic<Target> *>(
      reinterpret_cast<uintptr_t>(g_consumer) + g_got_offset);
  if (!setProtection(slot, g_original_protection | VM_PROT_WRITE)) return false;
  Target wrapper = &GotProofReplacement;
  const bool restored = slot->compare_exchange_strong(
      wrapper, g_original.load(std::memory_order_acquire),
      std::memory_order_acq_rel);
  const bool protectedAgain = setProtection(slot, g_original_protection);
  vm_prot_t protection = VM_PROT_NONE;
  const bool exactProtection = queryProtection(slot, &protection) &&
                               protection == g_original_protection;
  if (restored && protectedAgain && exactProtection) mark("got-proof restored\n");
  return restored && protectedAgain && exactProtection;
}

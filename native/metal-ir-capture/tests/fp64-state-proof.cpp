#include <atomic>
#include <cstdint>
#include <pthread.h>
#include <stdexcept>
#include <thread>

struct Compiler {
  uint8_t padding[0x99]{};
  uint8_t fp64 = 0;
};

pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
std::atomic<bool> targetEntered{false};
std::atomic<bool> releaseTarget{false};
std::atomic<bool> nonTargetSawDisabled{false};
std::atomic<int> setterCalls{0};
int targetResult;
int nonTargetResult;

void setter(Compiler *compiler, bool enabled) {
  ++setterCalls;
  compiler->fp64 = enabled ? 1 : 0;
}

struct Lock {
  Lock() { pthread_mutex_lock(&mutex); }
  ~Lock() { pthread_mutex_unlock(&mutex); }
};

struct Restore {
  Compiler *compiler;
  uint8_t saved;
  bool active = true;
  void run() {
    if (!active) return;
    setter(compiler, saved != 0);
    active = false;
  }
  ~Restore() { run(); }
};

int *wrapped(Compiler *compiler, bool target, bool throwFromOriginal = false) {
  Lock lock;
  if (!target) {
    nonTargetSawDisabled.store(compiler->fp64 == 0);
    return &nonTargetResult;
  }
  const uint8_t saved = compiler->fp64;
  if (saved != 0) return nullptr;
  setter(compiler, true);
  Restore restore{compiler, saved};
  targetEntered.store(true);
  while (!releaseTarget.load()) std::this_thread::yield();
  if (throwFromOriginal) throw std::runtime_error("synthetic");
  if (compiler->fp64 != 1) return nullptr;
  int *result = &targetResult;
  restore.run();
  return compiler->fp64 == saved ? result : nullptr;
}

int main() {
  Compiler compiler;
  int *target = nullptr;
  int *nonTarget = nullptr;
  std::thread targetThread([&] { target = wrapped(&compiler, true); });
  while (!targetEntered.load()) std::this_thread::yield();
  std::thread nonTargetThread(
      [&] { nonTarget = wrapped(&compiler, false); });
  releaseTarget.store(true);
  targetThread.join();
  nonTargetThread.join();
  if (target != &targetResult || nonTarget != &nonTargetResult ||
      !nonTargetSawDisabled.load() || compiler.fp64 != 0 || setterCalls != 2)
    return 1;

  targetEntered.store(false);
  releaseTarget.store(true);
  try {
    (void)wrapped(&compiler, true, true);
    return 2;
  } catch (const std::runtime_error &) {
  }
  return compiler.fp64 == 0 && setterCalls == 4 ? 0 : 3;
}

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <vector>

struct IRObject;
using CreateObject = IRObject *(*)(const char *, size_t);
using DestroyObject = void (*)(IRObject *);

const mach_header_64 *findImage(const char *path) {
  for (uint32_t index = 0; index < _dyld_image_count(); ++index) {
    const char *name = _dyld_get_image_name(index);
    if (name && std::strcmp(name, path) == 0)
      return reinterpret_cast<const mach_header_64 *>(
          _dyld_get_image_header(index));
  }
  return nullptr;
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  FILE *file = std::fopen(argv[2], "rb");
  if (!file) return 3;
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  std::rewind(file);
  std::vector<uint8_t> bytes(static_cast<size_t>(size));
  const bool read = std::fread(bytes.data(), 1, bytes.size(), file) == bytes.size();
  std::fclose(file);
  if (!read || bytes.size() != 17720) return 4;

  void *handle = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!handle) return 5;
  const mach_header_64 *header = findImage(argv[1]);
  if (!header) return 6;
  auto create = reinterpret_cast<CreateObject>(
      reinterpret_cast<uintptr_t>(header) + 0x931b40);
  auto destroy = reinterpret_cast<DestroyObject>(
      reinterpret_cast<uintptr_t>(header) + 0x931b80);
  IRObject *object =
      create(reinterpret_cast<const char *>(bytes.data()), bytes.size());
  if (!object) return 7;
  const auto *raw = reinterpret_cast<const uint8_t *>(object);
  const void *vtable = nullptr;
  const uint8_t *storedBytes = nullptr;
  uint32_t storedSize = 0;
  std::memcpy(&vtable, raw, sizeof(vtable));
  std::memcpy(&storedBytes, raw + 0x10, sizeof(storedBytes));
  std::memcpy(&storedSize, raw + 0x18, sizeof(storedSize));
  const bool valid =
      vtable == reinterpret_cast<const uint8_t *>(header) + 0x14940e0 &&
      storedBytes == bytes.data() && storedSize == bytes.size() &&
      raw[0x1c] == 2 && raw[0x1d] == 0;
  destroy(object);
  dlclose(handle);
  return valid ? 0 : 8;
}

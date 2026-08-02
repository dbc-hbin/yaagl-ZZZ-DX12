#include <array>
#include <cstdint>
#include <cstdio>
#include <fstream>

namespace {
template <size_t Size>
bool matchesAt(std::ifstream &stream, std::streamoff offset,
               const std::array<uint8_t, Size> &expected) {
  std::array<uint8_t, Size> actual{};
  stream.clear();
  stream.seekg(offset, std::ios::beg);
  stream.read(reinterpret_cast<char *>(actual.data()),
              static_cast<std::streamsize>(actual.size()));
  return stream.good() && actual == expected;
}
}  // namespace

int main(int argc, char **argv) {
  if (argc != 2) {
    std::fprintf(stderr,
                 "usage: rt-output-hook-boundary-proof D3DMetal-binary\n");
    return 2;
  }
  std::ifstream stream(argv[1], std::ios::binary);
  if (!stream)
    return 3;

  constexpr std::streamoff kDispatchOffset = 0x16015b;
  constexpr std::array<uint8_t, 17> kDispatchEntry = {
      0x55, 0x41, 0x57, 0x41, 0x56, 0x41, 0x55, 0x41, 0x54,
      0x53, 0x48, 0x81, 0xec, 0xf8, 0x00, 0x00, 0x00};
  constexpr std::streamoff kComputeConstructorOffset = 0x10ed2c;
  constexpr std::array<uint8_t, 18> kComputeConstructorEntry = {
      0x55, 0x41, 0x57, 0x41, 0x56, 0x41, 0x54, 0x53, 0x48,
      0x83, 0xec, 0x30, 0x49, 0x89, 0xd7, 0x49, 0x89, 0xf6};

  if (!matchesAt(stream, kDispatchOffset, kDispatchEntry)) {
    std::fprintf(stderr, "DispatchRaysIndirect entry bytes changed\n");
    return 4;
  }
  if (!matchesAt(stream, kComputeConstructorOffset,
                 kComputeConstructorEntry)) {
    std::fprintf(stderr, "compute PSO constructor entry bytes changed\n");
    return 5;
  }
  std::puts(
      "rt-output-hook-boundary-proof: dispatch=0x16015b compute=0x10ed2c");
  return 0;
}

#include "../dxc-runtime.hpp"
#include "../unorm24-transform.hpp"

#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

namespace {
std::vector<uint8_t> readFile(const char *path) {
  std::ifstream stream(path, std::ios::binary);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream),
                              std::istreambuf_iterator<char>());
}

bool writeFile(const char *path, const void *data, size_t size) {
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  stream.write(static_cast<const char *>(data),
               static_cast<std::streamsize>(size));
  stream.flush();
  return stream.good();
}

bool hasFp64(std::string_view llvm) {
  return llvm.find("double") != std::string_view::npos ||
         llvm.find(".f64") != std::string_view::npos;
}
}  // namespace

int main(int argc, char **argv) {
  enum class TransformMode { kRoundtrip, kUnorm, kInjectCache };
  TransformMode transformMode = TransformMode::kRoundtrip;
  if (argc == 5 && std::strcmp(argv[4], "--transform-unorm") == 0) {
    transformMode = TransformMode::kUnorm;
  } else if (argc == 5 &&
             std::strcmp(argv[4], "--transform-inject-cache") == 0) {
    transformMode = TransformMode::kInjectCache;
  } else if (argc != 4) {
    std::fprintf(stderr,
                 "usage: dxc-roundtrip-proof libdxcompiler.dylib input.dxil output.dxil [--transform-unorm|--transform-inject-cache]\n");
    return 2;
  }
  const bool transform = transformMode != TransformMode::kRoundtrip;
  const std::vector<uint8_t> input = readFile(argv[2]);
  if (input.empty() || input.size() > UINT32_MAX)
    return 3;

  yaagl::dxc::Runtime runtime;
  if (!runtime.open(argv[1])) {
    std::fprintf(stderr, "failed to initialize DXC runtime\n");
    return 4;
  }

  yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> inputBlob;
  if (!yaagl::dxc::succeeded(runtime.utils()->CreateBlob(
          input.data(), static_cast<uint32_t>(input.size()),
          yaagl::dxc::kUtf8, inputBlob.put())) ||
      !inputBlob) {
    std::fprintf(stderr, "CreateBlob failed\n");
    return 5;
  }

  yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> disassembly;
  if (!yaagl::dxc::succeeded(runtime.compiler()->Disassemble(
          inputBlob.get(), disassembly.put())) ||
      !disassembly || !disassembly->GetBufferPointer() ||
      disassembly->GetBufferSize() == 0) {
    std::fprintf(stderr, "Disassemble failed\n");
    return 6;
  }

  const std::string llvm(
      static_cast<const char *>(disassembly->GetBufferPointer()),
      disassembly->GetBufferSize());
  if (llvm.find("target triple = \"dxil-ms-dx\"") == std::string::npos) {
    std::fprintf(stderr, "DXIL disassembly marker missing\n");
    return 7;
  }
  if (!std::getenv("YAAGL_DXC_PROOF_QUIET")) {
    std::istringstream lines(llvm);
    std::string line;
    while (std::getline(lines, line)) {
      if (line.find("16777215") != std::string::npos ||
          line.find("uitofp") != std::string::npos ||
          line.find("fptrunc") != std::string::npos ||
          line.find(" fdiv ") != std::string::npos ||
          line.find(" fadd ") != std::string::npos)
        std::printf("IR %s\n", line.c_str());
    }
  }

  std::string assemblyText = llvm;
  size_t graphCount = 0;
  if (transform) {
    const auto result =
        transformMode == TransformMode::kInjectCache
            ? yaagl::metal_ir::transformKnownInjectCache843Only(llvm,
                                                                  &assemblyText)
            : yaagl::metal_ir::transformUnorm24Only(llvm, &assemblyText);
    graphCount = result.graph_count;
    if (result.status != yaagl::metal_ir::Unorm24TransformStatus::kSuccess) {
      std::fprintf(stderr, "%s transform rejected status=%u graphs=%zu\n",
                   transformMode == TransformMode::kInjectCache
                       ? "inject-cache"
                       : "unorm",
                   static_cast<unsigned>(result.status), graphCount);
      return 8;
    }
    if (assemblyText.empty() || hasFp64(assemblyText)) {
      std::fprintf(stderr, "%s transform retained FP64\n",
                   transformMode == TransformMode::kInjectCache
                       ? "inject-cache"
                       : "unorm");
      return 9;
    }
  }

  yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> llvmBlob;
  if (!yaagl::dxc::succeeded(runtime.utils()->CreateBlob(
          assemblyText.data(), static_cast<uint32_t>(assemblyText.size()),
          yaagl::dxc::kUtf8, llvmBlob.put())) ||
      !llvmBlob) {
    std::fprintf(stderr, "LLVM CreateBlob failed\n");
    return 10;
  }

  yaagl::dxc::ComPtr<yaagl::dxc::OperationResult> operation;
  if (!yaagl::dxc::succeeded(runtime.assembler()->AssembleToContainer(
          llvmBlob.get(), operation.put())) ||
      !operation) {
    std::fprintf(stderr, "AssembleToContainer failed\n");
    return 11;
  }

  yaagl::dxc::HRESULT status = -1;
  if (!yaagl::dxc::succeeded(operation->GetStatus(&status)) ||
      !yaagl::dxc::succeeded(status)) {
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> errors;
    if (yaagl::dxc::succeeded(operation->GetErrorBuffer(errors.put())) &&
        errors && errors->GetBufferPointer()) {
      std::fwrite(errors->GetBufferPointer(), 1, errors->GetBufferSize(),
                  stderr);
    }
    return 12;
  }

  yaagl::dxc::ComPtr<yaagl::dxc::Blob> output;
  if (!yaagl::dxc::succeeded(operation->GetResult(output.put())) || !output ||
      !output->GetBufferPointer() || output->GetBufferSize() == 0 ||
      !writeFile(argv[3], output->GetBufferPointer(), output->GetBufferSize())) {
    std::fprintf(stderr, "roundtrip output failed\n");
    return 13;
  }

  if (transform) {
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> outputBlob;
    if (!yaagl::dxc::succeeded(runtime.utils()->CreateBlob(
            output->GetBufferPointer(), static_cast<uint32_t>(output->GetBufferSize()),
            yaagl::dxc::kUtf8, outputBlob.put())) ||
        !outputBlob) {
      std::fprintf(stderr, "assembled CreateBlob failed\n");
      return 14;
    }
    yaagl::dxc::ComPtr<yaagl::dxc::BlobEncoding> reassembly;
    if (!yaagl::dxc::succeeded(
            runtime.compiler()->Disassemble(outputBlob.get(), reassembly.put())) ||
        !reassembly || !reassembly->GetBufferPointer() ||
        reassembly->GetBufferSize() == 0) {
      std::fprintf(stderr, "assembled Disassemble failed\n");
      return 15;
    }
    const std::string reassembled(
        static_cast<const char *>(reassembly->GetBufferPointer()),
        reassembly->GetBufferSize());
    if (hasFp64(reassembled)) {
      std::fprintf(stderr, "assembled DXIL retained FP64\n");
      return 16;
    }
  }

  const char *mode = "roundtrip";
  if (transformMode == TransformMode::kUnorm)
    mode = "unorm";
  else if (transformMode == TransformMode::kInjectCache)
    mode = "inject-cache";
  std::printf(
      "dxc-roundtrip-proof: input=%zu llvm=%zu output=%zu mode=%s graphs=%zu residual_fp64=%u\n",
      input.size(), assemblyText.size(), output->GetBufferSize(), mode,
      graphCount, transform ? 0U : hasFp64(llvm) ? 1U : 0U);
  return 0;
}

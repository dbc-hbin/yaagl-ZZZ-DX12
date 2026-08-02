#pragma once

#include <cstddef>
#include <cstdint>
#include <dlfcn.h>

namespace yaagl::dxc {

using HRESULT = int32_t;
using ULONG = uint32_t;
using UINT32 = uint32_t;
using BOOL = int32_t;

constexpr UINT32 kUtf8 = 65001;

inline bool succeeded(HRESULT value) { return value >= 0; }

struct Guid {
  uint32_t data1;
  uint16_t data2;
  uint16_t data3;
  uint8_t data4[8];
};

constexpr Guid kClsidUtils = {
    0x6245d6af, 0x66e0, 0x48fd,
    {0x80, 0xb4, 0x4d, 0x27, 0x17, 0x96, 0x74, 0x8c}};
constexpr Guid kClsidCompiler = {
    0x73e22d93, 0xe6ce, 0x47f3,
    {0xb5, 0xbf, 0xf0, 0x66, 0x4f, 0x39, 0xc1, 0xb0}};
constexpr Guid kClsidAssembler = {
    0xd728db68, 0xf903, 0x4f80,
    {0x94, 0xcd, 0xdc, 0xcf, 0x76, 0xec, 0x71, 0x51}};

constexpr Guid kIidUtils = {
    0x4605c4cb, 0x2019, 0x492a,
    {0xad, 0xa4, 0x65, 0xf2, 0x0b, 0xb7, 0xd6, 0x7f}};
constexpr Guid kIidCompiler = {
    0x8c210bf3, 0x011f, 0x4422,
    {0x8d, 0x70, 0x6f, 0x9a, 0xcb, 0x8d, 0xb6, 0x17}};
constexpr Guid kIidAssembler = {
    0x091f7a26, 0x1c1f, 0x4948,
    {0x90, 0x4b, 0xe6, 0xe3, 0xa8, 0xa7, 0x71, 0xd5}};

struct Unknown {
  virtual HRESULT QueryInterface(const Guid &, void **) = 0;
  virtual ULONG AddRef() = 0;
  virtual ULONG Release() = 0;
};

struct Blob : Unknown {
  virtual void *GetBufferPointer() = 0;
  virtual size_t GetBufferSize() = 0;
};

struct BlobEncoding : Blob {
  virtual HRESULT GetEncoding(BOOL *, UINT32 *) = 0;
};

struct OperationResult : Unknown {
  virtual HRESULT GetStatus(HRESULT *) = 0;
  virtual HRESULT GetResult(Blob **) = 0;
  virtual HRESULT GetErrorBuffer(BlobEncoding **) = 0;
};

// Only the vtable slots used below are typed. The unused declarations preserve
// the published DXC COM slot order without importing a platform-specific SDK.
struct Utils : Unknown {
  virtual HRESULT CreateBlobFromBlob() = 0;
  virtual HRESULT CreateBlobFromPinned() = 0;
  virtual HRESULT MoveToBlob() = 0;
  virtual HRESULT CreateBlob(const void *, UINT32, UINT32, BlobEncoding **) = 0;
};

struct Compiler : Unknown {
  virtual HRESULT Compile() = 0;
  virtual HRESULT Preprocess() = 0;
  virtual HRESULT Disassemble(Blob *, BlobEncoding **) = 0;
};

struct Assembler : Unknown {
  virtual HRESULT AssembleToContainer(Blob *, OperationResult **) = 0;
};

using CreateInstance = HRESULT (*)(const Guid &, const Guid &, void **);

template <typename T> class ComPtr {
 public:
  ComPtr() = default;
  ComPtr(const ComPtr &) = delete;
  ComPtr &operator=(const ComPtr &) = delete;
  ~ComPtr() { reset(); }

  T *get() const { return value_; }
  T **put() {
    reset();
    return &value_;
  }
  T *operator->() const { return value_; }
  explicit operator bool() const { return value_ != nullptr; }
  void reset() {
    if (value_)
      value_->Release();
    value_ = nullptr;
  }

 private:
  T *value_ = nullptr;
};

class Runtime {
 public:
  Runtime() = default;
  Runtime(const Runtime &) = delete;
  Runtime &operator=(const Runtime &) = delete;
  ~Runtime() {
    assembler_.reset();
    compiler_.reset();
    utils_.reset();
    if (module_)
      dlclose(module_);
  }

  bool open(const char *path) {
    if (!path || !*path || module_)
      return false;
    module_ = dlopen(path, RTLD_LOCAL | RTLD_NOW);
    if (!module_)
      return false;
    create_ = reinterpret_cast<CreateInstance>(dlsym(module_, "DxcCreateInstance"));
    if (!create_ || !createObject(kClsidUtils, kIidUtils, utils_.put()) ||
        !createObject(kClsidCompiler, kIidCompiler, compiler_.put()) ||
        !createObject(kClsidAssembler, kIidAssembler, assembler_.put())) {
      assembler_.reset();
      compiler_.reset();
      utils_.reset();
      dlclose(module_);
      module_ = nullptr;
      create_ = nullptr;
      return false;
    }
    return true;
  }

  Utils *utils() const { return utils_.get(); }
  Compiler *compiler() const { return compiler_.get(); }
  Assembler *assembler() const { return assembler_.get(); }

 private:
  template <typename T>
  bool createObject(const Guid &classId, const Guid &interfaceId, T **output) {
    return create_ && output &&
           succeeded(create_(classId, interfaceId,
                             reinterpret_cast<void **>(output))) &&
           *output;
  }

  void *module_ = nullptr;
  CreateInstance create_ = nullptr;
  ComPtr<Utils> utils_;
  ComPtr<Compiler> compiler_;
  ComPtr<Assembler> assembler_;
};

}  // namespace yaagl::dxc

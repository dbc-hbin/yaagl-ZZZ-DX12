#include <windows.h>

#include "dxcapi.h"

#include <cstdio>

namespace {
const GUID kIidDxcUtils = {0x4605c4cb, 0x2019, 0x492a,
                           {0xad, 0xa4, 0x65, 0xf2, 0x0b, 0xb7, 0xd6, 0x7f}};
const GUID kIidDxcAssembler = {
    0x091f7a26,
    0x1c1f,
    0x4948,
    {0x90, 0x4b, 0xe6, 0xe3, 0xa8, 0xa7, 0x71, 0xd5}};

bool readWholeFile(const wchar_t *path, void **data, DWORD *size) {
  HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  LARGE_INTEGER length{};
  if (!GetFileSizeEx(file, &length) || length.QuadPart <= 0 ||
      length.QuadPart > 0xffffffffLL) {
    CloseHandle(file);
    return false;
  }
  *size = static_cast<DWORD>(length.QuadPart);
  *data = HeapAlloc(GetProcessHeap(), 0, *size);
  DWORD read = 0;
  const bool ok = *data && ReadFile(file, *data, *size, &read, nullptr) &&
                  read == *size;
  CloseHandle(file);
  return ok;
}

bool writeWholeFile(const wchar_t *path, const void *data, DWORD size) {
  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool ok = WriteFile(file, data, size, &written, nullptr) &&
                  written == size && FlushFileBuffers(file);
  CloseHandle(file);
  return ok;
}
}  // namespace

int wmain(int argc, wchar_t **argv) {
  if (argc != 4) {
    std::fprintf(stderr, "usage: dxil-assemble dxcompiler.dll input.ll output.dxil\n");
    return 2;
  }
  HMODULE module = LoadLibraryW(argv[1]);
  if (!module) return 3;
  auto create = reinterpret_cast<DxcCreateInstanceProc>(
      GetProcAddress(module, "DxcCreateInstance"));
  if (!create) return 4;

  void *sourceData = nullptr;
  DWORD sourceSize = 0;
  if (!readWholeFile(argv[2], &sourceData, &sourceSize)) return 5;

  IDxcUtils *utils = nullptr;
  IDxcAssembler *assembler = nullptr;
  IDxcBlobEncoding *source = nullptr;
  IDxcOperationResult *operation = nullptr;
  IDxcBlob *result = nullptr;
  IDxcBlobEncoding *errors = nullptr;
  HRESULT status = E_FAIL;
  int exitCode = 6;

  if (FAILED(create(CLSID_DxcUtils, kIidDxcUtils,
                    reinterpret_cast<void **>(&utils))) ||
      FAILED(create(CLSID_DxcAssembler, kIidDxcAssembler,
                    reinterpret_cast<void **>(&assembler))) ||
      FAILED(utils->CreateBlob(sourceData, sourceSize, DXC_CP_UTF8, &source)) ||
      FAILED(assembler->AssembleToContainer(source, &operation)) ||
      FAILED(operation->GetStatus(&status)))
    goto cleanup;

  if (FAILED(status)) {
    if (SUCCEEDED(operation->GetErrorBuffer(&errors)) && errors)
      std::fwrite(errors->GetBufferPointer(), 1, errors->GetBufferSize(), stderr);
    exitCode = 7;
    goto cleanup;
  }
  if (FAILED(operation->GetResult(&result)) || !result ||
      result->GetBufferSize() > 0xffffffffULL ||
      !writeWholeFile(argv[3], result->GetBufferPointer(),
                      static_cast<DWORD>(result->GetBufferSize()))) {
    exitCode = 8;
    goto cleanup;
  }
  exitCode = 0;

cleanup:
  if (errors) errors->Release();
  if (result) result->Release();
  if (operation) operation->Release();
  if (source) source->Release();
  if (assembler) assembler->Release();
  if (utils) utils->Release();
  if (sourceData) HeapFree(GetProcessHeap(), 0, sourceData);
  FreeLibrary(module);
  return exitCode;
}

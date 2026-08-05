#include <d3d12.h>
#include <dxgi1_6.h>
#include <windows.h>

#include <cstdio>
#include <cwchar>

int main() {
  IDXGIFactory1* factory = nullptr;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return 2;
  IDXGIAdapter1* adapter = nullptr;
  if (factory->EnumAdapters1(0, &adapter) == DXGI_ERROR_NOT_FOUND) return 3;
  DXGI_ADAPTER_DESC1 desc = {};
  if (FAILED(adapter->GetDesc1(&desc))) return 4;
  std::printf("vendor=0x%04lx device=0x%04lx\n",
              static_cast<unsigned long>(desc.VendorId),
              static_cast<unsigned long>(desc.DeviceId));
  std::wprintf(L"description=%ls\n", desc.Description);
  ID3D12Device* device = nullptr;
  const HRESULT result = D3D12CreateDevice(
      adapter, D3D_FEATURE_LEVEL_12_0, IID_PPV_ARGS(&device));
  std::printf("d3d12_device=%s hresult=0x%08lx\n",
              SUCCEEDED(result) ? "success" : "failure",
              static_cast<unsigned long>(result));
  if (device) {
    D3D12_FEATURE_DATA_D3D12_OPTIONS5 options5 = {};
    const HRESULT featureResult = device->CheckFeatureSupport(
        D3D12_FEATURE_D3D12_OPTIONS5, &options5, sizeof(options5));
    std::printf("raytracing_tier=%u feature_hresult=0x%08lx\n",
                static_cast<unsigned int>(options5.RaytracingTier),
                static_cast<unsigned long>(featureResult));
  }
  if (device) device->Release();
  adapter->Release();
  factory->Release();
  return SUCCEEDED(result) ? 0 : 5;
}

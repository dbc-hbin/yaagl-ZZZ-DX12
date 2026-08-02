export const GPTK_RUNTIME_VERSION = "4.0b2" as const;
export const GPTK_D3DMETAL_VERSION = "4.0b2" as const;
export const GPTK_MANIFEST_SCHEMA_VERSION = 1 as const;
export const GPTK_MANIFEST_FILENAME = "gptk-runtime-manifest.json" as const;

export const GPTK_SOURCE_LIBRARY_DIRECTORY = "redist/lib" as const;
export const GPTK_CACHED_LIBRARY_DIRECTORY = "lib" as const;

export const GPTK_D3DMETAL_FRAMEWORK = "external/D3DMetal.framework" as const;
export const GPTK_D3DMETAL_INFO_PLIST =
  "external/D3DMetal.framework/Resources/Info.plist" as const;

/** Paths relative to GPTK's redist/lib directory. */
export const GPTK_REQUIRED_RUNTIME_FILES = [
  "external/D3DMetal.framework/D3DMetal",
  "external/libd3dshared.dylib",
  "wine/x86_64-unix/d3d10.so",
  "wine/x86_64-windows/d3d10.dll",
  "wine/x86_64-unix/d3d11.so",
  "wine/x86_64-windows/d3d11.dll",
  "wine/x86_64-unix/d3d12.so",
  "wine/x86_64-windows/d3d12.dll",
  "wine/x86_64-unix/dxgi.so",
  "wine/x86_64-windows/dxgi.dll",
  "wine/x86_64-unix/nvapi64.so",
  "wine/x86_64-windows/nvapi64.dll",
  "wine/x86_64-unix/nvngx-on-metalfx.so",
  "wine/x86_64-windows/nvngx-on-metalfx.dll",
] as const;

export const GPTK_REQUIRED_DOCUMENTS = ["License.rtf"] as const;
export const GPTK_OPTIONAL_DOCUMENTS = ["Acknowledgements.rtf"] as const;

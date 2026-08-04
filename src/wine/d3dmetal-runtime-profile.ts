export type D3DMetalRuntimeProfile = "play" | "diagnostic";

export const D3DMETAL_RUNTIME_PROFILE: D3DMetalRuntimeProfile = "play";

export function d3dMetalRuntimeDiagnosticsEnabled(
  profile: D3DMetalRuntimeProfile = D3DMETAL_RUNTIME_PROFILE
) {
  return profile === "diagnostic";
}

export function d3dMetalWineDebug(
  profile: D3DMetalRuntimeProfile = D3DMETAL_RUNTIME_PROFILE
) {
  return profile === "diagnostic"
    ? "fixme-all,err-unwind,+timestamp,+loaddll"
    : "-all";
}

export function d3dMetalConfiguredStatus(
  configured: boolean,
  profile: D3DMetalRuntimeProfile = D3DMETAL_RUNTIME_PROFILE
) {
  if (!configured) return "disabled";
  return profile === "diagnostic"
    ? "enabled - verification pending"
    : "enabled - runtime diagnostics disabled";
}

import { describe, expect, it } from "vitest";
import {
  D3DMETAL_RUNTIME_PROFILE,
  d3dMetalConfiguredStatus,
  d3dMetalRuntimeDiagnosticsEnabled,
  d3dMetalWineDebug,
} from "./d3dmetal-runtime-profile";

describe("minimal D3DMetal runtime profile", () => {
  it("keeps runtime diagnostics and Wine debug output off in play", () => {
    expect(D3DMETAL_RUNTIME_PROFILE).toBe("play");
    expect(d3dMetalRuntimeDiagnosticsEnabled()).toBe(false);
    expect(d3dMetalWineDebug()).toBe("-all");
  });

  it("does not present stale runtime evidence as current verification", () => {
    expect(d3dMetalConfiguredStatus(true)).toBe(
      "enabled - runtime diagnostics disabled"
    );
    expect(d3dMetalConfiguredStatus(false)).toBe("disabled");
  });

  it("preserves the full diagnostic profile contract", () => {
    expect(d3dMetalRuntimeDiagnosticsEnabled("diagnostic")).toBe(true);
    expect(d3dMetalWineDebug("diagnostic")).toBe(
      "fixme-all,err-unwind,+timestamp,+loaddll"
    );
    expect(d3dMetalConfiguredStatus(true, "diagnostic")).toBe(
      "enabled - verification pending"
    );
  });
});

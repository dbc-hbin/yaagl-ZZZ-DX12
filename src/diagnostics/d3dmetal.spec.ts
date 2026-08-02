import { describe, expect, it } from "vitest";
import {
  analyzeD3DMetalRuntimeEvidence,
  createD3DMetalDxrRuntimeStatus,
  createD3DMetalMetalFxRuntimeStatus,
  createD3DMetalMtl4RuntimeStatus,
  createD3DMetalDiagnosticEnvironment,
  createD3DMetalDiagnosticPaths,
  createZzzPlayerLogPath,
  D3DMETAL_SYSTEM_LOG_PREDICATE,
  D3DMetalLaunchProfile,
  findLatestD3DMetalEvidenceFile,
  findD3DMetalGameProcessIds,
  isFreshD3DMetalPlayerLog,
  parseD3DMetalDxrCapability,
  parseD3DMetalDxrPipelineDiagnostics,
  parseD3DMetalMetalIrProbe,
  parseD3DMetalSelectedRenderer,
  parseD3DMetalMetalIrInstanceMarkers,
  aggregateD3DMetalMetalIrManifests,
  settleD3DMetalMetalIrAggregation,
  validateD3DMetalMetalIrPayload,
  validateD3DMetalDxilContainer,
  waitForD3DMetalCaptureAcknowledgement,
  startD3DMetalCaptureWithAckGate,
  terminateAndConfirmProcess,
  findAuthoritativeD3DMetalGameCandidates,
  parseD3DMetalProcessIdentity,
  equalD3DMetalProcessIdentity,
  parseD3DMetalLsofFields,
  validateD3DMetalExpectedVnode,
  preflightD3DMetalExpectedVnode,
  hasD3DMetalRequiredArtifacts,
  hasD3DMetalRuntimeModules,
  terminateAndConfirmD3DMetalWineTree,
} from "./d3dmetal";

const launchProfile: D3DMetalLaunchProfile = {
  createdAt: "2026-07-31T00:00:00.000Z",
  wineTag: "11.0-1-crossover-signed-experimental",
  d3dMetalVersion: "4.0b2",
  launchProgram: "C:\\windows\\system32\\steam.exe",
  gameExecutable: "Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe",
  arguments: [
    "Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe",
    "-use-d3d12",
  ],
  environment: {
    WINE_ENABLE_TIMEOUT_FIX: "1",
    WINEMSYNC: "1",
    CX_ACTIVE_GRAPHICS_BACKEND: "d3dmetal",
    D3DM_MTL4: "1",
    D3DM_ENABLE_METALFX: "1",
    D3DM_SUPPORT_DXR: "1",
    D3DM_VENDOR_ID: "0x10de",
    D3DM_DEVICE_ID: "0x2882",
    D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 4060",
  },
  launchExitCode: 0,
  metalIrTerminalStatus: "complete",
};

const d3d12PlayerLog = `Forcing GfxDevice: Direct3D 12
d3d12: loaded!
Direct3D:
    Version:         Direct3D 12 [level 12.1]
    supportsRayTracing = 1
There are more uavs on D3D11.0. This is only a shader capability warning.`;

describe("D3DMetal diagnostic paths", () => {
  it("collects the actual D3DMetal and Metal compiler unified-log sources", () => {
    expect(D3DMETAL_SYSTEM_LOG_PREDICATE).toContain('subsystem == "D3DMetal"');
    expect(D3DMETAL_SYSTEM_LOG_PREDICATE).toContain(
      'subsystem == "MetalIRConverter"'
    );
    expect(D3DMETAL_SYSTEM_LOG_PREDICATE).toContain(
      'eventMessage CONTAINS[c] "D3D12_PIPELINE_STATE_SUBOBJECT_TYPE"'
    );
    expect(D3DMETAL_SYSTEM_LOG_PREDICATE).not.toContain(
      'subsystem == "com.apple.D3DMetal"'
    );
  });

  it("groups a launch's evidence under one timestamp", () => {
    expect(createD3DMetalDiagnosticPaths("/tmp/logs", 123)).toEqual({
      wineLog: "/tmp/logs/d3dmetal_123_wine.log",
      systemLog: "/tmp/logs/d3dmetal_123_system.log",
      playerLog: "/tmp/logs/d3dmetal_123_player.log",
      moduleSnapshot: "/tmp/logs/d3dmetal_123_modules.log",
      metalIrProbe: "/tmp/logs/d3dmetal_123_metal_ir_probe.log",
      metalIrManifest: "/tmp/logs/d3dmetal_123_metal_ir_manifest.json",
      metalIrAggregateManifest:
        "/tmp/logs/d3dmetal_123_metal_ir_aggregate_manifest.json",
      metalIrSessionRoot: "/tmp/logs/d3dmetal_123_metal_ir_session",
      metalIrDxil: "/tmp/logs/d3dmetal_123_fp64.dxil",
      profile: "/tmp/logs/d3dmetal_123_profile.json",
      evidence: "/tmp/logs/d3dmetal_123_evidence.json",
    });
    expect(createZzzPlayerLogPath("/tmp/prefix")).toBe(
      "/tmp/prefix/drive_c/users/crossover/AppData/LocalLow/miHoYo/ZenlessZoneZero/Player.log"
    );
  });

  it("omits proxy URLs and unrelated secrets from launch evidence", () => {
    expect(
      createD3DMetalDiagnosticEnvironment({
        WINE_ENABLE_TIMEOUT_FIX: "1",
        WINEMSYNC: "1",
        CX_ACTIVE_GRAPHICS_BACKEND: "d3dmetal",
        D3DM_MTL4: "1",
        D3DM_ENABLE_METALFX: "1",
        D3DM_SUPPORT_DXR: "1",
        D3DM_VENDOR_ID: "0x10de",
        D3DM_DEVICE_ID: "0x2882",
        D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 4060",
        HTTP_PROXY: "http://user:password@example.invalid:8080",
        HTTPS_PROXY: "http://user:password@example.invalid:8080",
        UNRELATED_SECRET: "secret",
        YAAGL_RUNTIME_MODE: "metal-ir-probe-v1",
      })
    ).toEqual({
      WINE_ENABLE_TIMEOUT_FIX: "1",
      WINEMSYNC: "1",
      CX_ACTIVE_GRAPHICS_BACKEND: "d3dmetal",
      D3DM_MTL4: "1",
      D3DM_ENABLE_METALFX: "1",
      D3DM_SUPPORT_DXR: "1",
      D3DM_VENDOR_ID: "0x10de",
      D3DM_DEVICE_ID: "0x2882",
      D3DM_DEVICE_DESCRIPTION: "NVIDIA GeForce RTX 4060",
      YAAGL_RUNTIME_MODE: "metal-ir-probe-v1",
    });
  });

  it("distinguishes probe reachability from resolver failure", () => {
    const functional = parseD3DMetalMetalIrProbe(`probe loaded mode=metal-ir-unorm-fix-v2-rt
probe resolved=0x1234
probe installed got=0x4ae1a0 mode=metal-ir-unorm-fix-v2-rt rt_output=installed compute_correlation=installed
probe observation sequence=0 size=26964 selected=replacement export=complete
probe target-entry caller=D3DMetal offset=0x87ec9 sink=non-null
probe target-result=0x1234
probe replacement-compile-succeeded`);
    expect(functional).toMatchObject({
      loaded: true,
      resolved: true,
      installed: true,
      targetEntered: true,
      resultObserved: true,
      resolverFailed: false,
    });
    expect(
      functional.evidence.some(line =>
        line.startsWith("probe observation sequence=0")
      )
    ).toBe(true);
    expect(
      parseD3DMetalMetalIrProbe(
        "probe loaded mode=metal-ir-probe-v1\nprobe resolver-invalid exit=126"
      )
    ).toMatchObject({
      loaded: true,
      resolved: false,
      installed: false,
      targetEntered: false,
      resultObserved: false,
      resolverFailed: true,
    });
  });

  it("recognizes the observation-only compiler and RT-output sidecar", () => {
    const observer = parseD3DMetalMetalIrProbe(`observer loaded mode=metal-ir-observe-v1
observer resolved=0x1234
observer rt-output installed target=0x16015b body_end=0x1607be method_hooks=8
observer installed got=0x4ae1a0 mode=metal-ir-observe-v1 rt_output=installed
observer compile sequence=0 time_ns=123 tid=7 caller=0x87ec9 context=compute stage=compute size=64 sha256=${"a".repeat(
      64
    )} capture=none result=returned_null error=0x13 error_status=code sink=non-null export=complete path=/tmp/source.dxil stack=0x87ec9`);
    expect(observer).toMatchObject({
      loaded: true,
      resolved: true,
      installed: true,
      targetEntered: true,
      resultObserved: true,
      resolverFailed: false,
      errorCode: "0x13",
    });
  });

  it("distinguishes an MTL4 request from the activated backend", () => {
    const base = {
      wineLog: "Loaded d3d12.dll",
      systemLog: "",
      playerLog: d3d12PlayerLog,
      moduleSnapshot:
        "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
      launchProfile,
      validatedD3DMetalVersion: "4.0b2",
    };
    expect(analyzeD3DMetalRuntimeEvidence(base)).toMatchObject({
      mtl4Configured: true,
      mtl4BackendEnabled: false,
      mtl4Evidence: [],
    });
    expect(
      analyzeD3DMetalRuntimeEvidence({
        ...base,
        wineLog: "Loaded d3d12.dll\nEnabled MTL4 backend - options=1",
      })
    ).toMatchObject({
      mtl4Configured: true,
      mtl4BackendEnabled: true,
      mtl4Evidence: ["Enabled MTL4 backend - options=1"],
    });
  });

  it("marks passive capture as diagnostic-only evidence", () => {
    const evidence = analyzeD3DMetalRuntimeEvidence({
      wineLog: "",
      systemLog: "",
      playerLog: "",
      moduleSnapshot: "",
      launchProfile: {
        ...launchProfile,
        metalIrProbe: {
          mode: "metal-ir-capture-v2",
          passive: true,
          capturePath: "/tmp/capture.log",
          captureHash: "a".repeat(64),
          manifestPath: "/tmp/capture-manifest.json",
          runId: "run-123",
          sourceRevision: "rev-abc",
          buildIdentity: "build-xyz",
        },
      },
      validatedD3DMetalVersion: undefined,
    });
    expect(evidence).toMatchObject({
      metalIrMode: "metal-ir-capture-v2",
      metalIrPassive: true,
      metalIrDiagnosticOnly: true,
      metalIrCapturePath: "/tmp/capture.log",
      metalIrCaptureHash: "a".repeat(64),
      metalIrManifestPath: "/tmp/capture-manifest.json",
      metalIrRunId: "run-123",
      metalIrSourceRevision: "rev-abc",
      metalIrBuildIdentity: "build-xyz",
    });
  });

  it("requires terminal_status=complete and exit code zero for diagnostic pass", () => {
    const base = {
      wineLog: "",
      systemLog: "",
      playerLog: "",
      moduleSnapshot: "",
      launchProfile: {
        ...launchProfile,
        metalIrProbe: {
          mode: "metal-ir-capture-v2" as const,
          passive: true,
          capturePath: "/tmp/capture.log",
          captureHash: "a".repeat(64),
          manifestPath: "/tmp/capture-manifest.json",
        },
        metalIrAggregation: {
          lifecycleValid: true,
          sessionComplete: true,
          targetObserved: true,
          payloadValid: true,
          payloadParseable: true,
          finalEvidenceReady: true,
          visualStatus: "unverified" as const,
          analysisReady: true,
          instances: [],
          manifests: [],
          records: [],
          reason: null,
        },
      },
      validatedD3DMetalVersion: undefined,
    };
    expect(analyzeD3DMetalRuntimeEvidence(base).metalIrDiagnosticPass).toBe(
      true
    );
    expect(
      analyzeD3DMetalRuntimeEvidence({
        ...base,
        launchProfile: {
          ...base.launchProfile,
          launchExitCode: 0,
          metalIrTerminalStatus: "incomplete",
          metalIrAggregation: {
            ...base.launchProfile.metalIrAggregation!,
            analysisReady: false,
          },
        },
      }).metalIrDiagnosticPass
    ).toBe(false);
    expect(
      analyzeD3DMetalRuntimeEvidence({
        ...base,
        launchProfile: {
          ...base.launchProfile,
          launchExitCode: 1,
          metalIrTerminalStatus: "unavailable",
          metalIrAggregation: {
            ...base.launchProfile.metalIrAggregation!,
            analysisReady: false,
          },
        },
      }).metalIrDiagnosticPass
    ).toBe(false);
  });

  it("uses Player.log as the authoritative renderer despite incidental modules", () => {
    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog:
          "trace:loaddll: Loaded d3d12.dll, d3d11.dll, nvngx.dll; [mvk-info] MoltenVK",
        systemLog: "D3DMetal diagnostics header",
        playerLog: d3d12PlayerLog,
        moduleSnapshot:
          "/tmp/D3DMetal.framework/Versions/A/D3DMetal C:\\windows\\system32\\d3d12.dll",
        launchProfile,
        validatedD3DMetalVersion: "4.0b2",
        createdAt: "2026-07-31T00:00:00.000Z",
      })
    ).toMatchObject({
      selectedRenderer: "d3d12",
      backendVerified: true,
      metalFxVerified: false,
      dxrCapability: "supported",
      dxrVerified: true,
      verified: false,
      observations: { d3d11: true, moltenVk: true },
    });
  });

  it("requires an unambiguous startup-time DXR capability report", () => {
    expect(parseD3DMetalDxrCapability("    supportsRayTracing = 1")).toEqual({
      capability: "supported",
      evidence: ["supportsRayTracing = 1"],
    });
    expect(parseD3DMetalDxrCapability("supportsRayTracing = 0")).toEqual({
      capability: "unsupported",
      evidence: ["supportsRayTracing = 0"],
    });
    expect(parseD3DMetalDxrCapability("ordinary Unity output")).toEqual({
      capability: "missing",
      evidence: [],
    });
    expect(
      parseD3DMetalDxrCapability(
        "supportsRayTracing = 0\nsupportsRayTracing = 1"
      )
    ).toEqual({
      capability: "conflict",
      evidence: ["supportsRayTracing = 0", "supportsRayTracing = 1"],
    });

    const base = {
      wineLog: "Loaded d3d12.dll",
      systemLog: "",
      moduleSnapshot:
        "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
      launchProfile,
      validatedD3DMetalVersion: "4.0b2",
    };
    expect(
      analyzeD3DMetalRuntimeEvidence({
        ...base,
        playerLog: d3d12PlayerLog.replace(
          "supportsRayTracing = 1",
          "supportsRayTracing = 0"
        ),
      })
    ).toMatchObject({
      backendVerified: true,
      dxrCapability: "unsupported",
      dxrVerified: false,
    });
    expect(
      analyzeD3DMetalRuntimeEvidence({
        ...base,
        playerLog: d3d12PlayerLog.replace("    supportsRayTracing = 1\n", ""),
      })
    ).toMatchObject({
      backendVerified: true,
      dxrCapability: "missing",
      dxrVerified: false,
    });
  });

  it("separates DXR capability from RTXGI state-object failures", () => {
    const diagnostics = parseD3DMetalDxrPipelineDiagnostics(`
d3d12: could not create a Ray Tracing Pipeline State Object (0x80070057)
d3d12: could not create a Ray Tracing Pipeline State Object (0x80070057)
d3d12: Dispatching Ray Tracing Shader "RTXGI" failed. Invalid Ray Tracing State Object.
wine [D3DMetal:] Failed to compile stage Compute - error:19, <private>
wine [D3DMetal:] Failed to compile stage Fragment - error:19, <private>
wine [MetalIRConverter:] FP64Usage : Unhandled FP64 usage
wine [D3DMetal:] Failed to compile a pipeline, marking PSO(421) as no-op
wine [D3DMetal:] Failed to compile a pipeline, marking PSO(531) as no-op
wine [D3DMetal:] Unsupported D3D12_PIPELINE_STATE_SUBOBJECT_TYPE 14
`);
    expect(diagnostics).toEqual({
      rayTracingPsoFailureCount: 2,
      rtxgiInvalidStateObjectCount: 1,
      createStateObjectFailureCount: 0,
      hresultCounts: { "0x80070057": 2 },
      stateObjectFailureStage: null,
      stateObjectFailureTagCounts: {},
      metalCompileFailureCount: 2,
      metalCompileFailuresByStage: { compute: 1, fragment: 1 },
      metalCompileError19Count: 2,
      metalIrUnhandledFp64Count: 1,
      metalIrCompileObservations: [],
      metalIrError19Correlations: [],
      metalIrError19CorrelationComplete: false,
      metalIrError19UnmatchedObserverCount: 0,
      metalIrError19UnmatchedSystemCount: 2,
      noOpPsoCount: 2,
      noOpPsoIds: [421, 531],
      rtOutputInstalled: false,
      rtOutputValid: false,
      rtOutputInvalidReasons: [
        "observer-not-installed",
        "dispatch-incomplete",
        "dispatch-dimensions-missing",
        "dispatch-path-missing",
        "resource-identifiers-missing",
        "resource-state-missing",
        "output-resource-missing",
        "barrier-missing",
      ],
      rtOutputDispatchCount: 0,
      rtOutputCompleteDispatchCount: 0,
      rtOutputPaths: [],
      rtOutputResourceEventCount: 0,
      rtOutputWriteResourceEventCount: 0,
      rtOutputBarrierEventCount: 0,
      rtOutputEvidence: [],
      rejectedSubobject: "14",
      rejectedSubobjectEvidence: [
        "wine [D3DMetal:] Unsupported D3D12_PIPELINE_STATE_SUBOBJECT_TYPE 14",
      ],
      firstFailure:
        "d3d12: could not create a Ray Tracing Pipeline State Object (0x80070057)",
    });

    const evidence = analyzeD3DMetalRuntimeEvidence({
      wineLog: "Loaded d3d12.dll",
      systemLog: "",
      playerLog: `${d3d12PlayerLog}\nd3d12: could not create a Ray Tracing Pipeline State Object (0x80070057)\nd3d12: Dispatching Ray Tracing Shader "RTXGI" failed. Invalid Ray Tracing State Object.`,
      moduleSnapshot:
        "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
      launchProfile,
      validatedD3DMetalVersion: "4.0b2",
    });
    expect(evidence).toMatchObject({
      dxrCapability: "supported",
      dxrVerified: true,
      dxrPipelineFailed: true,
      dxrPipelineDiagnostics: {
        rayTracingPsoFailureCount: 1,
        rtxgiInvalidStateObjectCount: 1,
        rejectedSubobject: null,
      },
    });
  });

  it("correlates exact error-19 shaders, fragment no-op PSOs, and RT output", () => {
    const computeSha = "a".repeat(64);
    const fragmentSha = "b".repeat(64);
    const diagnostics = parseD3DMetalDxrPipelineDiagnostics(`
observer rt-output installed target=0x16015b body_end=0x1607be method_hooks=12
observer compile sequence=0 time_ns=100 tid=7 caller=0x87ec9 context=compute stage=compute size=111 sha256=${computeSha} capture=none result=returned_null error=0x13 error_status=code sink=non-null export=complete path=/tmp/Application Support/compute.dxil pso_object=0xabc pso_id=771 selection=original selection_reason=unhandled_fp64 stack=0x87ec9,0x86e90
wine [D3DMetal:] Failed to compile stage Compute - error:19, <private>
observer compile sequence=1 time_ns=101 tid=8 caller=0x87ec9 context=graphics stage=fragment size=222 sha256=${fragmentSha} capture=none result=returned_null error=0x13 error_status=code sink=non-null export=complete path=/tmp/fragment.dxil pso_object=none pso_id=none selection=original selection_reason=unhandled_fp64 stack=0x87ec9,0x891aa
wine [D3DMetal:] Failed to compile stage Fragment - error:19, <private>
wine [D3DMetal:] Failed to compile a pipeline, marking PSO(429) as no-op
observer rt-output sequence=0 time_ns=200 tid=9 encoder=0x1 event=begin caller=0x16015b records=3 flags=1 indirect_buffer=0x2 indirect_offset=64
observer rt-output sequence=0 time_ns=201 tid=9 encoder=0x1 event=set-bytes index=3 length=48 checksum=0x1 word0=0x10 word1=0x20 word2=0x30 word3=0x40 word4=0x50 word5=0x60 argument_block=rt-dispatch argument_id0=0x40 argument_id1=0x60
observer rt-output sequence=0 time_ns=202 tid=9 encoder=0x1 event=dispatch-argument-buffer resource=0x2 kind=buffer usage=0x3 index=0 offset=64 format=0 extent=0x0x0 length=4096 gpu_address=0x1000 gpu_resource_id=0x20 resource_id=0x21 declared_usage=0x3 storage=2 hazard=1 options=0x20 state=read_write role=output_candidate state_source=metal_usage
observer rt-output sequence=0 time_ns=203 tid=9 encoder=0x1 event=dispatch-indirect mode=per-record-indirect offset=64 groups=16x8x1 groups_source=buffer_contents threads_per_group=8x8x1
observer rt-output sequence=0 time_ns=204 tid=9 encoder=0x1 event=memory-barrier scope=0x1
observer rt-output sequence=0 time_ns=205 tid=9 encoder=0x1 event=end path=direct dispatches=1 resources=1 barriers=1 internal_barrier_src=4 internal_barrier_dst=4
`);
    expect(diagnostics).toMatchObject({
      metalCompileError19Count: 2,
      metalIrError19CorrelationComplete: true,
      metalIrError19UnmatchedObserverCount: 0,
      metalIrError19UnmatchedSystemCount: 0,
      rtOutputInstalled: true,
      rtOutputValid: true,
      rtOutputInvalidReasons: [],
      rtOutputDispatchCount: 1,
      rtOutputCompleteDispatchCount: 1,
      rtOutputPaths: ["direct"],
      rtOutputResourceEventCount: 1,
      rtOutputWriteResourceEventCount: 1,
      rtOutputBarrierEventCount: 2,
    });
    expect(diagnostics.metalIrCompileObservations).toHaveLength(2);
    expect(diagnostics.metalIrCompileObservations[0]).toMatchObject({
      context: "compute",
      stage: "compute",
      sourceSha256: computeSha,
      errorCode: "0x13",
      exportPath: "/tmp/Application Support/compute.dxil",
      psoObject: "0xabc",
      psoId: 771,
      selection: "original",
      selectionReason: "unhandled_fp64",
    });
    expect(diagnostics.metalIrError19Correlations).toEqual([
      expect.objectContaining({
        systemIndex: 0,
        systemStage: "compute",
        noOpPsoId: null,
        observerSequence: 0,
        sourceSha256: computeSha,
        psoObject: "0xabc",
        psoId: 771,
      }),
      expect.objectContaining({
        systemIndex: 1,
        systemStage: "fragment",
        noOpPsoId: 429,
        observerSequence: 1,
        sourceSha256: fragmentSha,
      }),
    ]);
    expect(diagnostics.rtOutputEvidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("event=set-bytes index=3 length=48"),
        expect.stringContaining(
          "state=read_write role=output_candidate state_source=metal_usage"
        ),
        expect.stringContaining("event=end path=direct"),
      ])
    );
  });

  it("completes compute error correlation from the pass-through GOT wrapper without an inline PSO hook", () => {
    const computeSha = "c".repeat(64);
    const diagnostics = parseD3DMetalDxrPipelineDiagnostics(`
observer compile sequence=0 time_ns=100 tid=7 caller=0x87ec9 context=compute stage=compute size=333 sha256=${computeSha} capture=none result=returned_null error=0x13 error_status=code sink=non-null export=complete path=/tmp/compute.dxil pso_object=none pso_id=none selection=original selection_reason=unhandled_fp64 stack=0x87ec9,0x86e90
wine [D3DMetal:] Failed to compile stage Compute - error:19, <private>
`);
    expect(diagnostics).toMatchObject({
      metalCompileError19Count: 1,
      metalIrError19CorrelationComplete: true,
      metalIrError19UnmatchedObserverCount: 0,
      metalIrError19UnmatchedSystemCount: 0,
    });
    expect(diagnostics.metalIrError19Correlations).toEqual([
      expect.objectContaining({
        systemStage: "compute",
        context: "compute",
        sourceSha256: computeSha,
        psoObject: null,
        psoId: null,
        errorCode: "0x13",
      }),
    ]);
  });

  it("does not treat a read-only dispatch argument as valid RT output", () => {
    const diagnostics = parseD3DMetalDxrPipelineDiagnostics(`
observer rt-output installed target=0x16015b body_end=0x1607be method_hooks=12
observer rt-output sequence=0 time_ns=200 tid=9 encoder=0x1 event=begin caller=0x16015b records=1 flags=0 indirect_buffer=0x2 indirect_offset=0
observer rt-output sequence=0 time_ns=201 tid=9 encoder=0x1 event=dispatch-argument-buffer resource=0x2 kind=buffer usage=0x1 index=0 offset=0 format=0 extent=0x0x0 length=4096 gpu_address=0x1000 gpu_resource_id=0x20 resource_id=0x21 declared_usage=0x1 storage=2 hazard=1 options=0x20 state=read role=input state_source=metal_usage
observer rt-output sequence=0 time_ns=202 tid=9 encoder=0x1 event=dispatch-indirect mode=per-record-indirect offset=0 groups=8x8x1 groups_source=buffer_contents threads_per_group=8x8x1
observer rt-output sequence=0 time_ns=203 tid=9 encoder=0x1 event=end path=direct dispatches=1 resources=1 barriers=0 internal_barrier_src=4 internal_barrier_dst=4
`);
    expect(diagnostics).toMatchObject({
      rtOutputInstalled: true,
      rtOutputValid: false,
      rtOutputInvalidReasons: ["output-resource-missing"],
      rtOutputWriteResourceEventCount: 0,
    });
  });

  it("reports an unreadable indirect dispatch dimension explicitly", () => {
    const diagnostics = parseD3DMetalDxrPipelineDiagnostics(`
observer rt-output installed target=0x16015b body_end=0x1607be method_hooks=12
observer rt-output sequence=0 time_ns=200 tid=9 encoder=0x1 event=begin caller=0x16015b records=1 flags=0 indirect_buffer=0x2 indirect_offset=0
observer rt-output sequence=0 time_ns=201 tid=9 encoder=0x1 event=use-resource resource=0x3 kind=texture usage=0x2 index=0 offset=0 format=80 extent=1920x1080x1 length=0 gpu_address=0x0 gpu_resource_id=0x30 resource_id=0x31 declared_usage=0x3 storage=2 hazard=1 options=0x20 state=write role=output_candidate state_source=metal_usage
observer rt-output sequence=0 time_ns=202 tid=9 encoder=0x1 event=dispatch-indirect mode=per-record-indirect offset=0 groups=unavailable groups_source=not_cpu_visible threads_per_group=8x8x1
observer rt-output sequence=0 time_ns=203 tid=9 encoder=0x1 event=end path=direct dispatches=1 resources=1 barriers=0 internal_barrier_src=4 internal_barrier_dst=4
`);
    expect(diagnostics).toMatchObject({
      rtOutputInstalled: true,
      rtOutputValid: false,
      rtOutputInvalidReasons: ["dispatch-dimensions-unavailable"],
      rtOutputWriteResourceEventCount: 1,
    });
  });

  it("directly correlates the three v2 residual compute shaders and PSO IDs", () => {
    const residuals = [
      [
        "843be9c95dd09b3e4da739d67b91257495fb746da91b57eb52f859e682dd55ff",
        33228,
        9001,
      ],
      [
        "5dc35b52f5afac38ffc59a1f01a8f027d7f8b8cea95696287793e23ce2a08c07",
        37276,
        9002,
      ],
      [
        "4a407aaba959cc336584abca08fd34b4399b8aa8b844dec1411f07e1afaf57cc",
        16300,
        9003,
      ],
    ] as const;
    const compileLines = residuals
      .map(
        ([sha, size, psoId], sequence) =>
          `observer compile sequence=${sequence} time_ns=${100 + sequence} tid=7 caller=0x87ec9 context=compute stage=compute size=${size} sha256=${sha} capture=none result=returned_null error=0x13 error_status=code sink=non-null export=complete path=/tmp/${sha}.dxil pso_object=0x${(
            0xabc0 + sequence
          ).toString(16)} pso_id=${psoId} selection=original selection_reason=unhandled_fp64 stack=0x87ec9,0x86e90`
      )
      .join("\n");
    const systemLines = residuals
      .map(
        () =>
          "wine [D3DMetal:] Failed to compile stage Compute - error:19, <private>"
      )
      .join("\n");
    const diagnostics = parseD3DMetalDxrPipelineDiagnostics(`
${compileLines}
${systemLines}
observer rt-output installed target=0x16015b body_end=0x1607be method_hooks=12
observer rt-output sequence=0 time_ns=200 tid=9 encoder=0x1 event=begin caller=0x16015b records=1 flags=0 indirect_buffer=0x2 indirect_offset=0
observer rt-output sequence=0 time_ns=201 tid=9 encoder=0x1 event=dispatch-argument-buffer resource=0x2 kind=buffer usage=0x3 index=0 offset=0 format=0 extent=0x0x0 length=4096 gpu_address=0x1000 gpu_resource_id=0x20 resource_id=0x21 declared_usage=0x3 storage=2 hazard=1 options=0x20 state=read_write role=output_candidate state_source=metal_usage
observer rt-output sequence=0 time_ns=202 tid=9 encoder=0x1 event=dispatch-indirect mode=per-record-indirect offset=0 groups=8x8x1 groups_source=buffer_contents threads_per_group=8x8x1
observer rt-output sequence=0 time_ns=203 tid=9 encoder=0x1 event=end path=direct dispatches=1 resources=1 barriers=0 internal_barrier_src=4 internal_barrier_dst=4
`);
    expect(diagnostics).toMatchObject({
      metalCompileError19Count: 3,
      metalIrError19CorrelationComplete: true,
      noOpPsoCount: 0,
      rtOutputValid: true,
    });
    expect(
      diagnostics.metalIrError19Correlations.map(correlation => ({
        sha: correlation.sourceSha256,
        psoId: correlation.psoId,
        noOpPsoId: correlation.noOpPsoId,
      }))
    ).toEqual(
      residuals.map(([sha, , psoId]) => ({
        sha,
        psoId,
        noOpPsoId: null,
      }))
    );
  });

  it("maps tagged beta 2 HRESULTs to their exact rejecting stages", () => {
    expect(
      parseD3DMetalDxrPipelineDiagnostics(`
d3d12: could not create a Ray Tracing Pipeline State Object (0x8004d004)
d3d12: could not create a Ray Tracing Pipeline State Object (0x8004D004)
`)
    ).toMatchObject({
      hresultCounts: { "0x8004d004": 2 },
      stateObjectFailureStage: "shader-config-inheritance",
      stateObjectFailureTagCounts: { "shader-config-inheritance": 2 },
    });

    expect(
      parseD3DMetalDxrPipelineDiagnostics(`
d3d12: could not create a Ray Tracing Pipeline State Object (0x8004d001)
d3d12: could not create a Ray Tracing Pipeline State Object (0x8004d003)
`)
    ).toMatchObject({
      stateObjectFailureStage: "mixed",
      stateObjectFailureTagCounts: {
        "descriptor-parser": 1,
        "pipeline-config-inheritance": 1,
      },
    });
  });

  it("selects the newest complete runtime evidence filename", () => {
    expect(
      findLatestD3DMetalEvidenceFile([
        { entry: "d3dmetal_20_evidence.json", type: "FILE" },
        { entry: "d3dmetal_100_profile.json", type: "FILE" },
        { entry: "d3dmetal_100_evidence.json", type: "DIRECTORY" },
        { entry: "d3dmetal_30_evidence.json", type: "FILE" },
        { entry: "unrelated.json", type: "FILE" },
      ])
    ).toBe("d3dmetal_30_evidence.json");
    expect(findLatestD3DMetalEvidenceFile([])).toBeUndefined();
  });

  it("maps configured DXR and runtime evidence to a UI status", () => {
    expect(createD3DMetalDxrRuntimeStatus(false)).toEqual({
      status: "disabled",
      label: "disabled",
    });
    expect(createD3DMetalDxrRuntimeStatus(true)).toEqual({
      status: "pending",
      label: "enabled — verification pending",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
      })
    ).toEqual({
      status: "pending",
      label: "enabled — verification pending",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        dxrCapability: "supported",
        dxrVerified: true,
      })
    ).toEqual({
      status: "verified",
      label: "enabled — capability verified",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        dxrCapability: "supported",
        dxrVerified: true,
        dxrPipelineFailed: false,
        dxrPipelineDiagnostics: {
          rayTracingPsoFailureCount: 0,
          rtxgiInvalidStateObjectCount: 0,
          createStateObjectFailureCount: 0,
        },
      })
    ).toEqual({
      status: "pipeline-unobserved",
      label: "enabled — capability verified; pipeline unobserved",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        dxrCapability: "supported",
        dxrVerified: true,
        dxrPipelineFailed: false,
        dxrPipelineDiagnostics: {
          rayTracingPsoFailureCount: 0,
          rtxgiInvalidStateObjectCount: 0,
          createStateObjectFailureCount: 0,
          metalCompileFailureCount: 12,
          noOpPsoCount: 3,
        },
      })
    ).toEqual({
      status: "shader-graph-failed",
      label: "enabled — shader graph failed; RT output unobserved",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        dxrCapability: "supported",
        dxrVerified: true,
        dxrPipelineFailed: true,
      })
    ).toEqual({
      status: "pipeline-failed",
      label: "enabled — RTXGI pipeline failed",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        dxrCapability: "unsupported",
        dxrVerified: false,
      })
    ).toEqual({
      status: "unsupported",
      label: "enabled — runtime reports unsupported",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        dxrCapability: "conflict",
        dxrVerified: false,
      })
    ).toEqual({
      status: "conflict",
      label: "enabled — conflicting runtime reports",
    });
    expect(
      createD3DMetalDxrRuntimeStatus(true, {
        launchProfileVerified: false,
        backendVerified: true,
        dxrCapability: "supported",
        dxrVerified: true,
      })
    ).toEqual({
      status: "profile-mismatch",
      label: "profile mismatch — not verified",
    });
    expect(createD3DMetalDxrRuntimeStatus(true, "invalid JSON value")).toEqual({
      status: "evidence-unreadable",
      label: "enabled — evidence unreadable",
    });
  });

  it("maps configured MTL4 and backend activation evidence to a UI status", () => {
    expect(createD3DMetalMtl4RuntimeStatus(false)).toEqual({
      status: "disabled",
      label: "disabled",
    });
    expect(createD3DMetalMtl4RuntimeStatus(true)).toEqual({
      status: "pending",
      label: "enabled — verification pending",
    });
    expect(
      createD3DMetalMtl4RuntimeStatus(true, {
        status: "pending",
      })
    ).toEqual({
      status: "pending",
      label: "enabled — verification pending",
    });
    expect(
      createD3DMetalMtl4RuntimeStatus(true, {
        launchProfileVerified: true,
        mtl4Configured: true,
        mtl4BackendEnabled: true,
      })
    ).toEqual({ status: "verified", label: "enabled — verified" });
    expect(
      createD3DMetalMtl4RuntimeStatus(true, {
        launchProfileVerified: true,
        mtl4Configured: true,
        mtl4BackendEnabled: false,
      })
    ).toEqual({
      status: "backend-unverified",
      label: "enabled — backend not verified",
    });
  });

  it("reports MetalFX only when conversion has runtime evidence", () => {
    expect(createD3DMetalMetalFxRuntimeStatus(false)).toEqual({
      status: "disabled",
      label: "disabled",
    });
    expect(
      createD3DMetalMetalFxRuntimeStatus(true, { status: "pending" })
    ).toEqual({
      status: "pending",
      label: "configured — verification pending",
    });
    expect(
      createD3DMetalMetalFxRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        metalFxVerified: false,
        observations: { metalFxFailure: false },
      })
    ).toEqual({
      status: "conversion-unverified",
      label: "configured — conversion unverified",
    });
    expect(
      createD3DMetalMetalFxRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        metalFxVerified: true,
        observations: { metalFxFailure: false },
      })
    ).toEqual({ status: "verified", label: "enabled — verified" });
    expect(
      createD3DMetalMetalFxRuntimeStatus(true, {
        launchProfileVerified: true,
        backendVerified: true,
        metalFxVerified: false,
        observations: { metalFxFailure: true },
      })
    ).toEqual({
      status: "runtime-failed",
      label: "configured — runtime reported failure",
    });
  });

  it("rejects active D3D11, conflicting, missing, and DXMT renderer evidence", () => {
    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog: "Loaded d3d11.dll",
        systemLog: "",
        playerLog: "Direct3D:\n    Version: Direct3D 11.0 [level 11.1]",
        moduleSnapshot: "/tmp/D3DMetal.framework/D3DMetal",
        launchProfile,
        validatedD3DMetalVersion: "4.0b2",
      })
    ).toMatchObject({
      selectedRenderer: "d3d11",
      backendVerified: false,
      verified: false,
    });

    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog: "DXMT loaded d3d12.dll through winemetal",
        systemLog: "",
        playerLog: d3d12PlayerLog,
        moduleSnapshot:
          "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
        launchProfile,
        validatedD3DMetalVersion: "4.0b2",
      })
    ).toMatchObject({
      selectedRenderer: "d3d12",
      backendVerified: false,
      observations: { dxmt: true },
    });

    expect(
      parseD3DMetalSelectedRenderer(
        `${d3d12PlayerLog}\nDirect3D:\n Version: Direct3D 11.0 [level 11.1]`
      )
    ).toMatchObject({ selectedRenderer: "conflict" });
    expect(parseD3DMetalSelectedRenderer("ordinary Unity output")).toEqual({
      selectedRenderer: "unknown",
      evidence: [],
    });
    expect(parseD3DMetalSelectedRenderer("d3d12: loaded!")).toEqual({
      selectedRenderer: "unknown",
      evidence: ["d3d12: loaded!"],
    });
  });

  it("requires an exact launch profile and GPTK version", () => {
    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog: "Loaded d3d12.dll",
        systemLog: "",
        playerLog: d3d12PlayerLog,
        moduleSnapshot:
          "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
        launchProfile: {
          ...launchProfile,
          arguments: [launchProfile.gameExecutable, "-force-d3d12"],
        },
        validatedD3DMetalVersion: "4.0b1",
      })
    ).toMatchObject({
      exactD3DMetalVersion: false,
      launchProfileVerified: false,
      backendVerified: false,
      verified: false,
    });

    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog: "Loaded d3d12.dll",
        systemLog: "",
        playerLog: d3d12PlayerLog,
        moduleSnapshot:
          "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
        launchProfile: {
          ...launchProfile,
          arguments: [...launchProfile.arguments, "-screen-width", "3840"],
        },
        validatedD3DMetalVersion: "4.0b2",
      })
    ).toMatchObject({
      launchProfileVerified: false,
      backendVerified: false,
    });

    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog: "Loaded d3d12.dll",
        systemLog: "Timestamp Ty Process[PID:TID]",
        playerLog: d3d12PlayerLog,
        moduleSnapshot: "",
        launchProfile,
        validatedD3DMetalVersion: "4.0b2",
      })
    ).toMatchObject({
      moduleSnapshotCaptured: false,
      backendVerified: false,
      observations: { d3dMetal: false, d3d12: true },
    });

    const { CX_ACTIVE_GRAPHICS_BACKEND: _backend, ...missingBackend } =
      launchProfile.environment;
    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog: "Loaded d3d12.dll",
        systemLog: "",
        playerLog: d3d12PlayerLog,
        moduleSnapshot:
          "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
        launchProfile: {
          ...launchProfile,
          environment: missingBackend,
        },
        validatedD3DMetalVersion: "4.0b2",
      })
    ).toMatchObject({
      launchProfileVerified: false,
      backendVerified: false,
    });

    expect(
      analyzeD3DMetalRuntimeEvidence({
        wineLog: "Loaded d3d12.dll",
        systemLog: "",
        playerLog: d3d12PlayerLog,
        moduleSnapshot:
          "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
        launchProfile: {
          ...launchProfile,
          environment: {
            ...launchProfile.environment,
            D3DM_SUPPORT_DXR: "0",
          },
        },
        validatedD3DMetalVersion: "4.0b2",
      })
    ).toMatchObject({
      launchProfileVerified: false,
      backendVerified: false,
      dxrCapability: "supported",
      dxrVerified: false,
    });
  });

  it("verifies MetalFX only with an explicit successful DLSS conversion", () => {
    const base = {
      wineLog: "Loaded d3d12.dll and nvngx.dll",
      systemLog: "",
      playerLog: d3d12PlayerLog,
      moduleSnapshot:
        "/tmp/D3DMetal.framework/D3DMetal C:\\windows\\system32\\d3d12.dll",
      launchProfile,
      validatedD3DMetalVersion: "4.0b2",
    };
    expect(
      analyzeD3DMetalRuntimeEvidence({
        ...base,
        playerLog: `${d3d12PlayerLog}\nD3DM_ENABLE_METALFX=1\nMetalFX\nNvApi is not supported: 0xfffffffe\n[streamline] error: DLSS is not requested or failed to load.`,
      })
    ).toMatchObject({ metalFxVerified: false, verified: false });

    expect(
      analyzeD3DMetalRuntimeEvidence({
        ...base,
        systemLog: "D3DMetal: converting DLSS request to MetalFX",
      })
    ).toMatchObject({
      backendVerified: true,
      metalFxVerified: true,
      verified: true,
    });
  });

  it("rejects stale Player.log fingerprints and identifies exact game argv", () => {
    const old = {
      size: 100,
      sha256: "a".repeat(64),
      inode: 1,
      modifiedAtSeconds: 1000,
    };
    expect(isFreshD3DMetalPlayerLog(old, old)).toBe(false);
    expect(
      isFreshD3DMetalPlayerLog(old, {
        ...old,
        size: 101,
        sha256: "b".repeat(64),
      })
    ).toBe(true);
    expect(
      isFreshD3DMetalPlayerLog(old, {
        ...old,
        modifiedAtSeconds: 1001,
      })
    ).toBe(true);
    expect(isFreshD3DMetalPlayerLog(undefined, old)).toBe(true);
    expect(isFreshD3DMetalPlayerLog(old, undefined)).toBe(false);

    expect(
      findD3DMetalGameProcessIds(
        `100 /tmp/wine C:\\windows\\system32\\steam.exe Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe -use-d3d12\n101 /tmp/helper ZenlessZoneZero.exe\n102 /tmp/other`,
        launchProfile.gameExecutable
      )
    ).toEqual([100]);
  });
});

describe("D3DMetal multi-instance Metal IR aggregation", () => {
  const marker = (instance: string, pid = 101) => ({
    runId: "run-1",
    pid,
    instance,
    manifestPath: `/tmp/session/instances/${instance}/manifest.json`,
  });

  it("parses stable PID identity and NUL lsof vnode fields", () => {
    expect(parseD3DMetalProcessIdentity("29660 Mon Aug  2 05:00:01 2026")).toEqual({
      pid: 29660,
      startIdentity: "Mon Aug  2 05:00:01 2026",
    });
    expect(equalD3DMetalProcessIdentity(
      parseD3DMetalProcessIdentity("29660 start"),
      parseD3DMetalProcessIdentity("29660 start")
    )).toBe(true);
    const records = parseD3DMetalLsofFields(
      "p29660\0cWine\0f cwd\0D0x100002\0i123\0tREG\0n/Applications/ZenlessZoneZero/ZenlessZoneZero.exe\0" +
      "f txt\0tREG\0n/opt/D3DMetal.framework/Versions/A/D3DMetal\0" +
      "f txt\0tREG\0nd3d12.dll\0"
    );
    expect(records).toHaveLength(3);
    expect(records[0].dev).toBe(0x100002n);
    expect(records[0].inode).toBe(123n);
    expect(hasD3DMetalRuntimeModules(records)).toBe(true);
  });

  it("requires REG plus canonical path and dev/inode, rejecting aliases and conflicts", () => {
    const expected = {
      requestedPath: "/Applications/ZenlessZoneZero/ZenlessZoneZero.exe",
      canonicalPath: "/Applications/ZenlessZoneZero/ZenlessZoneZero.exe",
      realPath: "/private/var/containers/ZenlessZoneZero.exe",
      device: 0x100002n,
      inode: 123n,
    };
    const base = { pid: 29660, type: "REG", dev: 0x100002n, inode: 123n } as const;
    expect(validateD3DMetalExpectedVnode([
      { ...base, name: expected.canonicalPath },
      { ...base, name: expected.canonicalPath },
      { ...base, name: expected.realPath },
    ], expected)).toMatchObject({ ok: true });
    expect(validateD3DMetalExpectedVnode([
      { ...base, name: expected.canonicalPath },
      { ...base, name: expected.canonicalPath + ".bak" },
      { ...base, name: expected.realPath },
    ], expected)).toEqual({ ok: false, reason: "hard-link-alias" });
    expect(validateD3DMetalExpectedVnode([
      { ...base, name: expected.canonicalPath },
      { ...base, inode: 124n, name: expected.realPath },
    ], expected)).toEqual({ ok: false, reason: "conflicting-vnode" });
    expect(validateD3DMetalExpectedVnode([
      { ...base, type: "REG", dev: 0x100003n, name: expected.canonicalPath },
    ], expected)).toEqual({ ok: false, reason: "hard-link-alias" });
  });

  it("holds stand-in workload release until ACK and confirms mismatch termination", async () => {
    let released = false;
    const validAck = JSON.parse(
      JSON.stringify({
        state: "armed",
        token: "t",
        attempt_id: "a",
        run_id: "r",
        session_root: "/s",
        capture_sha256: "c",
      d3dmetal_sha256: "d",
      module_sha256: "d",
        configured_offset: "0x87ec9",
        pid: 7,
        executable: "e",
        game_executable: "g",
      })
    );
    const gated = await startD3DMetalCaptureWithAckGate({
      start: async () => ({
        pid: 7,
        result: Promise.resolve({ exitCode: 0 }),
        release: async () => {
          released = true;
        },
      }),
      acknowledge: async () => {
        expect(released).toBe(false);
        return validAck;
      },
      terminate: async () => {
        throw new Error("not expected");
      },
    });
    expect(gated.acknowledgement.pid).toBe(7);
    expect(released).toBe(true);

    let alive = true;
    await expect(
      startD3DMetalCaptureWithAckGate({
        start: async () => ({
          pid: 8,
          result: Promise.resolve({ exitCode: 1 }),
        }),
        acknowledge: async () => {
          throw new Error("mismatch");
        },
        terminate: async () =>
          terminateAndConfirmProcess({
            pid: 8,
            terminate: async () => {
              alive = false;
            },
            isAlive: async () => alive,
            sleep: async () => {},
            timeoutMs: 0,
          }),
      })
    ).rejects.toThrow("mismatch");
    expect(alive).toBe(false);
  });

  it("requires an exact game path and excludes helper-only lookalikes", () => {
    const ps = [
      "71090 1 Mon Aug  2 05:00:00 2026 steam.exe ZenlessZoneZero.exe",
      "71111 71090 Mon Aug  2 05:00:01 2026 /Applications/ZenlessZoneZero/ZenlessZoneZero.exe",
      "71112 71111 Mon Aug  2 05:00:01 2026 ZFGameBrowser.exe",
      "71113 71111 Mon Aug  2 05:00:01 2026 helper ZenlessZoneZero.exe",
    ].join("\n");
    const candidates = findAuthoritativeD3DMetalGameCandidates(
      ps,
      "/Applications/ZenlessZoneZero/ZenlessZoneZero.exe",
      71090
    );
    expect(candidates.map(candidate => candidate.pid)).toEqual([71111]);
    expect(candidates[0].startIdentity).toBe("Mon Aug  2 05:00:01 2026");
  });

  it("accepts a wineserver-reparented exact game command without prefix text", () => {
    const ps = [
      "71090 1 Mon Aug  2 05:00:00 2026 C:\\windows\\system32\\steam.exe Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe",
      "75348 1 Mon Aug  2 05:00:01 2026 Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe -use-d3d12 scmbDir=/tmp/scm",
      "75349 1 Mon Aug  2 05:00:01 2026 Z:/Applications/ZenlessZoneZero/ZenlessZoneZero_Data/Plugins/x86_64/ZFGameBrowser.exe --type=renderer",
    ].join("\n");
    const candidates = findAuthoritativeD3DMetalGameCandidates(
      ps,
      "Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe",
      71090,
      "/Users/test/Library/Application Support/Yaagl ZZZ DX12/wineprefix"
    );
    expect(candidates.map(candidate => candidate.pid)).toEqual([71090, 75348]);
  });

  it("uses the unique ACK PID to disambiguate combined and pure game hosts", async () => {
    const candidates = [
      { pid: 71090, ppid: 1, startIdentity: "start-a", args: "combined" },
      { pid: 75348, ppid: 1, startIdentity: "start-b", args: "pure" },
    ];
    const ack = { pid: 71090 } as any;
    await expect(
      waitForD3DMetalCaptureAcknowledgement({
        path: "/unused",
        expected: {} as any,
        snapshotGameExecutable: "/Applications/ZenlessZoneZero/ZenlessZoneZero.exe",
        candidates,
        enumerate: async () => [ack],
        snapshot: async () =>
          "p71090\0f txt\0t REG\0n/Applications/ZenlessZoneZero/ZenlessZoneZero.exe\0f txt\0t REG\0n/opt/D3DMetal.framework/Versions/A/D3DMetal\0f txt\0t REG\0n/usr/lib/d3d12.dll\0",
        timeoutMs: 0,
        pollIntervalMs: 0,
        sleep: async () => {},
      })
    ).resolves.toBe(ack);
  });

  it("rejects malformed NUL fields and validates exact required artifact sets", () => {
    expect(() => parseD3DMetalLsofFields("p7\0xunknown\0")).toThrow("unknown");
    expect(() => parseD3DMetalLsofFields("p7\0cWine")).toThrow("unterminated");
    expect(() => parseD3DMetalLsofFields("p7\0cWine\0cWine\0")).toThrow("duplicate");
    expect(parseD3DMetalLsofFields("p7\0cWine\0\nf txt\0tREG\0n/game.exe\0\n"))
      .toHaveLength(1);
    const output = new TextEncoder().encode("p7\0f txt\0t REG\0n/game.exe\0f txt\0t REG\0n/D3DMetal.framework/D3DMetal\0f txt\0t REG\0n/d3d12.dll\0");
    const records = parseD3DMetalLsofFields(output);
    expect(hasD3DMetalRequiredArtifacts(records, ["/game.exe", "/D3DMetal.framework/D3DMetal", "/d3d12.dll"])).toBe(true);
    expect(hasD3DMetalRequiredArtifacts(records, ["/game.exe", "/D3DMetal.framework/D3DMetal"])).toBe(true);
    expect(hasD3DMetalRequiredArtifacts(records, ["/game.exe", "/missing.dll"])).toBe(false);
  });

  it("preflights an absolute regular executable and rejects symlink components", async () => {
    const fs = {
      lstat: async (path: string) => ({ type: path === "/Applications" || path === "/Applications/ZenlessZoneZero" ? "DIR" : "REG" }),
      stat: async () => ({ type: "REG", dev: 12n, ino: 34n }),
      realpath: async (path: string) => path,
    };
    await expect(preflightD3DMetalExpectedVnode("/Applications/ZenlessZoneZero/game.exe", fs)).resolves.toMatchObject({ device: 12n, inode: 34n });
    await expect(preflightD3DMetalExpectedVnode("relative/game.exe", fs)).rejects.toThrow("absolute");
    await expect(preflightD3DMetalExpectedVnode("/Applications/../game.exe", fs)).rejects.toThrow("clean");
  });

  it("fails closed when two candidate PIDs publish valid ACKs", async () => {
    const candidates = [
      { pid: 71090, ppid: 1, startIdentity: "start-a", args: "combined" },
      { pid: 75348, ppid: 1, startIdentity: "start-b", args: "pure" },
    ];
    await expect(
      waitForD3DMetalCaptureAcknowledgement({
        path: "/unused",
        expected: {} as any,
        candidates,
        enumerate: async () => [{ pid: 71090 } as any, { pid: 75348 } as any],
        snapshot: async () => "not reached",
        timeoutMs: 0,
        pollIntervalMs: 0,
        sleep: async () => {},
      })
    ).rejects.toThrow("multiple validated ACKs");
  });

  it("terminates and confirms the complete known Wine tree", async () => {
    const alive = new Set([71090, 71111, 71112]);
    await terminateAndConfirmD3DMetalWineTree({
      rootPid: 71090,
      knownPids: [71111, 71112],
      terminatePrefix: async () => {},
      terminate: async pid => {
        alive.delete(pid);
      },
      isAlive: async pid => alive.has(pid),
      sleep: async () => {},
      timeoutMs: 0,
    });
    expect(alive.size).toBe(0);
  });

  it("accepts only a structurally valid DXBC container with a DXIL chunk", () => {
    const valid = new Uint8Array(48);
    valid.set([68, 88, 66, 67], 0);
    const view = new DataView(valid.buffer);
    view.setUint32(24, 48, true);
    view.setUint32(28, 1, true);
    view.setUint32(32, 36, true);
    valid.set([68, 88, 73, 76], 36);
    view.setUint32(40, 4, true);
    expect(validateD3DMetalDxilContainer(valid)).toBe(true);
    valid[0] = 0;
    expect(validateD3DMetalDxilContainer(valid)).toBe(false);
  });

  it("does not treat an unparseable payload as final evidence", () => {
    const result = aggregateD3DMetalMetalIrManifests({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      markers: [marker("0")],
      manifests: [
        {
          run_id: "run-1",
          pid: 101,
          instance_id: "0",
          complete: true,
          terminal_status: "complete",
          omission_count: 0,
          queued: 1,
          published: 1,
          aggregate: {
            wrapper_entries: 1,
            offset_overflow: 0,
            original_calls: 1,
            target_records: 1,
          },
          records: [
            {
              payload_path: "/tmp/session/instances/0/a.dxil",
              payload_length: 4,
              payload_sha256: "a",
              targetObserved: true,
              caller_offset: 0x87ec9,
              module_identity: "D3DMetal.framework",
              module_sha256: "d".repeat(64),
              configured_offset: "0x87ec9",
              target_predicate: "exact-offset-precall-dxil",
              capture_sha256: "c".repeat(64),
              d3dmetal_sha256: "d".repeat(64),
            },
          ],
        },
      ],
      payloadValidity: [false],
      terminalStatus: "complete",
      expectedModuleIdentity: "D3DMetal.framework",
      expectedCaptureHash: "c".repeat(64),
      expectedD3DMetalHash: "d".repeat(64),
    });
    expect(result.targetObserved).toBe(true);
    expect(result.payloadParseable).toBe(false);
    expect(result.finalEvidenceReady).toBe(false);
  });

  it("rejects non-exact offset, predicate, module, or artifact identity", () => {
    const record = {
      payload_path: "/tmp/session/instances/0/a.dxil",
      payload_length: 4,
      payload_sha256: "a",
      targetObserved: true,
      caller_offset: 0x1,
      module_identity: "wrong",
      module_sha256: "x".repeat(64),
      d3dmetal_sha256: "x".repeat(64),
      capture_sha256: "x".repeat(64),
      configured_offset: "0x1",
      target_predicate: "CompileRTFunction",
    };
    const result = aggregateD3DMetalMetalIrManifests({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      markers: [marker("0")],
      manifests: [
        {
          run_id: "run-1",
          pid: 101,
          instance_id: "0",
          complete: true,
          terminal_status: "complete",
          queued: 1,
          published: 1,
          aggregate: {
            wrapper_entries: 1,
            offset_overflow: 0,
            original_calls: 1,
            target_records: 1,
          },
          records: [record],
        },
      ],
      payloadValidity: [true],
      terminalStatus: "complete",
      expectedModuleIdentity: "D3DMetal.framework",
      expectedCaptureHash: "c".repeat(64),
      expectedD3DMetalHash: "d".repeat(64),
    });
    expect(result.targetObserved).toBe(false);
    expect(result.finalEvidenceReady).toBe(false);
  });

  it("does not finalize evidence without ACK PID and module snapshot authority", () => {
    const result = aggregateD3DMetalMetalIrManifests({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      markers: [marker("0", 7)],
      manifests: [],
      payloadValidity: [],
      terminalStatus: "complete",
      expectedAckPid: 8,
      moduleSnapshotValid: false,
    });
    expect(result.finalEvidenceReady).toBe(false);
    expect(result.lifecycleValid).toBe(false);
  });

  it("parses run, pid, instance and manifest identity", () => {
    expect(
      parseD3DMetalMetalIrInstanceMarkers(
        "capture installed mode=metal-ir-capture-v1 run=run-1 pid=101 instance=9 manifest=/tmp/session/instances/9/manifest.json",
        "run-1"
      )
    ).toEqual([marker("9")]);
  });

  it("recognizes the exact capture-installed probe marker", () => {
    expect(
      parseD3DMetalMetalIrProbe(
        "capture installed mode=metal-ir-capture-v1 run=run-1 pid=101 instance=9 manifest=/tmp/session/instances/9/manifest.json"
      )
    ).toMatchObject({ installed: true });
  });

  it("deduplicates exact capture-install repeats but rejects conflicts", () => {
    const line =
      "capture installed mode=metal-ir-capture-v1 run=run-1 pid=101 instance=9 manifest=/tmp/session/instances/9/manifest.json";
    expect(
      parseD3DMetalMetalIrInstanceMarkers(`${line}\n${line}`, "run-1")
    ).toHaveLength(1);
    expect(() =>
      parseD3DMetalMetalIrInstanceMarkers(
        `${line}\ncapture installed mode=metal-ir-capture-v1 run=run-1 pid=101 instance=9 manifest=/tmp/session/instances/9/other.json`,
        "run-1"
      )
    ).toThrow("conflicting");
  });

  it("fails malformed capture-install markers while ignoring unrelated runs", () => {
    expect(
      parseD3DMetalMetalIrInstanceMarkers(
        "capture installed mode=metal-ir-capture-v1 run=old pid=101 instance=9 manifest=/tmp/old.json",
        "run-1"
      )
    ).toEqual([]);
    expect(() =>
      parseD3DMetalMetalIrInstanceMarkers(
        "capture installed mode=metal-ir-capture-v1 run=run-1 pid=101 instance=9",
        "run-1"
      )
    ).toThrow("malformed");
  });

  it("allows records to share an immutable payload when declarations agree", () => {
    const shared = {
      payload_path: "/tmp/session/instances/0/a.dxil",
      payload_length: 4,
      payload_sha256: "a",
      caller_offset: 0x87ec9,
      targetObserved: true,
      module_identity: "d3dmetal",
      configured_offset: "0x87ec9",
      target_predicate: "exact-offset-precall-dxil",
      module_sha256: "d".repeat(64),
      capture_sha256: "c".repeat(64),
      d3dmetal_sha256: "d".repeat(64),
    };
    const result = aggregateD3DMetalMetalIrManifests({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      markers: [marker("0")],
      authoritativeInstanceIds: ["0"],
      directMarkerInstanceIds: ["0"],
      manifests: [
        {
          schema: 1,
          run_id: "run-1",
          pid: 101,
          instance_id: "0",
          complete: true,
          terminal_status: "complete",
          omission_count: 0,
          queued: 2,
          published: 2,
          aggregate: {
            wrapper_entries: 2,
            offset_overflow: 0,
            original_calls: 2,
            target_records: 1,
          },
          records: [shared, { ...shared, targetObserved: false }],
        },
      ],
      payloadValidity: [true, true],
      terminalStatus: "complete",
      expectedModuleIdentity: "d3dmetal",
      expectedCaptureHash: "c".repeat(64),
      expectedD3DMetalHash: "d".repeat(64),
    });
    expect(result.payloadValid).toBe(true);
  });

  it("keeps nine empty instances unready until records arrive", async () => {
    let tick = 0;
    let populated = false;
    const markers = Array.from({ length: 9 }, (_, i) =>
      marker(String(i), 100 + i)
    );
    const result = await settleD3DMetalMetalIrAggregation({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      launchExitedAt: 0,
      scan: async () => {
        populated = tick >= 3;
        return markers;
      },
      readManifest: async marker => ({
        schema: 1,
        run_id: "run-1",
        pid: marker.pid,
        instance_id: marker.instance,
        complete: true,
        terminal_status: "complete",
        queued: populated && marker.instance === "0" ? 1 : 0,
        published: populated && marker.instance === "0" ? 1 : 0,
        aggregate: {
          wrapper_entries: 1,
          offset_overflow: 0,
          original_calls: 1,
          target_records: populated && marker.instance === "0" ? 1 : 0,
        },
        records:
          populated && marker.instance === "0"
            ? [
                {
                  payload_path: "/tmp/session/instances/0/a.dxil",
                  payload_length: 4,
                  payload_sha256: "a",
                  targetObserved: true,
                  caller_offset: 0x87ec9,
                  module_identity: "d3dmetal",
                  module_sha256: "d".repeat(64),
                  capture_sha256: "c".repeat(64),
                  d3dmetal_sha256: "d".repeat(64),
                  configured_offset: "0x87ec9",
                  target_predicate: "exact-offset-precall-dxil",
                },
              ]
            : [],
      }),
      validateRecords: async manifest =>
        (manifest.records ?? []).map(() => true),
      expectedModuleIdentity: "d3dmetal",
      expectedCaptureHash: "c".repeat(64),
      expectedD3DMetalHash: "d".repeat(64),
      now: () => tick * 100,
      sleep: async () => {
        tick += 1;
      },
    });
    expect(result.instances).toHaveLength(9);
    expect(result.targetObserved).toBe(true);
    expect(result.analysisReady).toBe(true);
    expect(result.finalEvidenceReady).toBe(true);
  });

  it("rejects duplicate identities and mismatched manifests", () => {
    const a = marker("0");
    expect(
      aggregateD3DMetalMetalIrManifests({
        runId: "run-1",
        sessionRoot: "/tmp/session",
        markers: [a, a],
        manifests: [],
        payloadValidity: [],
        terminalStatus: "complete",
      }).lifecycleValid
    ).toBe(false);
  });

  it("preserves hard publication failures in the aggregate evidence shape", () => {
    const result = aggregateD3DMetalMetalIrManifests({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      markers: [marker("0")],
      manifests: [
        {
          run_id: "run-1",
          pid: 101,
          instance_id: "0",
          complete: true,
          terminal_status: "complete",
          queued: 0,
          published: 0,
          records: [],
          aggregate: {
            wrapper_entries: 1,
            offset_overflow: 0,
            original_calls: 1,
            target_records: 0,
          },
          failure_diagnostics: { publication_failed: true },
        },
      ],
      payloadValidity: [],
      terminalStatus: "complete",
    });
    expect(result.lifecycleValid).toBe(false);
    expect(result.failures).toContain("publication_failed");
    expect(result.reason).toBe("publication_failed");
  });

  it("reconciles instance directories against logs and marker files", async () => {
    let tick = 0;
    const result = await settleD3DMetalMetalIrAggregation({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      launchExitedAt: 0,
      scan: async () => ({
        markers: [marker("from-log")],
        instanceIds: ["from-log", "directory-only"],
        markerInstanceIds: ["from-log"],
        installedLogInstanceIds: ["from-log"],
      }),
      readManifest: async item => (item.instance === "from-log" ? null : null),
      validateRecords: async () => [],
      now: () => tick++ * 30_000,
      sleep: async () => undefined,
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "missing_marker",
        "missing_install_log",
        "missing_terminal",
      ])
    );
    expect(result.failures).toContain("missing_manifest");
  });

  it("records missing_terminal for an active manifest without a capture marker", async () => {
    let tick = 0;
    const result = await settleD3DMetalMetalIrAggregation({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      launchExitedAt: 0,
      scan: async () => ({
        markers: [],
        instanceIds: ["active"],
        markerInstanceIds: [],
        installedLogInstanceIds: [],
      }),
      readManifest: async () => null,
      validateRecords: async () => [],
      now: () => tick++ * 30_000,
      sleep: async () => undefined,
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "missing_terminal",
        "missing_marker",
        "missing_install_log",
      ])
    );
  });

  it("publishes the latest active generation without rewriting its process manifest", async () => {
    let tick = 0;
    let published: any;
    const active = {
      run_id: "run-1",
      pid: 101,
      instance_id: "active",
      complete: false,
      terminal_status: "active",
      queued: 2,
      published: 2,
      aggregate: {
        wrapper_entries: 2,
        offset_overflow: 0,
        original_calls: 2,
        target_records: 1,
      },
      records: [
        {
          targetObserved: true,
          payload_path: "/tmp/session/instances/active/a.dxil",
          payload_length: 4,
          payload_sha256: "a",
          module_identity: "d3dmetal",
          configured_offset: "0x1",
          target_predicate: "CompileAndLink",
        },
      ],
    };
    const result = await settleD3DMetalMetalIrAggregation({
      runId: "run-1",
      sessionRoot: "/tmp/session",
      launchExitedAt: 0,
      scan: async () => ({
        markers: [marker("active")],
        instanceIds: ["active"],
        markerInstanceIds: ["active"],
        installedLogInstanceIds: ["active"],
      }),
      readManifest: async () => active,
      validateRecords: async () => [true],
      now: () => tick++ * 30_000,
      sleep: async () => undefined,
      writeAggregate: async value => {
        published = value;
      },
    });
    expect(result.failures).toContain("missing_terminal");
    expect(result.records).toEqual(active.records);
    expect(result.manifests[0].queued).toBe(2);
    expect(published.records).toEqual(active.records);
  });

  it.each([
    [false, true, 4, "a", "a", false],
    [true, true, 3, "a", "a", false],
    [true, true, 4, "b", "a", false],
    [true, false, 4, "a", "a", true],
    [true, false, 4, "a", "a", true],
  ])(
    "validates missing/truncated/altered payload (%s)",
    (regular, symlink, length, digest, declared, expected) => {
      expect(
        validateD3DMetalMetalIrPayload(
          {
            payload_path: "/tmp/session/instances/0/a.dxil",
            payload_length: length,
            payload_sha256: declared,
          },
          {
            sessionRoot: "/tmp/session",
            instance: marker("0"),
            regular,
            symlink,
            byteLength: 4,
            sha256: digest,
            resolvedPath: "/tmp/session/instances/0/a.dxil",
          }
        )
      ).toBe(expected);
    }
  );
});

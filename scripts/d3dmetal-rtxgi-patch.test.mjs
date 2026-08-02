import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyFailureTags,
  applyGuardAndFailureTags,
  applyCreateStateObjectReturnTrap,
  applyNoOpFixAndCreateFunctionNullTraps,
  applyNoOpFixAndIrLinkNullWithCompileRtFallback,
  applyNoOpFixAndCompileExportStoreTraps,
  applyStateObjectInheritanceResultTrap,
  applyStateObjectParserPhaseTrap,
  applyNoOpPsoVertexCountInit,
  applyStateObjectTraps,
  applyVertexBufferCountGuard,
  CREATE_STATE_OBJECT_RETURN_TRAP,
  CREATE_FUNCTION_NULL_ORIGIN_SITES,
  COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES,
  D3DMETAL_4_0_BETA_2_SHA256,
  inspectD3DMetalBinary,
  IR_COMPILER_LINK_NULL_TRAP,
  NO_OP_PSO_VERTEX_COUNT_INIT,
  STATE_OBJECT_FAILURE_SITES,
  STATE_OBJECT_INHERITANCE_RESULT_TRAP,
  STATE_OBJECT_PARSER_RESULT_TRAP,
  VERTEX_BUFFER_COUNT_GUARD,
} from "./d3dmetal-rtxgi-patch.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const pristineBinary = resolve(
  scriptDirectory,
  "../build/d3dmetal-4.0b2-rtxgi-diagnostic/D3DMetal.framework.pristine/Versions/A/D3DMetal"
);
const combinedRawSha256 =
  "1cb3c3c20c806618aefcededeb234cae00c7243cbe5ad300b8d4994f1cad073e";
const trapRawSha256 =
  "de7d5354ff997e1c5c04a4542d3e376c3e53bd120d5d278edab23ae0588383ef";
const noOpFixRawSha256 =
  "1a9dceacfd83a765d3d992e1a725d73de2cc52b4cbd0f9047e28dca0c5f0fa7e";
const stateObjectReturnTrapRawSha256 =
  "42e501dbacfdf13100ed6a1dad7a3ea9e0ada00e59d9398c00009a8d692e18e0";
const stateObjectParserPhaseTrapRawSha256 =
  "288226f9418e2d9d6571d0438158df259494abc4ba3fdae2b9a6d88319e16c41";
const stateObjectInheritanceResultTrapRawSha256 =
  "d493673906c4414712d7774621184ca7e7257ca9d6d2431f4a85d75c42e1b43b";
const noOpFixCompileExportStoreTrapsRawSha256 =
  "36ee7c9dacacbecfd1653abb117751ac77c5864bd52e62269d8e1c1cdc7d4c41";
const noOpFixCreateFunctionNullTrapsRawSha256 =
  "08177292775335e288fc5b05e6aa569d442f84b960a8792842de539032b15599";
const noOpFixIrLinkFallbackRawSha256 =
  "12e278f9bc3004529603a3efba0c1f670aa97bbfbd007c14189a8288884d251b";

const fixtureSize = Math.max(
  VERTEX_BUFFER_COUNT_GUARD.resumeOffset,
  NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset +
    NO_OP_PSO_VERTEX_COUNT_INIT.expectedCave.length,
  CREATE_STATE_OBJECT_RETURN_TRAP.offset +
    CREATE_STATE_OBJECT_RETURN_TRAP.expectedOriginal.length,
  STATE_OBJECT_PARSER_RESULT_TRAP.offset +
    STATE_OBJECT_PARSER_RESULT_TRAP.expectedOriginal.length,
  STATE_OBJECT_INHERITANCE_RESULT_TRAP.offset +
    STATE_OBJECT_INHERITANCE_RESULT_TRAP.expectedOriginal.length,
  ...COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES.map(
    site => site.instructionOffset + site.expectedInstruction.length
  ),
  ...CREATE_FUNCTION_NULL_ORIGIN_SITES.map(
    site => site.instructionOffset + site.expectedInstruction.length
  ),
  IR_COMPILER_LINK_NULL_TRAP.instructionOffset +
    IR_COMPILER_LINK_NULL_TRAP.expectedInstruction.length,
  ...STATE_OBJECT_FAILURE_SITES.map(
    site => site.instructionOffset + site.expectedInstruction.length
  )
);

function opcodeFixture() {
  const bytes = Buffer.alloc(fixtureSize);
  VERTEX_BUFFER_COUNT_GUARD.expectedOriginal.copy(
    bytes,
    VERTEX_BUFFER_COUNT_GUARD.offset
  );
  NO_OP_PSO_VERTEX_COUNT_INIT.expectedEdge.copy(
    bytes,
    NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset
  );
  NO_OP_PSO_VERTEX_COUNT_INIT.expectedCave.copy(
    bytes,
    NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset
  );
  CREATE_STATE_OBJECT_RETURN_TRAP.expectedOriginal.copy(
    bytes,
    CREATE_STATE_OBJECT_RETURN_TRAP.offset
  );
  STATE_OBJECT_PARSER_RESULT_TRAP.expectedOriginal.copy(
    bytes,
    STATE_OBJECT_PARSER_RESULT_TRAP.offset
  );
  STATE_OBJECT_PARSER_RESULT_TRAP.expectedCave.copy(
    bytes,
    STATE_OBJECT_PARSER_RESULT_TRAP.caveOffset
  );
  STATE_OBJECT_INHERITANCE_RESULT_TRAP.expectedOriginal.copy(
    bytes,
    STATE_OBJECT_INHERITANCE_RESULT_TRAP.offset
  );
  for (const site of COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES) {
    site.expectedInstruction.copy(bytes, site.instructionOffset);
  }
  for (const site of CREATE_FUNCTION_NULL_ORIGIN_SITES) {
    site.predecessorInstruction.copy(bytes, site.predecessorOffset);
    site.expectedInstruction.copy(bytes, site.instructionOffset);
  }
  IR_COMPILER_LINK_NULL_TRAP.predecessorInstruction.copy(
    bytes,
    IR_COMPILER_LINK_NULL_TRAP.predecessorOffset
  );
  IR_COMPILER_LINK_NULL_TRAP.expectedInstruction.copy(
    bytes,
    IR_COMPILER_LINK_NULL_TRAP.instructionOffset
  );
  for (const site of STATE_OBJECT_FAILURE_SITES) {
    site.expectedInstruction.copy(bytes, site.instructionOffset);
  }
  return bytes;
}

describe("D3DMetal RTXGI failure tag patch", () => {
  it("reports truncated inputs as unknown without throwing", () => {
    const inspection = inspectD3DMetalBinary(Buffer.alloc(3));
    assert.equal(inspection.mode, "unknown");
    assert.equal(inspection.vertexBufferCountGuard.state, "unknown");
    assert.deepEqual(
      inspection.sites.map(site => [site.state, site.value]),
      [
        ["unknown", "truncated:"],
        ["unknown", "truncated:"],
        ["unknown", "truncated:"],
        ["unknown", "truncated:"],
      ]
    );
  });

  it("recognizes all four original E_INVALIDARG stores", () => {
    const inspection = inspectD3DMetalBinary(opcodeFixture());
    assert.equal(inspection.vertexBufferCountGuard.state, "original");
    assert.deepEqual(
      inspection.sites.map(site => [site.name, site.state, site.value]),
      [
        ["descriptor-parser", "original", "0x80070057"],
        ["export-config-precheck", "original", "0x80070057"],
        ["pipeline-config-inheritance", "original", "0x80070057"],
        ["shader-config-inheritance", "original", "0x80070057"],
      ]
    );
  });

  it("recognizes the exact fixed-size vertex count guard", () => {
    assert.equal(
      VERTEX_BUFFER_COUNT_GUARD.expectedOriginal.length,
      VERTEX_BUFFER_COUNT_GUARD.diagnostic.length
    );
    const fixture = opcodeFixture();
    VERTEX_BUFFER_COUNT_GUARD.diagnostic.copy(
      fixture,
      VERTEX_BUFFER_COUNT_GUARD.offset
    );
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.vertexBufferCountGuard.state, "diagnostic");
    assert.equal(inspection.vertexBufferCountGuard.trapOffset, 0x0e1b13);
    assert.deepEqual(
      VERTEX_BUFFER_COUNT_GUARD.diagnostic.subarray(0, 8),
      Buffer.from([0x41, 0x83, 0xff, 0x20, 0x76, 0x02, 0x0f, 0x0b])
    );
  });

  it("recognizes the combined guard and four failure tags", () => {
    const fixture = opcodeFixture();
    VERTEX_BUFFER_COUNT_GUARD.diagnostic.copy(
      fixture,
      VERTEX_BUFFER_COUNT_GUARD.offset
    );
    for (const site of STATE_OBJECT_FAILURE_SITES) {
      fixture.writeUInt32LE(site.taggedHresult >>> 0, site.immediateOffset);
    }
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "vertex-count-guard+failure-tags");
    assert.deepEqual(
      inspection.sites.map(site => site.state),
      ["tagged", "tagged", "tagged", "tagged"]
    );
  });

  it("recognizes four fixed-width state-object traps", () => {
    const fixture = opcodeFixture();
    for (const site of STATE_OBJECT_FAILURE_SITES) {
      assert.equal(site.trapInstruction.length, site.expectedInstruction.length);
      site.trapInstruction.copy(fixture, site.instructionOffset);
    }
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "state-object-traps");
    assert.deepEqual(
      inspection.sites.map(site => site.state),
      ["trap", "trap", "trap", "trap"]
    );
  });

  it("recognizes the isolated no-op PSO producer initialization", () => {
    const fixture = opcodeFixture();
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedEdge.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset
    );
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedCave.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset
    );
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "no-op-pso-vertex-count-init");
    assert.equal(inspection.noOpPsoVertexCountInit.state, "initialized");
  });

  it("recognizes the isolated CreateStateObject return trap", () => {
    const fixture = opcodeFixture();
    CREATE_STATE_OBJECT_RETURN_TRAP.diagnostic.copy(
      fixture,
      CREATE_STATE_OBJECT_RETURN_TRAP.offset
    );
    CREATE_STATE_OBJECT_RETURN_TRAP.diagnosticCave.copy(
      fixture,
      CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset
    );
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "failed-create-state-object-return-trap");
    assert.equal(inspection.createStateObjectReturnTrap.state, "diagnostic");
  });

  it("recognizes the combined parser-phase discriminator", () => {
    const fixture = opcodeFixture();
    STATE_OBJECT_PARSER_RESULT_TRAP.diagnostic.copy(
      fixture,
      STATE_OBJECT_PARSER_RESULT_TRAP.offset
    );
    STATE_OBJECT_PARSER_RESULT_TRAP.diagnosticCave.copy(
      fixture,
      STATE_OBJECT_PARSER_RESULT_TRAP.caveOffset
    );
    CREATE_STATE_OBJECT_RETURN_TRAP.diagnostic.copy(
      fixture,
      CREATE_STATE_OBJECT_RETURN_TRAP.offset
    );
    CREATE_STATE_OBJECT_RETURN_TRAP.diagnosticCave.copy(
      fixture,
      CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset
    );
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "state-object-parser-phase-trap");
    assert.equal(inspection.stateObjectParserResultTrap.state, "diagnostic");
    assert.equal(inspection.createStateObjectReturnTrap.state, "diagnostic");
  });

  it("recognizes the combined inheritance-result discriminator", () => {
    const fixture = opcodeFixture();
    STATE_OBJECT_INHERITANCE_RESULT_TRAP.diagnostic.copy(
      fixture,
      STATE_OBJECT_INHERITANCE_RESULT_TRAP.offset
    );
    STATE_OBJECT_INHERITANCE_RESULT_TRAP.diagnosticCave.copy(
      fixture,
      STATE_OBJECT_INHERITANCE_RESULT_TRAP.caveOffset
    );
    CREATE_STATE_OBJECT_RETURN_TRAP.diagnostic.copy(
      fixture,
      CREATE_STATE_OBJECT_RETURN_TRAP.offset
    );
    CREATE_STATE_OBJECT_RETURN_TRAP.diagnosticCave.copy(
      fixture,
      CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset
    );
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "state-object-inheritance-result-trap");
    assert.equal(
      inspection.stateObjectInheritanceResultTrap.state,
      "diagnostic"
    );
    assert.equal(inspection.createStateObjectReturnTrap.state, "diagnostic");
  });

  it("recognizes the no-op fix with three compile-export store traps", () => {
    const fixture = opcodeFixture();
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedEdge.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset
    );
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedCave.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset
    );
    for (const site of COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES) {
      site.trapInstruction.copy(fixture, site.instructionOffset);
    }
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "noop-fix+compile-export-store-traps");
    assert.deepEqual(
      inspection.compileNewResolvedExportFailureSites.map(site => site.state),
      ["trap", "trap", "trap"]
    );
    assert.equal(inspection.createStateObjectReturnTrap.state, "original");
  });

  it("recognizes the no-op fix with three fail-closed CreateFunction traps", () => {
    const fixture = opcodeFixture();
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedEdge.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset
    );
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedCave.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset
    );
    for (const site of CREATE_FUNCTION_NULL_ORIGIN_SITES) {
      site.diagnosticInstruction.copy(fixture, site.instructionOffset);
    }
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(inspection.mode, "noop-fix+create-function-null-traps");
    assert.deepEqual(
      inspection.createFunctionNullOriginSites.map(site => site.state),
      ["trap", "trap", "trap"]
    );
    assert.deepEqual(
      inspection.compileNewResolvedExportFailureSites.map(site => site.state),
      ["original", "original", "original"]
    );
  });

  it("recognizes the IR-link null trap with outer CompileRT fallback", () => {
    const fixture = opcodeFixture();
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedEdge.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset
    );
    NO_OP_PSO_VERTEX_COUNT_INIT.patchedCave.copy(
      fixture,
      NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset
    );
    IR_COMPILER_LINK_NULL_TRAP.diagnosticInstruction.copy(
      fixture,
      IR_COMPILER_LINK_NULL_TRAP.instructionOffset
    );
    CREATE_FUNCTION_NULL_ORIGIN_SITES[2].diagnosticInstruction.copy(
      fixture,
      CREATE_FUNCTION_NULL_ORIGIN_SITES[2].instructionOffset
    );
    const inspection = inspectD3DMetalBinary(fixture);
    assert.equal(
      inspection.mode,
      "noop-fix+ir-link-null-with-compile-rt-fallback"
    );
    assert.equal(inspection.irCompilerLinkNullTrap.state, "trap");
    assert.deepEqual(
      inspection.createFunctionNullOriginSites.map(site => site.state),
      ["original", "original", "trap"]
    );
  });

  it(
    "patches only the no-op failure edge and its alignment cave",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyNoOpPsoVertexCountInit(original);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        noOpFixRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedEdge.length) ||
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedCave.length)
        )
      );
    }
  );

  it(
    "patches only the verified CreateStateObject normal-return jump",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyCreateStateObjectReturnTrap(original);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        stateObjectReturnTrapRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= CREATE_STATE_OBJECT_RETURN_TRAP.offset &&
              offset <
                CREATE_STATE_OBJECT_RETURN_TRAP.offset +
                  CREATE_STATE_OBJECT_RETURN_TRAP.expectedOriginal.length) ||
            (offset >= CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset &&
              offset <
                CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset +
                  CREATE_STATE_OBJECT_RETURN_TRAP.expectedCave.length)
        )
      );
    }
  );

  it(
    "patches only the parser discriminator and final failure return",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyStateObjectParserPhaseTrap(original);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        stateObjectParserPhaseTrapRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= STATE_OBJECT_PARSER_RESULT_TRAP.offset &&
              offset <
                STATE_OBJECT_PARSER_RESULT_TRAP.offset +
                  STATE_OBJECT_PARSER_RESULT_TRAP.expectedOriginal.length) ||
            (offset >= STATE_OBJECT_PARSER_RESULT_TRAP.caveOffset &&
              offset <
                STATE_OBJECT_PARSER_RESULT_TRAP.caveOffset +
                  STATE_OBJECT_PARSER_RESULT_TRAP.expectedCave.length) ||
            (offset >= CREATE_STATE_OBJECT_RETURN_TRAP.offset &&
              offset <
                CREATE_STATE_OBJECT_RETURN_TRAP.offset +
                  CREATE_STATE_OBJECT_RETURN_TRAP.expectedOriginal.length) ||
            (offset >= CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset &&
              offset <
                CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset +
                  CREATE_STATE_OBJECT_RETURN_TRAP.expectedCave.length)
        )
      );
    }
  );

  it(
    "patches only the inheritance result and final failure return",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyStateObjectInheritanceResultTrap(original);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        stateObjectInheritanceResultTrapRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= STATE_OBJECT_INHERITANCE_RESULT_TRAP.offset &&
              offset <
                STATE_OBJECT_INHERITANCE_RESULT_TRAP.offset +
                  STATE_OBJECT_INHERITANCE_RESULT_TRAP.expectedOriginal.length) ||
            (offset >= STATE_OBJECT_INHERITANCE_RESULT_TRAP.caveOffset &&
              offset <
                STATE_OBJECT_INHERITANCE_RESULT_TRAP.caveOffset +
                  STATE_OBJECT_INHERITANCE_RESULT_TRAP.expectedCave.length) ||
            (offset >= CREATE_STATE_OBJECT_RETURN_TRAP.offset &&
              offset <
                CREATE_STATE_OBJECT_RETURN_TRAP.offset +
                  CREATE_STATE_OBJECT_RETURN_TRAP.expectedOriginal.length) ||
            (offset >= CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset &&
              offset <
                CREATE_STATE_OBJECT_RETURN_TRAP.caveOffset +
                  CREATE_STATE_OBJECT_RETURN_TRAP.expectedCave.length)
        )
      );
    }
  );

  it(
    "patches only the validated no-op fix and three compile-export stores",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyNoOpFixAndCompileExportStoreTraps(original);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        noOpFixCompileExportStoreTrapsRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedEdge.length) ||
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedCave.length) ||
            COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES.some(
              site =>
                offset >= site.instructionOffset &&
                offset <
                  site.instructionOffset + site.expectedInstruction.length
            )
        )
      );
      assert.deepEqual(
        patched.subarray(0x69893, 0x69899),
        CREATE_STATE_OBJECT_RETURN_TRAP.expectedOriginal
      );
      assert.equal(patched[0x36f8a2], 0x00);
    }
  );

  it(
    "patches only the no-op fix and three CreateFunction null branches",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyNoOpFixAndCreateFunctionNullTraps(original);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        noOpFixCreateFunctionNullTrapsRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedEdge.length) ||
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedCave.length) ||
            CREATE_FUNCTION_NULL_ORIGIN_SITES.some(
              site =>
                offset >= site.instructionOffset &&
                offset <
                  site.instructionOffset + site.expectedInstruction.length
            )
        )
      );
      for (const site of COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES) {
        assert.deepEqual(
          patched.subarray(
            site.instructionOffset,
            site.instructionOffset + site.expectedInstruction.length
          ),
          site.expectedInstruction
        );
      }
    }
  );

  it(
    "patches only the no-op fix, fresh IR link null, and outer fallback",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyNoOpFixAndIrLinkNullWithCompileRtFallback(original);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        noOpFixIrLinkFallbackRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      const outer = CREATE_FUNCTION_NULL_ORIGIN_SITES[2];
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.edgeOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedEdge.length) ||
            (offset >= NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset &&
              offset <
                NO_OP_PSO_VERTEX_COUNT_INIT.caveOffset +
                  NO_OP_PSO_VERTEX_COUNT_INIT.expectedCave.length) ||
            (offset >= IR_COMPILER_LINK_NULL_TRAP.instructionOffset &&
              offset <
                IR_COMPILER_LINK_NULL_TRAP.instructionOffset +
                  IR_COMPILER_LINK_NULL_TRAP.expectedInstruction.length) ||
            (offset >= outer.instructionOffset &&
              offset < outer.instructionOffset + outer.expectedInstruction.length)
        )
      );
      for (const site of CREATE_FUNCTION_NULL_ORIGIN_SITES.slice(0, 2)) {
        assert.deepEqual(
          patched.subarray(
            site.instructionOffset,
            site.instructionOffset + site.expectedInstruction.length
          ),
          site.expectedInstruction
        );
      }
    }
  );

  it(
    "changes only the four declared RT failure instructions in the real binary",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyStateObjectTraps(original);
      assert.equal(patched.length, original.length);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        trapRawSha256
      );
      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.ok(changedOffsets.length > 0);
      assert.ok(
        changedOffsets.every(offset =>
          STATE_OBJECT_FAILURE_SITES.some(
            site =>
              offset >= site.instructionOffset &&
              offset < site.instructionOffset + site.expectedInstruction.length
          )
        )
      );
    }
  );

  it(
    "changes only the five declared regions in the real pristine binary",
    { skip: !existsSync(pristineBinary) },
    () => {
      const original = readFileSync(pristineBinary);
      const patched = applyGuardAndFailureTags(original);
      assert.equal(patched.length, original.length);
      assert.equal(
        createHash("sha256").update(patched).digest("hex"),
        combinedRawSha256
      );

      const changedOffsets = [];
      for (let offset = 0; offset < original.length; offset += 1) {
        if (original[offset] !== patched[offset]) changedOffsets.push(offset);
      }
      assert.equal(changedOffsets.length, 63);
      assert.ok(
        changedOffsets.every(
          offset =>
            (offset >= VERTEX_BUFFER_COUNT_GUARD.offset &&
              offset < VERTEX_BUFFER_COUNT_GUARD.resumeOffset) ||
            STATE_OBJECT_FAILURE_SITES.some(
              site =>
                offset >= site.immediateOffset &&
                offset < site.immediateOffset + 4
            )
        )
      );
    }
  );

  it("refuses an arbitrary binary even when opcode fragments match", () => {
    assert.notEqual(
      inspectD3DMetalBinary(opcodeFixture()).sha256,
      D3DMETAL_4_0_BETA_2_SHA256
    );
    assert.throws(
      () => applyFailureTags(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
    assert.throws(
      () => applyVertexBufferCountGuard(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
    assert.throws(
      () => applyGuardAndFailureTags(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
    assert.throws(
      () => applyStateObjectTraps(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
    assert.throws(
      () => applyNoOpPsoVertexCountInit(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
    assert.throws(
      () => applyCreateStateObjectReturnTrap(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
    assert.throws(
      () => applyNoOpFixAndCreateFunctionNullTraps(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
    assert.throws(
      () => applyNoOpFixAndIrLinkNullWithCompileRtFallback(opcodeFixture()),
      /Refusing to patch unrecognized D3DMetal binary/
    );
  });
});

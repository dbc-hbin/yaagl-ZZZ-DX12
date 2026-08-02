#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const D3DMETAL_4_0_BETA_2_SHA256 =
  "f5b56df1b8fe8b364dd9530651a3769c8aed948bd343be3b4510604d503e2bad";

const originalHresult = Buffer.from([0x57, 0x00, 0x07, 0x80]);

/**
 * SetRenderVertexBuffers() reads a zero-extended 16-bit vertex-buffer count
 * from the current graphics PSO at +0x28c. GPTK 4.0b2 then uses that count to
 * allocate and index an internal table without checking the D3D12 IA limit.
 *
 * Three real crash dumps reached the same loop with counts 65535, 32709, and
 * 65535. The diagnostic replacement keeps the zero and 1..32 paths intact and
 * executes UD2 before allocation for any unsigned value greater than 32.
 *
 * The replacement is exactly the same size as the original basic-block tail.
 * It needs no code cave and resumes at the original first table load.
 */
export const VERTEX_BUFFER_COUNT_GUARD = {
  name: "set-render-vertex-buffers-count",
  offset: 0x0e1b0d,
  resumeOffset: 0x0e1b43,
  trapOffset: 0x0e1b13,
  expectedOriginal: Buffer.from([
    0x45, 0x85, 0xff, 0x0f, 0x84, 0x80, 0x00, 0x00, 0x00, 0x48, 0x89, 0xfb,
    0x48, 0x8b, 0x77, 0x78, 0x44, 0x89, 0xfa, 0xc1, 0xe2, 0x04, 0x49, 0x89,
    0xe6, 0x4c, 0x89, 0xf7, 0xe8, 0xee, 0x0f, 0xff, 0xff, 0x49, 0x8b, 0x06,
    0x49, 0x8b, 0x4e, 0x08, 0x41, 0xc1, 0xe7, 0x03, 0x4b, 0x8d, 0x14, 0xbf,
    0x48, 0x83, 0xc0, 0x0c, 0x31, 0xf6,
  ]),
  diagnostic: Buffer.from([
    // cmp $32, %r15d; jbe valid; ud2
    0x41, 0x83, 0xff, 0x20, 0x76, 0x02, 0x0f, 0x0b,
    // test %r15d, %r15d; je 0xe1b96
    0x45, 0x85, 0xff, 0x74, 0x7c,
    // Preserve the original command-list and transient-allocation setup.
    0x48, 0x89, 0xfb, 0x48, 0x8b, 0x77, 0x78,
    // imul $16, %r15d, %edx; mov %rsp, %rdi
    0x41, 0x6b, 0xd7, 0x10, 0x48, 0x89, 0xe7,
    // call AllocateTransientMemory; read the same two stack output fields.
    0xe8, 0xef, 0x0f, 0xff, 0xff, 0x48, 0x8b, 0x04, 0x24, 0x48, 0x8b, 0x4c,
    0x24, 0x08,
    // Reproduce the original loop setup and resume at 0xe1b43.
    0x41, 0x6b, 0xd7, 0x28, 0x48, 0x83, 0xc0, 0x0c, 0x31, 0xf6, 0x90, 0x90,
    0x90,
  ]),
};

/**
 * A failed graphics-stage compilation jumps directly to the no-op PSO path,
 * skipping InitVertexState's canonical 16-bit zero at object +0x28c. Redirect
 * only that failure edge through otherwise-unused inter-function alignment
 * padding, initialize the field, and resume at the original no-op block.
 */
export const NO_OP_PSO_VERTEX_COUNT_INIT = {
  name: "no-op-pso-vertex-count-init",
  edgeOffset: 0x10f6d5,
  expectedEdge: Buffer.from([0x0f, 0x84, 0xbf, 0x00, 0x00, 0x00]),
  // Preserve the original JE and retarget only its rel32 displacement.
  patchedEdge: Buffer.from([0x0f, 0x84, 0xbf, 0x01, 0x26, 0x00]),
  caveOffset: 0x36f89a,
  expectedCave: Buffer.from(Array(15).fill(0x00)),
  patchedCave: Buffer.from([
    // movw $0, 0x28c(%rbx)
    0x66, 0xc7, 0x83, 0x8c, 0x02, 0x00, 0x00, 0x00, 0x00,
    // jmp 0x10f79a; preserve the final alignment byte.
    0xe9, 0xf2, 0xfe, 0xd9, 0xff, 0x00,
  ]),
  resumeOffset: 0x10f79a,
};

/**
 * The normal state-object path materializes its final HRESULT at 0x69893.
 * Redirect that complete six-byte tail through alignment padding: successful
 * HRESULTs resume at the original epilogue, while only failures execute UD2.
 */
export const CREATE_STATE_OBJECT_RETURN_TRAP = {
  name: "failed-create-state-object-return",
  offset: 0x69893,
  expectedOriginal: Buffer.from([0x8b, 0x44, 0x24, 0x0c, 0xeb, 0x0f]),
  diagnostic: Buffer.from([0xe9, 0x02, 0x60, 0x30, 0x00, 0x90]),
  caveOffset: 0x36f89a,
  expectedCave: Buffer.from(Array(15).fill(0x00)),
  diagnosticCave: Buffer.from([
    // mov 0xc(%rsp), %eax; test %eax, %eax; je success; ud2
    0x8b, 0x44, 0x24, 0x0c, 0x85, 0xc0, 0x74, 0x02, 0x0f, 0x0b,
    // success: jmp 0x698a8
    0xe9, 0xff, 0x9f, 0xcf, 0xff,
  ]),
  trapOffset: 0x36f8a2,
  resumeOffset: 0x698a8,
};

/**
 * The first externally visible parser-result check occurs immediately after
 * ParseStateObjectInto. Preserve the success fallthrough and redirect only the
 * nonzero-status branch to a unique two-byte UD2 in unused alignment padding.
 */
export const STATE_OBJECT_PARSER_RESULT_TRAP = {
  name: "state-object-parser-result",
  offset: 0x12170a,
  expectedOriginal: Buffer.from([0x0f, 0x85, 0x8f, 0x00, 0x00, 0x00]),
  diagnostic: Buffer.from([0x0f, 0x85, 0x8b, 0xdf, 0x24, 0x00]),
  caveOffset: 0x36f69b,
  expectedCave: Buffer.from([0x90, 0x00]),
  diagnosticCave: Buffer.from([0x0f, 0x0b]),
  trapOffset: 0x36f69b,
  successOffset: 0x121710,
};

/**
 * The first external status check after config inheritance is a six-byte
 * cmp/jne region. Move that exact comparison into a cave so a nonzero status
 * traps uniquely while zero resumes at the original 0x12172e fallthrough.
 */
export const STATE_OBJECT_INHERITANCE_RESULT_TRAP = {
  name: "state-object-inheritance-result",
  offset: 0x121728,
  expectedOriginal: Buffer.from([0x41, 0x83, 0x3f, 0x00, 0x75, 0x71]),
  diagnostic: Buffer.from([0xe9, 0x6e, 0xdf, 0x24, 0x00, 0x90]),
  caveOffset: 0x36f69b,
  expectedCave: Buffer.from([0x90, ...Array(12).fill(0x00)]),
  diagnosticCave: Buffer.from([
    // cmp dword ptr [r15], 0; je success; ud2
    0x41, 0x83, 0x3f, 0x00, 0x74, 0x02, 0x0f, 0x0b,
    // success: jmp 0x12172e
    0xe9, 0x86, 0x20, 0xdb, 0xff,
  ]),
  trapOffset: 0x36f6a1,
  successOffset: 0x12172e,
};

/**
 * These are the only four direct E_INVALIDARG stores on the
 * D3D12StateObject construction path in GPTK 4.0 beta 2.
 *
 * The tags remain failing HRESULTs. They identify the rejecting stage without
 * allowing an invalid state object to reach DispatchRays.
 */
export const STATE_OBJECT_FAILURE_SITES = [
  {
    name: "descriptor-parser",
    instructionOffset: 0x0ae4ab,
    immediateOffset: 0x0ae4ae,
    expectedInstruction: Buffer.from([
      0x41, 0xc7, 0x01, 0x57, 0x00, 0x07, 0x80,
    ]),
    taggedHresult: 0x8004d001,
    trapInstruction: Buffer.from([0x0f, 0x0b, 0x90, 0x90, 0x90, 0x90, 0x90]),
  },
  {
    name: "export-config-precheck",
    instructionOffset: 0x121798,
    immediateOffset: 0x12179b,
    expectedInstruction: Buffer.from([
      0x41, 0xc7, 0x07, 0x57, 0x00, 0x07, 0x80,
    ]),
    taggedHresult: 0x8004d002,
    trapInstruction: Buffer.from([0x0f, 0x0b, 0x90, 0x90, 0x90, 0x90, 0x90]),
  },
  {
    name: "pipeline-config-inheritance",
    instructionOffset: 0x12275f,
    immediateOffset: 0x122761,
    expectedInstruction: Buffer.from([0xc7, 0x00, 0x57, 0x00, 0x07, 0x80]),
    taggedHresult: 0x8004d003,
    trapInstruction: Buffer.from([0x0f, 0x0b, 0x90, 0x90, 0x90, 0x90]),
  },
  {
    name: "shader-config-inheritance",
    instructionOffset: 0x122813,
    immediateOffset: 0x122815,
    expectedInstruction: Buffer.from([0xc7, 0x00, 0x57, 0x00, 0x07, 0x80]),
    taggedHresult: 0x8004d004,
    trapInstruction: Buffer.from([0x0f, 0x0b, 0x90, 0x90, 0x90, 0x90]),
  },
];

/**
 * CompileNewResolvedExports writes E_INVALIDARG through its output-only status
 * pointer at exactly these three null-result error blocks. Replace the complete
 * six-byte stores with unique in-place traps; the instruction offsets make the
 * first reached block unambiguous without a code cave.
 */
export const COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES = [
  {
    name: "store-a",
    instructionOffset: 0x1234ab,
    predecessorOffset: 0x122ec3,
  },
  {
    name: "store-b",
    instructionOffset: 0x123920,
    predecessorOffset: 0x123320,
  },
  {
    name: "store-c",
    instructionOffset: 0x123955,
    predecessorOffset: 0x12365f,
  },
].map(site => ({
  ...site,
  expectedInstruction: Buffer.from([0xc7, 0x00, 0x57, 0x00, 0x07, 0x80]),
  trapInstruction: Buffer.from([0x0f, 0x0b, 0x90, 0x90, 0x90, 0x90]),
}));

/**
 * CreateFunction can publish a null shared_ptr from exactly three primitive
 * checks. Invert each six-byte near JE so the non-null path still lands at the
 * original fallthrough while the null path executes a distinct UD2. The short
 * backward jump makes exception continuation fail closed instead of allowing
 * a null result to enter the former success path.
 */
export const CREATE_FUNCTION_NULL_ORIGIN_SITES = [
  {
    name: "resolved-subobject-null",
    instructionOffset: 0x123bf0,
    expectedInstruction: Buffer.from([0x0f, 0x84, 0xd8, 0x00, 0x00, 0x00]),
    predecessorInstruction: Buffer.from([0x4d, 0x85, 0xed]),
    predecessorOffset: 0x123bed,
    originalFailureTarget: 0x123cce,
    successOffset: 0x123bf6,
    trapOffset: 0x123bf2,
  },
  {
    name: "function-dynamic-cast-null",
    instructionOffset: 0x123c11,
    expectedInstruction: Buffer.from([0x0f, 0x84, 0xb7, 0x00, 0x00, 0x00]),
    predecessorInstruction: Buffer.from([0x48, 0x85, 0xc0]),
    predecessorOffset: 0x123c0e,
    originalFailureTarget: 0x123cce,
    successOffset: 0x123c17,
    trapOffset: 0x123c13,
  },
  {
    name: "compile-rt-function-null",
    instructionOffset: 0x123f26,
    expectedInstruction: Buffer.from([0x0f, 0x84, 0xc1, 0x00, 0x00, 0x00]),
    predecessorInstruction: Buffer.from([0x4d, 0x85, 0xed]),
    predecessorOffset: 0x123f23,
    originalFailureTarget: 0x123fed,
    successOffset: 0x123f2c,
    trapOffset: 0x123f28,
  },
].map(site => ({
  ...site,
  diagnosticInstruction: Buffer.from([0x75, 0x04, 0x0f, 0x0b, 0xeb, 0xfc]),
}));

/**
 * Fresh RT compilation has one normal null producer: the result of
 * IRCompilerAllocCompileAndLink. Keep the outer CompileRTFunction-null trap as
 * a fallback so a null that bypasses this fresh-link branch remains observable.
 */
export const IR_COMPILER_LINK_NULL_TRAP = {
  name: "ir-compiler-link-null",
  instructionOffset: 0x9a132,
  predecessorOffset: 0x9a12f,
  predecessorInstruction: Buffer.from([0x48, 0x85, 0xc0]),
  expectedInstruction: Buffer.from([0x0f, 0x84, 0x03, 0x01, 0x00, 0x00]),
  diagnosticInstruction: Buffer.from([0x75, 0x04, 0x0f, 0x0b, 0xeb, 0xfc]),
  originalFailureTarget: 0x9a23b,
  successOffset: 0x9a138,
  trapOffset: 0x9a134,
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hresultBytes(value) {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
}

function equalAt(bytes, offset, expected) {
  return bytes.subarray(offset, offset + expected.length).equals(expected);
}

export function inspectD3DMetalBinary(bytes) {
  const hash = sha256(bytes);
  const guardBytes = bytes.subarray(
    VERTEX_BUFFER_COUNT_GUARD.offset,
    VERTEX_BUFFER_COUNT_GUARD.resumeOffset
  );
  const guardComplete =
    guardBytes.length === VERTEX_BUFFER_COUNT_GUARD.expectedOriginal.length;
  const guardState = !guardComplete
    ? "unknown"
    : guardBytes.equals(VERTEX_BUFFER_COUNT_GUARD.expectedOriginal)
    ? "original"
    : guardBytes.equals(VERTEX_BUFFER_COUNT_GUARD.diagnostic)
    ? "diagnostic"
    : "unknown";
  const noOpInit = NO_OP_PSO_VERTEX_COUNT_INIT;
  const noOpEdge = bytes.subarray(
    noOpInit.edgeOffset,
    noOpInit.edgeOffset + noOpInit.expectedEdge.length
  );
  const noOpCave = bytes.subarray(
    noOpInit.caveOffset,
    noOpInit.caveOffset + noOpInit.expectedCave.length
  );
  const returnTrap = CREATE_STATE_OBJECT_RETURN_TRAP;
  const returnBytes = bytes.subarray(
    returnTrap.offset,
    returnTrap.offset + returnTrap.expectedOriginal.length
  );
  const returnCave = bytes.subarray(
    returnTrap.caveOffset,
    returnTrap.caveOffset + returnTrap.expectedCave.length
  );
  const returnTrapState =
    returnBytes.equals(returnTrap.expectedOriginal) &&
    (returnCave.equals(returnTrap.expectedCave) ||
      returnCave.equals(noOpInit.patchedCave))
      ? "original"
      : returnBytes.equals(returnTrap.diagnostic) &&
        returnCave.equals(returnTrap.diagnosticCave)
      ? "diagnostic"
      : "unknown";
  const parserTrap = STATE_OBJECT_PARSER_RESULT_TRAP;
  const inheritanceTrap = STATE_OBJECT_INHERITANCE_RESULT_TRAP;
  const parserBytes = bytes.subarray(
    parserTrap.offset,
    parserTrap.offset + parserTrap.expectedOriginal.length
  );
  const parserCave = bytes.subarray(
    parserTrap.caveOffset,
    parserTrap.caveOffset + parserTrap.expectedCave.length
  );
  const inheritanceBytes = bytes.subarray(
    inheritanceTrap.offset,
    inheritanceTrap.offset + inheritanceTrap.expectedOriginal.length
  );
  const inheritanceCave = bytes.subarray(
    inheritanceTrap.caveOffset,
    inheritanceTrap.caveOffset + inheritanceTrap.expectedCave.length
  );
  const inheritanceTrapState =
    inheritanceBytes.equals(inheritanceTrap.expectedOriginal) &&
    (inheritanceCave.equals(inheritanceTrap.expectedCave) ||
      (parserBytes.equals(parserTrap.diagnostic) &&
        inheritanceCave.subarray(0, parserTrap.diagnosticCave.length).equals(
          parserTrap.diagnosticCave
        ) &&
        inheritanceCave
          .subarray(parserTrap.diagnosticCave.length)
          .equals(
            inheritanceTrap.expectedCave.subarray(
              parserTrap.diagnosticCave.length
            )
          )))
      ? "original"
      : inheritanceBytes.equals(inheritanceTrap.diagnostic) &&
        inheritanceCave.equals(inheritanceTrap.diagnosticCave)
      ? "diagnostic"
      : "unknown";
  const parserTrapState =
    parserBytes.equals(parserTrap.expectedOriginal) &&
    (parserCave.equals(parserTrap.expectedCave) ||
      (inheritanceBytes.equals(inheritanceTrap.diagnostic) &&
        parserCave.equals(
          inheritanceTrap.diagnosticCave.subarray(0, parserCave.length)
        )))
      ? "original"
      : parserBytes.equals(parserTrap.diagnostic) &&
        parserCave.equals(parserTrap.diagnosticCave)
      ? "diagnostic"
      : "unknown";
  const noOpState =
    noOpEdge.equals(noOpInit.expectedEdge) &&
    (noOpCave.equals(noOpInit.expectedCave) ||
      (returnTrapState === "diagnostic" &&
        noOpCave.equals(returnTrap.diagnosticCave)))
      ? "original"
      : noOpEdge.equals(noOpInit.patchedEdge) &&
        noOpCave.equals(noOpInit.patchedCave)
      ? "initialized"
      : "unknown";
  const sites = STATE_OBJECT_FAILURE_SITES.map(site => {
    const instruction = bytes.subarray(
      site.instructionOffset,
      site.instructionOffset + site.expectedInstruction.length
    );
    const current = bytes.subarray(
      site.immediateOffset,
      site.immediateOffset + 4
    );
    const complete = current.length === 4;
    const instructionComplete =
      instruction.length === site.expectedInstruction.length;
    const state = !instructionComplete
      ? "unknown"
      : instruction.equals(site.trapInstruction)
      ? "trap"
      : !complete
      ? "unknown"
      : current.equals(originalHresult)
      ? "original"
      : current.equals(hresultBytes(site.taggedHresult))
      ? "tagged"
      : "unknown";
    return {
      name: site.name,
      offset: site.immediateOffset,
      state,
      value: complete
        ? `0x${current.readUInt32LE(0).toString(16).padStart(8, "0")}`
        : `truncated:${current.toString("hex")}`,
    };
  });
  const states = new Set(sites.map(site => site.state));
  const allOriginal = states.size === 1 && states.has("original");
  const allTagged = states.size === 1 && states.has("tagged");
  const allTraps = states.size === 1 && states.has("trap");
  const compileNewResolvedExportFailureSites =
    COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES.map(site => {
      const instruction = bytes.subarray(
        site.instructionOffset,
        site.instructionOffset + site.expectedInstruction.length
      );
      const state = instruction.equals(site.expectedInstruction)
        ? "original"
        : instruction.equals(site.trapInstruction)
        ? "trap"
        : "unknown";
      return {
        name: site.name,
        instructionOffset: site.instructionOffset,
        predecessorOffset: site.predecessorOffset,
        state,
        value: instruction.toString("hex"),
      };
    });
  const compileStates = new Set(
    compileNewResolvedExportFailureSites.map(site => site.state)
  );
  const allCompileOriginal =
    compileStates.size === 1 && compileStates.has("original");
  const allCompileTraps =
    compileStates.size === 1 && compileStates.has("trap");
  const createFunctionNullOriginSites = CREATE_FUNCTION_NULL_ORIGIN_SITES.map(
    site => {
      const instruction = bytes.subarray(
        site.instructionOffset,
        site.instructionOffset + site.expectedInstruction.length
      );
      const predecessor = bytes.subarray(
        site.predecessorOffset,
        site.predecessorOffset + site.predecessorInstruction.length
      );
      const state =
        !predecessor.equals(site.predecessorInstruction)
          ? "unknown"
          : instruction.equals(site.expectedInstruction)
          ? "original"
          : instruction.equals(site.diagnosticInstruction)
          ? "trap"
          : "unknown";
      return {
        name: site.name,
        instructionOffset: site.instructionOffset,
        originalFailureTarget: site.originalFailureTarget,
        successOffset: site.successOffset,
        trapOffset: site.trapOffset,
        state,
        value: instruction.toString("hex"),
      };
    }
  );
  const createFunctionStates = new Set(
    createFunctionNullOriginSites.map(site => site.state)
  );
  const allCreateFunctionOriginal =
    createFunctionStates.size === 1 && createFunctionStates.has("original");
  const allCreateFunctionTraps =
    createFunctionStates.size === 1 && createFunctionStates.has("trap");
  const outerCompileRtOnly =
    createFunctionNullOriginSites[0].state === "original" &&
    createFunctionNullOriginSites[1].state === "original" &&
    createFunctionNullOriginSites[2].state === "trap";
  const irLink = IR_COMPILER_LINK_NULL_TRAP;
  const irLinkInstruction = bytes.subarray(
    irLink.instructionOffset,
    irLink.instructionOffset + irLink.expectedInstruction.length
  );
  const irLinkPredecessor = bytes.subarray(
    irLink.predecessorOffset,
    irLink.predecessorOffset + irLink.predecessorInstruction.length
  );
  const irCompilerLinkNullTrapState =
    !irLinkPredecessor.equals(irLink.predecessorInstruction)
      ? "unknown"
      : irLinkInstruction.equals(irLink.expectedInstruction)
      ? "original"
      : irLinkInstruction.equals(irLink.diagnosticInstruction)
      ? "trap"
      : "unknown";
  return {
    sha256: hash,
    mode:
      hash === D3DMETAL_4_0_BETA_2_SHA256 &&
      guardState === "original" &&
      noOpState === "original" &&
      returnTrapState === "original" &&
      parserTrapState === "original" &&
      inheritanceTrapState === "original" &&
      irCompilerLinkNullTrapState === "original" &&
      allCreateFunctionOriginal &&
      allCompileOriginal &&
      allOriginal
        ? "original"
        : guardState === "original" &&
          noOpState === "original" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allTagged
        ? "failure-tags"
        : guardState === "diagnostic" &&
          noOpState === "original" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allOriginal
        ? "vertex-count-guard"
        : guardState === "diagnostic" &&
          noOpState === "original" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allTagged
        ? "vertex-count-guard+failure-tags"
        : guardState === "original" &&
          noOpState === "original" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allTraps
        ? "state-object-traps"
        : guardState === "original" &&
          noOpState === "initialized" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allOriginal
        ? "no-op-pso-vertex-count-init"
        : guardState === "original" &&
          noOpState === "original" &&
          returnTrapState === "diagnostic" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allOriginal
        ? "failed-create-state-object-return-trap"
        : guardState === "original" &&
          noOpState === "original" &&
          returnTrapState === "diagnostic" &&
          parserTrapState === "diagnostic" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allOriginal
        ? "state-object-parser-phase-trap"
        : guardState === "original" &&
          noOpState === "original" &&
          returnTrapState === "diagnostic" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "diagnostic" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileOriginal &&
          allOriginal
        ? "state-object-inheritance-result-trap"
        : guardState === "original" &&
          noOpState === "initialized" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionOriginal &&
          allCompileTraps &&
          allOriginal
        ? "noop-fix+compile-export-store-traps"
        : guardState === "original" &&
          noOpState === "initialized" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "original" &&
          allCreateFunctionTraps &&
          allCompileOriginal &&
          allOriginal
        ? "noop-fix+create-function-null-traps"
        : guardState === "original" &&
          noOpState === "initialized" &&
          returnTrapState === "original" &&
          parserTrapState === "original" &&
          inheritanceTrapState === "original" &&
          irCompilerLinkNullTrapState === "trap" &&
          outerCompileRtOnly &&
          allCompileOriginal &&
          allOriginal
        ? "noop-fix+ir-link-null-with-compile-rt-fallback"
        : "unknown",
    vertexBufferCountGuard: {
      offset: VERTEX_BUFFER_COUNT_GUARD.offset,
      resumeOffset: VERTEX_BUFFER_COUNT_GUARD.resumeOffset,
      trapOffset: VERTEX_BUFFER_COUNT_GUARD.trapOffset,
      state: guardState,
      value: guardComplete
        ? guardBytes.toString("hex")
        : `truncated:${guardBytes.toString("hex")}`,
    },
    noOpPsoVertexCountInit: {
      edgeOffset: noOpInit.edgeOffset,
      caveOffset: noOpInit.caveOffset,
      resumeOffset: noOpInit.resumeOffset,
      state: noOpState,
    },
    createStateObjectReturnTrap: {
      offset: returnTrap.offset,
      caveOffset: returnTrap.caveOffset,
      trapOffset: returnTrap.trapOffset,
      resumeOffset: returnTrap.resumeOffset,
      state: returnTrapState,
      value: returnBytes.toString("hex"),
    },
    stateObjectParserResultTrap: {
      offset: parserTrap.offset,
      caveOffset: parserTrap.caveOffset,
      trapOffset: parserTrap.trapOffset,
      successOffset: parserTrap.successOffset,
      state: parserTrapState,
      value: parserBytes.toString("hex"),
    },
    stateObjectInheritanceResultTrap: {
      offset: inheritanceTrap.offset,
      caveOffset: inheritanceTrap.caveOffset,
      trapOffset: inheritanceTrap.trapOffset,
      successOffset: inheritanceTrap.successOffset,
      state: inheritanceTrapState,
      value: inheritanceBytes.toString("hex"),
    },
    compileNewResolvedExportFailureSites,
    createFunctionNullOriginSites,
    irCompilerLinkNullTrap: {
      instructionOffset: irLink.instructionOffset,
      originalFailureTarget: irLink.originalFailureTarget,
      successOffset: irLink.successOffset,
      trapOffset: irLink.trapOffset,
      state: irCompilerLinkNullTrapState,
      value: irLinkInstruction.toString("hex"),
    },
    sites,
  };
}

function requirePristine(bytes) {
  const inspection = inspectD3DMetalBinary(bytes);
  if (inspection.sha256 !== D3DMETAL_4_0_BETA_2_SHA256) {
    throw new Error(
      `Refusing to patch unrecognized D3DMetal binary: ${inspection.sha256}`
    );
  }
  if (inspection.mode !== "original") {
    throw new Error(`Pristine D3DMetal inspection failed: ${inspection.mode}`);
  }
}

function patchFailureTags(patched) {
  for (const site of STATE_OBJECT_FAILURE_SITES) {
    if (!equalAt(patched, site.instructionOffset, site.expectedInstruction)) {
      throw new Error(
        `Opcode mismatch at ${site.name} (0x${site.instructionOffset.toString(
          16
        )})`
      );
    }
    hresultBytes(site.taggedHresult).copy(patched, site.immediateOffset);
  }
}

function patchStateObjectTraps(patched) {
  for (const site of STATE_OBJECT_FAILURE_SITES) {
    if (!equalAt(patched, site.instructionOffset, site.expectedInstruction)) {
      throw new Error(
        `Opcode mismatch at ${site.name} (0x${site.instructionOffset.toString(
          16
        )})`
      );
    }
    if (site.expectedInstruction.length !== site.trapInstruction.length) {
      throw new Error(`State-object trap changes instruction size at ${site.name}`);
    }
    site.trapInstruction.copy(patched, site.instructionOffset);
  }
}

function patchVertexBufferCountGuard(patched) {
  const guard = VERTEX_BUFFER_COUNT_GUARD;
  if (!equalAt(patched, guard.offset, guard.expectedOriginal)) {
    throw new Error(
      `Opcode mismatch at ${guard.name} (0x${guard.offset.toString(16)})`
    );
  }
  if (guard.expectedOriginal.length !== guard.diagnostic.length) {
    throw new Error("Vertex-buffer count guard changes basic-block size");
  }
  guard.diagnostic.copy(patched, guard.offset);
}

function patchNoOpPsoVertexCountInit(patched) {
  const patch = NO_OP_PSO_VERTEX_COUNT_INIT;
  if (!equalAt(patched, patch.edgeOffset, patch.expectedEdge)) {
    throw new Error(`Opcode mismatch at ${patch.name} edge`);
  }
  if (!equalAt(patched, patch.caveOffset, patch.expectedCave)) {
    throw new Error(`Alignment cave mismatch at ${patch.name}`);
  }
  if (patch.expectedEdge.length !== patch.patchedEdge.length) {
    throw new Error("No-op PSO edge patch changes instruction region size");
  }
  if (patch.expectedCave.length !== patch.patchedCave.length) {
    throw new Error("No-op PSO thunk changes alignment cave size");
  }
  patch.patchedEdge.copy(patched, patch.edgeOffset);
  patch.patchedCave.copy(patched, patch.caveOffset);
}

function patchCreateStateObjectReturnTrap(patched) {
  const patch = CREATE_STATE_OBJECT_RETURN_TRAP;
  if (!equalAt(patched, patch.offset, patch.expectedOriginal)) {
    throw new Error(`Opcode mismatch at ${patch.name}`);
  }
  if (!equalAt(patched, patch.caveOffset, patch.expectedCave)) {
    throw new Error(`Alignment cave mismatch at ${patch.name}`);
  }
  if (patch.expectedOriginal.length !== patch.diagnostic.length) {
    throw new Error("CreateStateObject return trap changes instruction size");
  }
  patch.diagnostic.copy(patched, patch.offset);
  patch.diagnosticCave.copy(patched, patch.caveOffset);
}

function patchStateObjectParserResultTrap(patched) {
  const patch = STATE_OBJECT_PARSER_RESULT_TRAP;
  if (!equalAt(patched, patch.offset, patch.expectedOriginal)) {
    throw new Error(`Opcode mismatch at ${patch.name}`);
  }
  if (!equalAt(patched, patch.caveOffset, patch.expectedCave)) {
    throw new Error(`Alignment cave mismatch at ${patch.name}`);
  }
  if (patch.expectedOriginal.length !== patch.diagnostic.length) {
    throw new Error("State-object parser trap changes instruction size");
  }
  if (patch.expectedCave.length !== patch.diagnosticCave.length) {
    throw new Error("State-object parser trap changes alignment cave size");
  }
  patch.diagnostic.copy(patched, patch.offset);
  patch.diagnosticCave.copy(patched, patch.caveOffset);
}

function patchStateObjectInheritanceResultTrap(patched) {
  const patch = STATE_OBJECT_INHERITANCE_RESULT_TRAP;
  if (!equalAt(patched, patch.offset, patch.expectedOriginal)) {
    throw new Error(`Opcode mismatch at ${patch.name}`);
  }
  if (!equalAt(patched, patch.caveOffset, patch.expectedCave)) {
    throw new Error(`Alignment cave mismatch at ${patch.name}`);
  }
  if (patch.expectedOriginal.length !== patch.diagnostic.length) {
    throw new Error("State-object inheritance trap changes instruction size");
  }
  if (patch.expectedCave.length !== patch.diagnosticCave.length) {
    throw new Error("State-object inheritance trap changes alignment cave size");
  }
  patch.diagnostic.copy(patched, patch.offset);
  patch.diagnosticCave.copy(patched, patch.caveOffset);
}

function patchCompileNewResolvedExportFailureStores(patched) {
  for (const site of COMPILE_NEW_RESOLVED_EXPORT_FAILURE_SITES) {
    if (!equalAt(patched, site.instructionOffset, site.expectedInstruction)) {
      throw new Error(`Opcode mismatch at CompileNewResolvedExports ${site.name}`);
    }
    if (site.expectedInstruction.length !== site.trapInstruction.length) {
      throw new Error(`CompileNewResolvedExports trap changes size at ${site.name}`);
    }
    site.trapInstruction.copy(patched, site.instructionOffset);
  }
}

function patchCreateFunctionNullOrigins(patched) {
  for (const site of CREATE_FUNCTION_NULL_ORIGIN_SITES) {
    if (!equalAt(patched, site.predecessorOffset, site.predecessorInstruction)) {
      throw new Error(`Predecessor mismatch at CreateFunction ${site.name}`);
    }
    if (!equalAt(patched, site.instructionOffset, site.expectedInstruction)) {
      throw new Error(`Opcode mismatch at CreateFunction ${site.name}`);
    }
    if (site.expectedInstruction.length !== site.diagnosticInstruction.length) {
      throw new Error(`CreateFunction trap changes size at ${site.name}`);
    }
    site.diagnosticInstruction.copy(patched, site.instructionOffset);
  }
}

function patchIrLinkNullWithCompileRtFallback(patched) {
  const irLink = IR_COMPILER_LINK_NULL_TRAP;
  if (!equalAt(patched, irLink.predecessorOffset, irLink.predecessorInstruction)) {
    throw new Error("Predecessor mismatch at IRCompilerAllocCompileAndLink result");
  }
  if (!equalAt(patched, irLink.instructionOffset, irLink.expectedInstruction)) {
    throw new Error("Opcode mismatch at IRCompilerAllocCompileAndLink result");
  }
  irLink.diagnosticInstruction.copy(patched, irLink.instructionOffset);

  const outer = CREATE_FUNCTION_NULL_ORIGIN_SITES[2];
  if (!equalAt(patched, outer.predecessorOffset, outer.predecessorInstruction)) {
    throw new Error("Predecessor mismatch at CompileRTFunction fallback");
  }
  if (!equalAt(patched, outer.instructionOffset, outer.expectedInstruction)) {
    throw new Error("Opcode mismatch at CompileRTFunction fallback");
  }
  outer.diagnosticInstruction.copy(patched, outer.instructionOffset);
}

export function applyFailureTags(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchFailureTags(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "failure-tags") {
    throw new Error("D3DMetal failure-tag verification failed");
  }
  return patched;
}

export function applyVertexBufferCountGuard(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchVertexBufferCountGuard(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "vertex-count-guard") {
    throw new Error("D3DMetal vertex-buffer count guard verification failed");
  }
  return patched;
}

export function applyGuardAndFailureTags(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchVertexBufferCountGuard(patched);
  patchFailureTags(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "vertex-count-guard+failure-tags") {
    throw new Error("D3DMetal combined diagnostic verification failed");
  }
  return patched;
}

export function applyStateObjectTraps(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchStateObjectTraps(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "state-object-traps") {
    throw new Error("D3DMetal state-object trap verification failed");
  }
  return patched;
}

export function applyNoOpPsoVertexCountInit(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchNoOpPsoVertexCountInit(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "no-op-pso-vertex-count-init") {
    throw new Error("D3DMetal no-op PSO initialization verification failed");
  }
  return patched;
}

export function applyCreateStateObjectReturnTrap(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchCreateStateObjectReturnTrap(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "failed-create-state-object-return-trap") {
    throw new Error("D3DMetal CreateStateObject return-trap verification failed");
  }
  return patched;
}

export function applyStateObjectParserPhaseTrap(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchStateObjectParserResultTrap(patched);
  patchCreateStateObjectReturnTrap(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "state-object-parser-phase-trap") {
    throw new Error("D3DMetal parser-phase trap verification failed");
  }
  return patched;
}

export function applyStateObjectInheritanceResultTrap(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchStateObjectInheritanceResultTrap(patched);
  patchCreateStateObjectReturnTrap(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "state-object-inheritance-result-trap") {
    throw new Error("D3DMetal inheritance-result trap verification failed");
  }
  return patched;
}

export function applyNoOpFixAndCompileExportStoreTraps(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchNoOpPsoVertexCountInit(patched);
  patchCompileNewResolvedExportFailureStores(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "noop-fix+compile-export-store-traps") {
    throw new Error("D3DMetal combined no-op/store-trap verification failed");
  }
  return patched;
}

export function applyNoOpFixAndCreateFunctionNullTraps(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchNoOpPsoVertexCountInit(patched);
  patchCreateFunctionNullOrigins(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "noop-fix+create-function-null-traps") {
    throw new Error("D3DMetal combined no-op/CreateFunction trap verification failed");
  }
  return patched;
}

export function applyNoOpFixAndIrLinkNullWithCompileRtFallback(bytes) {
  requirePristine(bytes);
  const patched = Buffer.from(bytes);
  patchNoOpPsoVertexCountInit(patched);
  patchIrLinkNullWithCompileRtFallback(patched);
  const result = inspectD3DMetalBinary(patched);
  if (result.mode !== "noop-fix+ir-link-null-with-compile-rt-fallback") {
    throw new Error("D3DMetal IR-link/fallback trap verification failed");
  }
  return patched;
}

async function writeLikeSource(source, destination, bytes) {
  const metadata = await stat(source);
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await chmod(temporary, metadata.mode);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function main(argv) {
  const [command, source, destination] = argv;
  if (command === "inspect" && source && !destination) {
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(source)), null, 2)
    );
    return;
  }
  if (command === "tag" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(source, destination, applyFailureTags(bytes));
    console.log(
      JSON.stringify(
        inspectD3DMetalBinary(await readFile(destination)),
        null,
        2
      )
    );
    return;
  }
  if (command === "guard" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyVertexBufferCountGuard(bytes)
    );
    console.log(
      JSON.stringify(
        inspectD3DMetalBinary(await readFile(destination)),
        null,
        2
      )
    );
    return;
  }
  if (command === "guard-tag" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(source, destination, applyGuardAndFailureTags(bytes));
    console.log(
      JSON.stringify(
        inspectD3DMetalBinary(await readFile(destination)),
        null,
        2
      )
    );
    return;
  }
  if (command === "trap" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(source, destination, applyStateObjectTraps(bytes));
    console.log(
      JSON.stringify(
        inspectD3DMetalBinary(await readFile(destination)),
        null,
        2
      )
    );
    return;
  }
  if (command === "fix-noop-pso" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyNoOpPsoVertexCountInit(bytes)
    );
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(destination)), null, 2)
    );
    return;
  }
  if (command === "trap-state-object-return" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyCreateStateObjectReturnTrap(bytes)
    );
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(destination)), null, 2)
    );
    return;
  }
  if (command === "trap-state-object-parser-phase" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyStateObjectParserPhaseTrap(bytes)
    );
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(destination)), null, 2)
    );
    return;
  }
  if (command === "trap-state-object-inheritance-result" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyStateObjectInheritanceResultTrap(bytes)
    );
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(destination)), null, 2)
    );
    return;
  }
  if (command === "trap-compile-export-stores-with-noop-fix" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyNoOpFixAndCompileExportStoreTraps(bytes)
    );
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(destination)), null, 2)
    );
    return;
  }
  if (command === "trap-create-function-nulls-with-noop-fix" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyNoOpFixAndCreateFunctionNullTraps(bytes)
    );
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(destination)), null, 2)
    );
    return;
  }
  if (command === "trap-ir-link-with-compile-rt-fallback" && source && destination) {
    const bytes = await readFile(source);
    await writeLikeSource(
      source,
      destination,
      applyNoOpFixAndIrLinkNullWithCompileRtFallback(bytes)
    );
    console.log(
      JSON.stringify(inspectD3DMetalBinary(await readFile(destination)), null, 2)
    );
    return;
  }
  if (command === "restore" && source && destination) {
    const bytes = await readFile(source);
    const inspection = inspectD3DMetalBinary(bytes);
    if (inspection.mode !== "original") {
      throw new Error(
        `Restore source is not pristine GPTK 4.0 beta 2: ${source}`
      );
    }
    await writeLikeSource(source, destination, bytes);
    console.log(
      JSON.stringify(
        inspectD3DMetalBinary(await readFile(destination)),
        null,
        2
      )
    );
    return;
  }
  throw new Error(
    "Usage: d3dmetal-rtxgi-patch.mjs inspect <binary> | tag <original> <output> | trap <original> <output> | fix-noop-pso <original> <output> | trap-state-object-return <original> <output> | trap-state-object-parser-phase <original> <output> | trap-state-object-inheritance-result <original> <output> | trap-compile-export-stores-with-noop-fix <original> <output> | trap-create-function-nulls-with-noop-fix <original> <output> | trap-ir-link-with-compile-rt-fallback <original> <output> | guard <original> <output> | guard-tag <original> <output> | restore <original> <output>"
  );
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`${basename(process.argv[1])}: ${error.message}`);
    process.exitCode = 1;
  });
}

// Produces a single static, function-level map of the D3DMetal 4.0b2 DXR
// path used by ZZZ: CreateStateObject -> RT export compilation -> state
// binding -> DispatchRays -> command encoder. This is observation only.
// @category D3DMetal

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;

public class TraceDxrEndToEndFlow extends GhidraScript {
  private Address at(long offset) {
    return currentProgram.getImageBase().add(offset);
  }

  private Function functionAt(long offset) {
    Function function = getFunctionAt(at(offset));
    return function != null ? function : getFunctionContaining(at(offset));
  }

  private void trace(long offset, String role) throws Exception {
    Function function = functionAt(offset);
    println("=== " + role + " @ +0x" + Long.toHexString(offset) + " ===");
    if (function == null) {
      println("MISSING");
      return;
    }
    println("FUNCTION=" + function.getName(true));
    println("ENTRY=" + function.getEntryPoint());
    println("BODY=" + function.getBody());
    println("CALLS:");
    Instruction instruction = currentProgram.getListing().getInstructionAt(function.getEntryPoint());
    while (instruction != null && function.getBody().contains(instruction.getAddress())) {
      if (instruction.getFlowType().isCall()) {
        String line = instruction.getAddress() + "  " + instruction;
        for (Reference reference : instruction.getReferencesFrom()) {
          Function target = getFunctionAt(reference.getToAddress());
          line += " -> " + reference.getToAddress();
          if (target != null) line += " " + target.getName(true);
        }
        println(line);
      }
      instruction = instruction.getNext();
    }
    DecompInterface decompiler = new DecompInterface();
    decompiler.toggleCCode(true);
    if (!decompiler.openProgram(currentProgram))
      throw new IllegalStateException("Could not open program in decompiler");
    DecompileResults result = decompiler.decompileFunction(function, 300, monitor);
    if (!result.decompileCompleted())
      throw new IllegalStateException(result.getErrorMessage());
    println("DECOMPILE:");
    println(result.getDecompiledFunction().getC());
    decompiler.dispose();
  }

  @Override
  protected void run() throws Exception {
    println("IMAGE_BASE=" + currentProgram.getImageBase());
    trace(0x697ee, "ID3D12Device5/CreateStateObject entry");
    trace(0x1274d2, "D3D12RaytracingStateObject/CreateRaytracingStateObject");
    trace(0x127542, "D3D12RaytracingStateObject constructor");
    trace(0x1214f4, "D3D12StateObject base constructor");
    trace(0x122afc, "CompileNewResolvedExports");
    trace(0x123ba0, "D3D12StateObject/CreateFunction");
    trace(0x996d8, "D3DMStageCache/CompileRTFunction");
    trace(0x99ec4, "CompileRTFunction cache-miss lambda");
    trace(0x12764c, "D3D12RaytracingStateObject/CreatePipelines");
    trace(0xde70a, "GraphicsCommandListMPL/SetPipelineState1");
    trace(0xde174, "GraphicsCommandListMPL/DispatchRays");
    trace(0xe2062, "GraphicsCommandListMPL/DispatchRaysIndirect");
    trace(0x15fd12, "EncodeDispatchRays");
    trace(0x16015b, "DispatchRaysIndirect encoder");
  }
}

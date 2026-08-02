// Decompiles D3DMStageCache::CompileRTFunction and prints concrete return and
// call-site control flow for null-result diagnosis.
// @category D3DMetal

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.symbol.Reference;

public class TraceCompileRTFunction extends GhidraScript {
  private Address at(long imageOffset) {
    return currentProgram.getImageBase().add(imageOffset);
  }

  @Override
  protected void run() throws Exception {
    Address entry = at(0x996d8);
    Function function = getFunctionAt(entry);
    if (function == null) function = getFunctionContaining(entry);
    if (function == null) throw new IllegalStateException("CompileRTFunction not found");

    println("IMAGE_BASE=" + currentProgram.getImageBase());
    println("FUNCTION=" + function.getName(true));
    println("ENTRY=" + function.getEntryPoint());
    println("BODY=" + function.getBody());

    Listing listing = currentProgram.getListing();
    println("--- INSTRUCTIONS / CALL TARGETS ---");
    Instruction instruction = listing.getInstructionAt(function.getEntryPoint());
    while (instruction != null && function.getBody().contains(instruction.getAddress())) {
      StringBuilder line = new StringBuilder();
      line.append(instruction.getAddress()).append("  ").append(instruction);
      if (instruction.getFlowType().isCall()) {
        for (Reference reference : instruction.getReferencesFrom()) {
          line.append("  [ref ").append(reference.getReferenceType())
              .append(" -> ").append(reference.getToAddress());
          Function target = getFunctionAt(reference.getToAddress());
          if (target != null) line.append(" ").append(target.getName(true));
          line.append("]");
        }
      }
      println(line.toString());
      instruction = instruction.getNext();
    }

    println("--- DECOMPILE ---");
    DecompInterface decompiler = new DecompInterface();
    decompiler.toggleCCode(true);
    decompiler.toggleSyntaxTree(true);
    if (!decompiler.openProgram(currentProgram)) {
      throw new IllegalStateException("Decompiler failed to open program");
    }
    DecompileResults results = decompiler.decompileFunction(function, 300, monitor);
    if (!results.decompileCompleted()) throw new IllegalStateException(results.getErrorMessage());
    println(results.getDecompiledFunction().getC());
    decompiler.dispose();
  }
}

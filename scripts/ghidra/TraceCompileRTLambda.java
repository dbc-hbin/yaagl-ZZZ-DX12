// Decompiles the CompileRTFunction cache-miss lambda and getValue helper.
// @category D3DMetal

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;

public class TraceCompileRTLambda extends GhidraScript {
  private Address at(long imageOffset) {
    return currentProgram.getImageBase().add(imageOffset);
  }

  private void dump(long imageOffset) throws Exception {
    Function function = getFunctionAt(at(imageOffset));
    if (function == null) function = getFunctionContaining(at(imageOffset));
    if (function == null) throw new IllegalStateException("function not found at " + imageOffset);
    println("FUNCTION=" + function.getName(true));
    println("ENTRY=" + function.getEntryPoint());
    println("BODY=" + function.getBody());
    println("--- INSTRUCTIONS ---");
    Instruction instruction = currentProgram.getListing().getInstructionAt(function.getEntryPoint());
    while (instruction != null && function.getBody().contains(instruction.getAddress())) {
      StringBuilder line = new StringBuilder(instruction.getAddress() + "  " + instruction);
      if (instruction.getFlowType().isCall()) {
        for (Reference reference : instruction.getReferencesFrom()) {
          line.append(" [").append(reference.getReferenceType()).append(" -> ")
              .append(reference.getToAddress());
          Function target = getFunctionAt(reference.getToAddress());
          if (target != null) line.append(" ").append(target.getName(true));
          line.append("]");
        }
      }
      println(line.toString());
      instruction = instruction.getNext();
    }
    DecompInterface decompiler = new DecompInterface();
    decompiler.toggleCCode(true);
    decompiler.toggleSyntaxTree(true);
    if (!decompiler.openProgram(currentProgram)) throw new IllegalStateException("open failed");
    DecompileResults results = decompiler.decompileFunction(function, 300, monitor);
    if (!results.decompileCompleted()) throw new IllegalStateException(results.getErrorMessage());
    println("--- DECOMPILE ---");
    println(results.getDecompiledFunction().getC());
    decompiler.dispose();
  }

  @Override
  protected void run() throws Exception {
    dump(0x99ec4);
    dump(0x9a286);
  }
}

// Prints the decompiled CompileNewResolvedExports function and the concrete
// instruction/reference context for the proven store-A failure path.
// @category D3DMetal

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.block.BasicBlockModel;
import ghidra.program.model.block.CodeBlock;
import ghidra.program.model.block.CodeBlockReferenceIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.symbol.Reference;

public class TraceStoreA extends GhidraScript {
  private Address at(long imageOffset) {
    return currentProgram.getImageBase().add(imageOffset);
  }

  @Override
  protected void run() throws Exception {
    Address callSite = at(0x122e4c);
    Address nullTest = at(0x122ec0);
    Address nullBranch = at(0x122ec3);
    Address failureBlock = at(0x1234a3);
    Address statusStore = at(0x1234ab);
    Function function = getFunctionContaining(callSite);
    if (function == null) {
      throw new IllegalStateException("CompileNewResolvedExports function not found");
    }

    println("IMAGE_BASE=" + currentProgram.getImageBase());
    println("FUNCTION=" + function.getName(true));
    println("ENTRY=" + function.getEntryPoint());
    println("CALL_SITE=" + callSite);
    println("NULL_TEST=" + nullTest);
    println("NULL_BRANCH=" + nullBranch);
    println("FAILURE_BLOCK=" + failureBlock);
    println("STATUS_STORE=" + statusStore);

    Listing listing = currentProgram.getListing();
    println("--- STORE-A INSTRUCTIONS ---");
    Instruction instruction = listing.getInstructionAt(at(0x122e19));
    Address end = at(0x122f35);
    while (instruction != null && instruction.getAddress().compareTo(end) < 0) {
      println(instruction.getAddress() + "  " + instruction);
      instruction = instruction.getNext();
    }

    println("--- REFERENCES TO FAILURE BLOCK/STORE ---");
    for (Reference reference : getReferencesTo(failureBlock)) {
      println("failure-block ref: " + reference);
    }
    for (Reference reference : getReferencesTo(statusStore)) {
      println("store ref: " + reference);
    }

    println("--- FAILURE BLOCK PREDECESSORS ---");
    BasicBlockModel blocks = new BasicBlockModel(currentProgram);
    CodeBlock block = blocks.getFirstCodeBlockContaining(failureBlock, monitor);
    if (block != null) {
      CodeBlockReferenceIterator sources = block.getSources(monitor);
      while (sources.hasNext()) {
        println("source: " + sources.next());
      }
    }

    println("--- DECOMPILE ---");
    DecompInterface decompiler = new DecompInterface();
    decompiler.toggleCCode(true);
    decompiler.toggleSyntaxTree(true);
    if (!decompiler.openProgram(currentProgram)) {
      throw new IllegalStateException("Decompiler failed to open program");
    }
    DecompileResults results = decompiler.decompileFunction(function, 180, monitor);
    if (!results.decompileCompleted()) {
      throw new IllegalStateException(results.getErrorMessage());
    }
    println(results.getDecompiledFunction().getC());
    decompiler.dispose();
  }
}

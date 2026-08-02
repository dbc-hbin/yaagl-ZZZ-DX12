// Decompile AIRBuilder::patchFP64Operations and print references around the
// two observed IRError(0x13, "Unhandled FP64 usage") construction sites.
// @category D3DMetal

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import java.io.File;
import java.io.PrintWriter;

public class TraceFP64Operations extends GhidraScript {
  private Address at(long imageOffset) {
    return currentProgram.getImageBase().add(imageOffset);
  }

  @Override
  protected void run() throws Exception {
    Address entry = at(0xa18640);
    Function function = getFunctionAt(entry);
    if (function == null) function = getFunctionContaining(entry);
    if (function == null) {
      disassemble(entry);
      function = createFunction(entry, "AIRBuilder_patchFP64Operations");
    }
    if (function == null) throw new IllegalStateException("patchFP64Operations not found");

    println("IMAGE_BASE=" + currentProgram.getImageBase());
    println("FUNCTION=" + function.getName(true));
    println("ENTRY=" + function.getEntryPoint());
    println("BODY=" + function.getBody());

    Listing listing = currentProgram.getListing();
    long[] centers = {0xa187ee, 0xa1b33a};
    for (long center : centers) {
      println("--- WINDOW +0x" + Long.toHexString(center) + " ---");
      Address start = at(center - 0x180);
      Address end = at(center + 0x100);
      Instruction instruction = listing.getInstructionAt(start);
      if (instruction == null) instruction = listing.getInstructionAfter(start);
      while (instruction != null && instruction.getAddress().compareTo(end) <= 0) {
        println(instruction.getAddress() + "  " + instruction);
        instruction = instruction.getNext();
      }
    }

    println("--- DECOMPILE ---");
    DecompInterface decompiler = new DecompInterface();
    decompiler.toggleCCode(true);
    decompiler.toggleSyntaxTree(true);
    if (!decompiler.openProgram(currentProgram)) {
      throw new IllegalStateException("Decompiler failed to open program");
    }
    DecompileResults results = decompiler.decompileFunction(function, 600, monitor);
    if (!results.decompileCompleted()) throw new IllegalStateException(results.getErrorMessage());
    String c = results.getDecompiledFunction().getC();
    File output = new File("docs/fp64-patch-decompile.txt");
    File parent = output.getParentFile();
    if (parent != null) parent.mkdirs();
    try (PrintWriter writer = new PrintWriter(output, "UTF-8")) {
      writer.println("IMAGE_BASE=" + currentProgram.getImageBase());
      writer.println("FUNCTION=" + function.getName(true));
      writer.println("ENTRY=" + function.getEntryPoint());
      writer.println("BODY=" + function.getBody());
      writer.println(c);
    }
    println("DECOMPILE_FILE=" + output.getPath());
    String[] lines = c.split("\\R");
    boolean[] selected = new boolean[lines.length];
    for (int i = 0; i < lines.length; i++) {
      if (lines[i].contains("Unhandled FP64 usage") || lines[i].contains("0x13")) {
        int from = Math.max(0, i - 90);
        int to = Math.min(lines.length, i + 70);
        for (int j = from; j < to; j++) selected[j] = true;
      }
    }
    for (int i = 0; i < lines.length; i++) {
      if (selected[i]) println(String.format("%05d  %s", i + 1, lines[i]));
    }
    decompiler.dispose();
  }
}

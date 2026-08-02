// Dump the exact constants and helper functions that gate MetalIRConverter's
// AIRBuilder::patchFP64Operations error-19 paths.
// @category D3DMetal

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;

public class DumpFP64PatchPredicates extends GhidraScript {
  private Address at(long offset) {
    return currentProgram.getImageBase().add(offset);
  }

  private void dumpBytes(long offset, int count) throws Exception {
    Memory memory = currentProgram.getMemory();
    byte[] bytes = new byte[count];
    int read = memory.getBytes(at(offset), bytes);
    StringBuilder hex = new StringBuilder();
    StringBuilder ascii = new StringBuilder();
    for (int i = 0; i < read; i++) {
      if (i != 0) hex.append(' ');
      hex.append(String.format("%02x", bytes[i] & 0xff));
      int c = bytes[i] & 0xff;
      ascii.append(c >= 0x20 && c <= 0x7e ? (char)c : '.');
    }
    println(String.format("BYTES +0x%x count=%d", offset, read));
    println("HEX   " + hex);
    println("ASCII " + ascii);
  }

  private void printReferences(long offset) {
    println(String.format("REFERENCES +0x%x", offset));
    for (Reference reference : getReferencesTo(at(offset))) {
      println("  " + reference.getFromAddress() + " " + reference.getReferenceType());
    }
  }

  private void decompileAt(long offset, String label) throws Exception {
    Address entry = at(offset);
    Function function = getFunctionAt(entry);
    if (function == null) function = getFunctionContaining(entry);
    if (function == null) {
      disassemble(entry);
      function = createFunction(entry, label);
    }
    if (function == null) {
      println(label + " function-not-found");
      return;
    }
    println(String.format("FUNCTION %s entry=%s body=%s", label,
                          function.getEntryPoint(), function.getBody()));
    DecompInterface decompiler = new DecompInterface();
    decompiler.toggleCCode(true);
    decompiler.toggleSyntaxTree(true);
    if (!decompiler.openProgram(currentProgram)) {
      throw new IllegalStateException("Decompiler failed to open program");
    }
    DecompileResults results = decompiler.decompileFunction(function, 120, monitor);
    if (!results.decompileCompleted()) {
      println(label + " decompile-failed " + results.getErrorMessage());
      decompiler.dispose();
      return;
    }
    String[] lines = results.getDecompiledFunction().getC().split("\\R");
    for (int i = 0; i < lines.length; i++) {
      String line = lines[i];
      if (line.contains("return") || line.contains("param_") ||
          line.contains("0x10") || line.contains("0x18") ||
          line.contains("0x30") || line.contains("string") ||
          line.contains("char")) {
        println(String.format("%05d %s", i + 1, line));
      }
    }
    decompiler.dispose();
  }

  @Override
  protected void run() throws Exception {
    println("IMAGE_BASE=" + currentProgram.getImageBase());
    dumpBytes(0x113e7e0, 96);
    dumpBytes(0x133ddc0, 128);
    printReferences(0x113e800);
    printReferences(0x113e810);
    printReferences(0x133ddc6);
    printReferences(0x133de1a);
    decompileAt(0x470a58, "helper_470a58");
    decompileAt(0x46c854, "helper_46c854");
  }
}

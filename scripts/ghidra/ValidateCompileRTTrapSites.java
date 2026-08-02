// Verifies incoming references for the proposed CompileRTFunction trap spans.
// @category D3DMetal

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;

public class ValidateCompileRTTrapSites extends GhidraScript {
  private Address at(long imageOffset) {
    return currentProgram.getImageBase().add(imageOffset);
  }

  private void dumpSpan(long start, int length) {
    println(String.format("SPAN=%x..%x", start, start + length));
    for (int delta = 0; delta < length; delta++) {
      Address address = at(start + delta);
      for (Reference reference : getReferencesTo(address)) {
        println(address + " <- " + reference);
      }
    }
  }

  @Override
  protected void run() throws Exception {
    dumpSpan(0x9a132, 6);
    dumpSpan(0x999cf, 6);
    dumpSpan(0x36f69b, 15);
  }
}

// Emits the precise function boundaries, recovered ABI, disassembly windows,
// and decompiler output needed by the runtime-only D3DMetal observer.
// Observation only; this script never modifies the imported program.
// @category D3DMetal

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Parameter;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class TraceDxrInstrumentationPoints extends GhidraScript {
  private final StringBuilder output = new StringBuilder();

  private Address at(long offset) {
    return currentProgram.getImageBase().add(offset);
  }

  private void line(String value) {
    output.append(value).append('\n');
  }

  private Function functionAt(long offset) {
    Function exact = getFunctionAt(at(offset));
    return exact != null ? exact : getFunctionContaining(at(offset));
  }

  private void instructionWindow(long offset, int before, int after) {
    Address target = at(offset);
    Instruction cursor = currentProgram.getListing().getInstructionContaining(target);
    if (cursor == null) {
      line("WINDOW_MISSING=+0x" + Long.toHexString(offset));
      return;
    }
    for (int index = 0; index < before && cursor.getPrevious() != null; ++index)
      cursor = cursor.getPrevious();
    for (int index = 0; cursor != null && index < before + after + 1; ++index) {
      StringBuilder rendered = new StringBuilder();
      rendered.append(cursor.getAddress()).append("  ").append(cursor);
      for (Reference reference : cursor.getReferencesFrom()) {
        rendered.append(" -> ").append(reference.getToAddress());
        Function targetFunction = getFunctionAt(reference.getToAddress());
        if (targetFunction != null)
          rendered.append(" ").append(targetFunction.getName(true));
      }
      line(rendered.toString());
      cursor = cursor.getNext();
    }
  }

  private void traceFunction(long offset, String role, boolean decompile)
      throws Exception {
    Function function = functionAt(offset);
    line("=== " + role + " @ +0x" + Long.toHexString(offset) + " ===");
    if (function == null) {
      line("MISSING");
      return;
    }
    line("FUNCTION=" + function.getName(true));
    line("ENTRY=" + function.getEntryPoint());
    line("BODY_MIN=" + function.getBody().getMinAddress());
    line("BODY_MAX=" + function.getBody().getMaxAddress());
    line("PROTOTYPE=" + function.getPrototypeString(true, true));
    line("PARAMETERS=" + function.getParameterCount());
    for (Parameter parameter : function.getParameters()) {
      line("PARAM index=" + parameter.getOrdinal() +
           " name=" + parameter.getName() +
           " type=" + parameter.getDataType().getDisplayName() +
           " storage=" + parameter.getVariableStorage());
    }
    line("CALLERS:");
    for (Reference reference : getReferencesTo(function.getEntryPoint())) {
      Function caller = getFunctionContaining(reference.getFromAddress());
      line(reference.getFromAddress() + " from=" +
           (caller == null ? "unknown" : caller.getName(true)));
    }
    line("ENTRY_WINDOW:");
    instructionWindow(function.getEntryPoint().subtract(currentProgram.getImageBase()), 0, 24);
    if (!decompile)
      return;
    DecompInterface decompiler = new DecompInterface();
    decompiler.toggleCCode(true);
    decompiler.toggleSyntaxTree(true);
    if (!decompiler.openProgram(currentProgram))
      throw new IllegalStateException("Could not open program in decompiler");
    DecompileResults result = decompiler.decompileFunction(function, 300, monitor);
    if (!result.decompileCompleted())
      throw new IllegalStateException(result.getErrorMessage());
    line("DECOMPILE:");
    line(result.getDecompiledFunction().getC());
    decompiler.dispose();
  }

  @Override
  protected void run() throws Exception {
    String[] args = getScriptArgs();
    if (args.length != 1)
      throw new IllegalArgumentException("expected output path argument");
    line("IMAGE_BASE=" + currentProgram.getImageBase());

    line("=== CompileAndLink call windows ===");
    instructionWindow(0x87ec4, 12, 20);
    instructionWindow(0x9a12a, 12, 20);
    instructionWindow(0x9cccc, 12, 20);
    instructionWindow(0x9ccd8, 12, 20);

    line("=== D3DMStageCache compile function ranges ===");
    FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
    while (functions.hasNext()) {
      Function function = functions.next();
      String name = function.getName(true);
      if (!name.contains("D3DMStageCache::Compile"))
        continue;
      long entry = function.getEntryPoint().subtract(currentProgram.getImageBase());
      long end = function.getBody().getMaxAddress().subtract(currentProgram.getImageBase());
      line("STAGE_FUNCTION name=" + name +
           " entry=0x" + Long.toHexString(entry) +
           " end=0x" + Long.toHexString(end) +
           " prototype=" + function.getPrototypeString(true, true));
    }

    traceFunction(0x86e58, "compute compile entry", true);
    traceFunction(0x87e4a, "shared CompileAndLinkStage", true);
    traceFunction(0x89188, "graphics compile entry", true);
    traceFunction(0x996d8, "D3DMStageCache CompileRTFunction", true);
    traceFunction(0x9cccc, "shared compute CompileAndLink caller", true);
    traceFunction(0x9ccd8, "shared graphics CompileAndLink caller", false);
    traceFunction(0x10ed2c, "compute PSO constructor", true);
    traceFunction(0x10f062, "compute CompilePipeline", true);
    traceFunction(0x10f512, "graphics PSO constructor", true);
    traceFunction(0x110746, "graphics LoadFunctions", true);
    traceFunction(0x11215c, "graphics GetRenderPipelineState", true);
    traceFunction(0x15fd12, "EncodeDispatchRays", true);
    traceFunction(0x16015b, "DispatchRaysIndirect encoder", true);

    Path destination = Paths.get(args[0]).toAbsolutePath().normalize();
    Files.createDirectories(destination.getParent());
    Files.write(destination, output.toString().getBytes(StandardCharsets.UTF_8));
    println("WROTE=" + destination);
  }
}

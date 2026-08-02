#include "../unorm24-transform.hpp"

#include <cassert>
#include <cstdio>
#include <string>

using yaagl::metal_ir::Unorm24TransformStatus;
using yaagl::metal_ir::transformKnownInjectCache843Only;

namespace {

size_t count(std::string_view text, std::string_view needle) {
  size_t result = 0;
  size_t position = 0;
  while ((position = text.find(needle, position)) != std::string_view::npos) {
    ++result;
    position += needle.size();
  }
  return result;
}

std::string makeExactInjectCacheText() {
  std::string input = R"llvm(; Compute Shader
; NumThreads=(8,8,1)
target triple = "dxil-ms-dx"
@"\01?gs_Result5@@3PAY0BA@$$CAIA.1dim" = addrspace(3) global [128 x i32] undef, align 4
define void @InjectCache() {
  %u24mask = and i32 %u24raw, 16777215
  %u24conv = uitofp i32 %u24mask to double
  %u24scale = fmul fast double %u24conv, 0x3E70000010000010
  %u24term = fptrunc double %u24scale to float
)llvm";

  // Deliberately emit all producer lanes before all scales and terminals.  A
  // line-adjacent matcher cannot accept this input, while the production SSA
  // matcher must retain each individual def/use edge.
  for (unsigned index = 0; index < 27; ++index) {
    const std::string suffix = std::to_string(index);
    input += "  %maddr" + suffix +
             " = getelementptr [128 x i32], [128 x i32] addrspace(3)* @\"\\01?gs_Result5@@3PAY0BA@$$CAIA.1dim\", i32 0, i32 %mindex" +
             suffix + "\n";
    input += "  %mraw" + suffix + " = load i32, i32 addrspace(3)* %maddr" +
             suffix + ", align 4, !tbaa !26\n";
    input += "  %mconv" + suffix + " = uitofp i32 %mraw" + suffix +
             " to double\n";
    input += "  %umask" + suffix + " = and i32 %uraw" + suffix + ", 65535\n";
    input += "  %uconv" + suffix + " = sitofp i32 %umask" + suffix +
             " to double\n";
    input += "  %emax" + suffix +
             " = call float @dx.op.binary.f32(i32 35, float %eval" + suffix +
             ", float 0.000000e+00)  ; FMax(a,b)\n";
    input += "  %emin" + suffix +
             " = call float @dx.op.binary.f32(i32 36, float %emax" + suffix +
             ", float 2.000000e+00)  ; FMin(a,b)\n";
    input += "  %eext" + suffix + " = fpext float %emin" + suffix +
             " to double\n";
  }
  for (unsigned index = 0; index < 27; ++index) {
    const std::string suffix = std::to_string(index);
    input += "  %mscale" + suffix + " = fmul fast double %mconv" + suffix +
             ", 1.000000e-03\n";
    input += "  %uscale" + suffix + " = fmul fast double %uconv" + suffix +
             ", 0x3F00001000100010\n";
    input += "  %escale" + suffix + " = fmul fast double %eext" + suffix +
             ", 3.276750e+04\n";
  }
  for (unsigned index = 0; index < 27; ++index) {
    const std::string suffix = std::to_string(index);
    input += "  %mterm" + suffix + " = fptrunc double %mscale" + suffix +
             " to float\n";
    input += "  %uterm" + suffix + " = fptrunc double %uscale" + suffix +
             " to float\n";
    input += "  %eterm" + suffix + " = fptosi double %escale" + suffix +
             " to i32\n";
  }
  for (unsigned index = 0; index < 27; ++index) {
    const std::string suffix = std::to_string(index);
    input += "  %eimax" + suffix +
             " = call i32 @dx.op.binary.i32(i32 37, i32 %eterm" + suffix +
             ", i32 0)  ; IMax(a,b)\n";
    input += "  %eimin" + suffix +
             " = call i32 @dx.op.binary.i32(i32 38, i32 %eimax" + suffix +
             ", i32 65535)  ; IMin(a,b)\n";
  }
  input += R"llvm(  ret void
}
!20 = !{void ()* @InjectCache, !"InjectCache", null}
)llvm";
  return input;
}

void exact_noncontiguous_shader_is_rewritten_atomically() {
  const std::string input = makeExactInjectCacheText();
  std::string output;
  const auto result = transformKnownInjectCache843Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kSuccess);
  assert(result.graph_count == 82);
  assert(output.find("double") == std::string::npos);
  assert(output.find(".f64") == std::string::npos);
  assert(output.find("%mscale0 = fdiv float %mconv0, 1.000000e+03") !=
         std::string::npos);
  assert(output.find("%uscale0 = fdiv float %uconv0, 0x40DFFFE000000000") !=
         std::string::npos);
  assert(output.find("%eext0 = fmul float %emin0, 3.276800e+04") !=
         std::string::npos);
  assert(output.find("%escale0 = sub i32 %yaagl_enc_escale0_whole, "
                     "%yaagl_enc_escale0_borrow") != std::string::npos);
  assert(output.find("%eterm0 = add i32 %escale0, 0") !=
         std::string::npos);
  assert(count(output, " = fdiv float %mconv") == 27);
  assert(count(output, " = fdiv float %uconv") == 27);
  assert(count(output, "_borrow = zext i1 ") == 27);
}

void near_match_does_not_partially_rewrite() {
  std::string input = makeExactInjectCacheText();
  const size_t scale = input.find("3.276750e+04");
  assert(scale != std::string::npos);
  input.replace(scale, 12, "3.276750e+05");
  std::string output = "sentinel";
  const auto result = transformKnownInjectCache843Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

void non_direct_clamp_does_not_partially_rewrite() {
  std::string input = makeExactInjectCacheText();
  const size_t clamp = input.find("FMax(a,b)");
  assert(clamp != std::string::npos);
  input.replace(clamp, 9, "FMax(a,c)");
  std::string output;
  const auto result = transformKnownInjectCache843Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

void non_low16_encode_sink_does_not_partially_rewrite() {
  std::string input = makeExactInjectCacheText();
  const size_t sink = input.find("IMin(a,b)");
  assert(sink != std::string::npos);
  input.replace(sink, 9, "IMin(a,c)");
  std::string output;
  const auto result = transformKnownInjectCache843Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

void unowned_fp64_fails_closed() {
  std::string input = makeExactInjectCacheText();
  const size_t ret = input.find("  ret void");
  assert(ret != std::string::npos);
  input.insert(ret, "  %extra = fadd double 1.000000e+00, 2.000000e+00\n");
  std::string output;
  const auto result = transformKnownInjectCache843Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

void wrong_entry_is_not_a_candidate() {
  std::string input = makeExactInjectCacheText();
  const size_t entry = input.find("define void @InjectCache() {");
  assert(entry != std::string::npos);
  input.replace(entry, 26, "define void @OtherCache() {");
  std::string output;
  const auto result = transformKnownInjectCache843Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

}  // namespace

int main() {
  exact_noncontiguous_shader_is_rewritten_atomically();
  near_match_does_not_partially_rewrite();
  non_direct_clamp_does_not_partially_rewrite();
  non_low16_encode_sink_does_not_partially_rewrite();
  unowned_fp64_fails_closed();
  wrong_entry_is_not_a_candidate();
  std::puts("inject-cache-transform-proof: ssa ownership atomic exact counts");
  return 0;
}

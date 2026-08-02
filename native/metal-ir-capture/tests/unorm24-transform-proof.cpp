#include "../unorm24-transform.hpp"

#include <cassert>
#include <cstdio>
#include <string>

using yaagl::metal_ir::Unorm24TransformStatus;
using yaagl::metal_ir::transformUnorm24Only;

namespace {
constexpr const char *kOriginal = R"llvm(define void @main() {
entry:
  %1 = and i32 %0, 16777215
  %2 = uitofp i32 %1 to double
  %3 = fmul fast double %2, 0x3E70000010000010
  %4 = fptrunc double %3 to float
  ret void
}
)llvm";

constexpr const char *kExpected = R"llvm(define void @main() {
entry:
  %1 = and i32 %0, 16777215
  %2 = uitofp i32 %1 to float
  %3 = fdiv float %2, 0x416FFFFFE0000000
  %4 = fadd float %3, 0.000000e+00
  ret void
}
)llvm";

constexpr const char *kUnorm16TimesTwo = R"llvm(define void @main() {
entry:
  %1 = and i32 %0, 65535
  %2 = sitofp i32 %1 to double
  %3 = fmul fast double %2, 0x3F00001000100010
  %4 = fptrunc double %3 to float
  ret void
}
)llvm";

constexpr const char *kUnorm16TimesTwoExpected = R"llvm(define void @main() {
entry:
  %1 = and i32 %0, 65535
  %2 = sitofp i32 %1 to float
  %3 = fdiv float %2, 0x40DFFFE000000000
  %4 = fadd float %3, 0.000000e+00
  ret void
}
)llvm";

void exact_graph_is_rewritten() {
  std::string output;
  const auto result = transformUnorm24Only(kOriginal, &output);
  assert(result.status == Unorm24TransformStatus::kSuccess);
  assert(result.graph_count == 1);
  assert(output == kExpected);
}

void exact_unorm16_times_two_graph_is_rewritten() {
  std::string output;
  const auto result = transformUnorm24Only(kUnorm16TimesTwo, &output);
  assert(result.status == Unorm24TransformStatus::kSuccess);
  assert(result.graph_count == 1);
  assert(output == kUnorm16TimesTwoExpected);
}

void unsigned_unorm16_times_two_graph_is_not_rewritten() {
  std::string input = kUnorm16TimesTwo;
  const size_t convert = input.find("sitofp");
  assert(convert != std::string::npos);
  input.replace(convert, 6, "uitofp");
  std::string output;
  const auto result = transformUnorm24Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

void unorm16_times_two_near_match_is_not_rewritten() {
  std::string input = kUnorm16TimesTwo;
  const size_t constant = input.find("0x3F00001000100010");
  assert(constant != std::string::npos);
  input.replace(constant, 18, "0x3F00001000100011");
  std::string output;
  const auto result = transformUnorm24Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

void any_other_fp64_instruction_fails_closed() {
  std::string input = kOriginal;
  input.insert(input.find("  ret void"),
               "  %5 = fadd double 1.000000e+00, 2.000000e+00\n");
  std::string output = "sentinel";
  const auto result = transformUnorm24Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kUnhandledFp64);
  assert(result.graph_count == 1);
  assert(output.empty());
}

void near_matches_are_not_rewritten() {
  std::string input = kOriginal;
  const size_t constant = input.find("0x3E70000010000010");
  assert(constant != std::string::npos);
  input.replace(constant, 18, "0x3E70000010000011");
  std::string output;
  const auto result = transformUnorm24Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kNoMatch);
  assert(result.graph_count == 0);
  assert(output.empty());
}

void multiple_graphs_remain_bounded() {
  std::string input = kOriginal;
  const size_t ret = input.find("  ret void");
  assert(ret != std::string::npos);
  input.insert(ret,
               "  %5 = and i32 %0, 16777215\n"
               "  %6 = uitofp i32 %5 to double\n"
               "  %7 = fmul fast double %6, 0x3E70000010000010\n"
               "  %8 = fptrunc double %7 to float\n");
  std::string output;
  const auto result = transformUnorm24Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kSuccess);
  assert(result.graph_count == 2);
  assert(output.find("double") == std::string::npos);
  assert(output.find("0x416FFFFFE0000000") != std::string::npos);
}

void mixed_exact_graphs_are_rewritten() {
  std::string input = kOriginal;
  const size_t ret = input.find("  ret void");
  assert(ret != std::string::npos);
  const std::string u16Body =
      "  %5 = and i32 %0, 65535\n"
      "  %6 = sitofp i32 %5 to double\n"
      "  %7 = fmul fast double %6, 0x3F00001000100010\n"
      "  %8 = fptrunc double %7 to float\n";
  input.insert(ret, u16Body);
  std::string output;
  const auto result = transformUnorm24Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kSuccess);
  assert(result.graph_count == 2);
  assert(output.find("double") == std::string::npos);
  assert(output.find("0x416FFFFFE0000000") != std::string::npos);
  assert(output.find("0x40DFFFE000000000") != std::string::npos);
}

void cache_inject_fp64_still_fails_closed() {
  std::string input = kUnorm16TimesTwo;
  input.insert(input.find("  ret void"),
               "  %5 = uitofp i32 %0 to double\n"
               "  %6 = fmul fast double %5, 1.000000e-03\n"
               "  %7 = fptrunc double %6 to float\n");
  std::string output = "sentinel";
  const auto result = transformUnorm24Only(input, &output);
  assert(result.status == Unorm24TransformStatus::kUnhandledFp64);
  assert(result.graph_count == 1);
  assert(output.empty());
}
}  // namespace

int main() {
  exact_graph_is_rewritten();
  exact_unorm16_times_two_graph_is_rewritten();
  unsigned_unorm16_times_two_graph_is_not_rewritten();
  unorm16_times_two_near_match_is_not_rewritten();
  any_other_fp64_instruction_fails_closed();
  near_matches_are_not_rewritten();
  multiple_graphs_remain_bounded();
  mixed_exact_graphs_are_rewritten();
  cache_inject_fp64_still_fails_closed();
  std::puts("unorm24-transform-proof: exact_codecs fail_closed bounded");
  return 0;
}

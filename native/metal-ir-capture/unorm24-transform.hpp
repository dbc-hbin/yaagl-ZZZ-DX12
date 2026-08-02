#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace yaagl::metal_ir {

enum class Unorm24TransformStatus {
  kSuccess,
  kNoMatch,
  kTooLarge,
  kUnhandledFp64,
};

struct Unorm24TransformResult {
  Unorm24TransformStatus status = Unorm24TransformStatus::kNoMatch;
  size_t graph_count = 0;
};

namespace detail {
enum class GraphKind : uint8_t {
  kNone,
  kUnorm24,
  kUnorm16TimesTwo,
};

struct Assignment {
  std::string_view indent;
  std::string_view result;
  std::string_view expression;
  bool valid = false;
};

inline bool startsWith(std::string_view value, std::string_view prefix) {
  return value.size() >= prefix.size() &&
         value.substr(0, prefix.size()) == prefix;
}

inline bool endsWith(std::string_view value, std::string_view suffix) {
  return value.size() >= suffix.size() &&
         value.substr(value.size() - suffix.size()) == suffix;
}

inline Assignment parseAssignment(std::string_view line) {
  Assignment parsed{};
  const size_t first = line.find_first_not_of(" \t");
  if (first == std::string_view::npos || line[first] != '%')
    return parsed;
  const size_t equals = line.find(" = ", first + 1);
  if (equals == std::string_view::npos)
    return parsed;
  parsed.indent = line.substr(0, first);
  parsed.result = line.substr(first, equals - first);
  parsed.expression = line.substr(equals + 3);
  parsed.valid = parsed.result.find_first_of(" \t,") == std::string_view::npos;
  return parsed;
}

inline bool parseUnaryEdge(std::string_view expression,
                           std::string_view prefix,
                           std::string_view suffix,
                           std::string_view *operand) {
  if (!operand || !startsWith(expression, prefix) ||
      !endsWith(expression, suffix) ||
      expression.size() <= prefix.size() + suffix.size())
    return false;
  *operand = expression.substr(
      prefix.size(), expression.size() - prefix.size() - suffix.size());
  return !operand->empty() && operand->find_first_of(" \t,") == std::string_view::npos;
}

inline bool parseBinaryEdge(std::string_view expression,
                            std::string_view prefix,
                            std::string_view suffix,
                            std::string_view *operand) {
  return parseUnaryEdge(expression, prefix, suffix, operand);
}

inline bool lineHasFp64(std::string_view line) {
  return line.find("double") != std::string_view::npos ||
         line.find(".f64") != std::string_view::npos;
}

inline bool containsExactlyOnce(std::string_view value,
                                std::string_view needle) {
  if (needle.empty()) return false;
  const size_t first = value.find(needle);
  return first != std::string_view::npos &&
         value.find(needle, first + needle.size()) == std::string_view::npos;
}

inline const Assignment *findDefinition(
    const std::unordered_map<std::string_view, size_t> &definitions,
    const std::vector<Assignment> &assignments, std::string_view result,
    size_t *index = nullptr) {
  const auto found = definitions.find(result);
  if (found == definitions.end()) return nullptr;
  if (index) *index = found->second;
  return &assignments[found->second];
}

inline bool isInjectCacheResult5Load(
    const std::unordered_map<std::string_view, size_t> &definitions,
    const std::vector<Assignment> &assignments, std::string_view value) {
  const Assignment *load = findDefinition(definitions, assignments, value);
  if (!load ||
      !startsWith(load->expression, "load i32, i32 addrspace(3)* "))
    return false;
  constexpr std::string_view kResult5Name =
      "gs_Result5@@3PAY0BA@$$CAIA.1dim";
  const size_t pointerStart =
      std::string_view("load i32, i32 addrspace(3)* ").size();
  const size_t pointerEnd = load->expression.find(", align ", pointerStart);
  if (pointerEnd == std::string_view::npos) return false;
  const std::string_view pointer =
      load->expression.substr(pointerStart, pointerEnd - pointerStart);
  const Assignment *address = findDefinition(definitions, assignments, pointer);
  return address &&
         startsWith(address->expression,
                    "getelementptr [128 x i32], [128 x i32] addrspace(3)* ") &&
         address->expression.find(kResult5Name) != std::string_view::npos;
}

inline bool isDirectClampZeroToTwo(
    const std::unordered_map<std::string_view, size_t> &definitions,
    const std::vector<Assignment> &assignments, std::string_view value) {
  std::string_view maxOperand;
  const Assignment *minimum = findDefinition(definitions, assignments, value);
  if (!minimum ||
      !parseUnaryEdge(
          minimum->expression,
          "call float @dx.op.binary.f32(i32 36, float ",
          ", float 2.000000e+00)  ; FMin(a,b)", &maxOperand))
    return false;
  std::string_view ignored;
  const Assignment *maximum =
      findDefinition(definitions, assignments, maxOperand);
  return maximum &&
         parseUnaryEdge(maximum->expression,
                        "call float @dx.op.binary.f32(i32 35, float ",
                        ", float 0.000000e+00)  ; FMax(a,b)", &ignored);
}

inline bool isDirectLow16EncodeSink(
    const std::vector<Assignment> &assignments, std::string_view value) {
  for (const Assignment &maximum : assignments) {
    if (!maximum.valid) continue;
    std::string_view input;
    if (!parseUnaryEdge(maximum.expression,
                        "call i32 @dx.op.binary.i32(i32 37, i32 ",
                        ", i32 0)  ; IMax(a,b)", &input) ||
        input != value)
      continue;
    for (const Assignment &minimum : assignments) {
      if (!minimum.valid) continue;
      std::string_view maximumInput;
      if (parseUnaryEdge(minimum.expression,
                         "call i32 @dx.op.binary.i32(i32 38, i32 ",
                         ", i32 65535)  ; IMin(a,b)", &maximumInput) &&
          maximumInput == maximum.result)
        return true;
    }
  }
  return false;
}

enum class InjectCacheGraphKind : uint8_t {
  kUnorm24,
  kUnorm16TimesTwo,
  kMilliResult5,
  kClampedEncode,
};

struct InjectCacheAction {
  InjectCacheGraphKind kind = InjectCacheGraphKind::kUnorm24;
  size_t convert_index = 0;
  size_t scale_index = 0;
  size_t terminal_index = 0;
  std::string_view input;
};
}  // namespace detail

inline Unorm24TransformResult transformUnorm24Only(std::string_view input,
                                                    std::string *output) {
  constexpr size_t kMaximumTextBytes = 1024 * 1024;
  constexpr size_t kMaximumGraphs = 32;
  constexpr std::string_view kUnorm24DoubleScale = "0x3E70000010000010";
  constexpr std::string_view kUnorm24FloatDenominator =
      "0x416FFFFFE0000000";
  constexpr std::string_view kUnorm16TimesTwoDoubleScale =
      "0x3F00001000100010";
  constexpr std::string_view kUnorm16TimesTwoFloatDenominator =
      "0x40DFFFE000000000";

  if (!output)
    return {Unorm24TransformStatus::kNoMatch, 0};
  output->clear();
  if (input.empty() || input.size() > kMaximumTextBytes)
    return {Unorm24TransformStatus::kTooLarge, 0};

  const bool hadTrailingNewline = input.back() == '\n';
  std::vector<std::string_view> lines;
  lines.reserve(2048);
  size_t cursor = 0;
  while (cursor < input.size()) {
    const size_t newline = input.find('\n', cursor);
    const size_t end = newline == std::string_view::npos ? input.size() : newline;
    lines.push_back(input.substr(cursor, end - cursor));
    cursor = newline == std::string_view::npos ? input.size() : newline + 1;
  }

  std::vector<detail::GraphKind> transformed(
      lines.size(), detail::GraphKind::kNone);
  size_t graphCount = 0;
  for (size_t index = 0; index + 3 < lines.size(); ++index) {
    const detail::Assignment mask = detail::parseAssignment(lines[index]);
    const detail::Assignment convert = detail::parseAssignment(lines[index + 1]);
    const detail::Assignment scale = detail::parseAssignment(lines[index + 2]);
    const detail::Assignment truncate = detail::parseAssignment(lines[index + 3]);
    if (!mask.valid || !convert.valid || !scale.valid || !truncate.valid)
      continue;

    detail::GraphKind graphKind = detail::GraphKind::kNone;
    std::string_view maskedSource;
    if (detail::parseBinaryEdge(mask.expression, "and i32 ", ", 16777215",
                                &maskedSource)) {
      graphKind = detail::GraphKind::kUnorm24;
    } else if (detail::parseBinaryEdge(mask.expression, "and i32 ",
                                       ", 65535", &maskedSource)) {
      graphKind = detail::GraphKind::kUnorm16TimesTwo;
    } else {
      continue;
    }
    std::string_view maskOperand;
    const bool expectedConvert =
        graphKind == detail::GraphKind::kUnorm24
            ? detail::parseUnaryEdge(convert.expression, "uitofp i32 ",
                                     " to double", &maskOperand)
            : detail::parseUnaryEdge(convert.expression, "sitofp i32 ",
                                     " to double", &maskOperand);
    if (!expectedConvert || maskOperand != mask.result)
      continue;
    std::string_view convertedOperand;
    const std::string_view doubleScale =
        graphKind == detail::GraphKind::kUnorm24
            ? kUnorm24DoubleScale
            : kUnorm16TimesTwoDoubleScale;
    const std::string scaleSuffix = ", " + std::string(doubleScale);
    if (!detail::parseBinaryEdge(scale.expression, "fmul fast double ",
                                 scaleSuffix, &convertedOperand) ||
        convertedOperand != convert.result)
      continue;
    std::string_view scaledOperand;
    if (!detail::parseUnaryEdge(truncate.expression, "fptrunc double ",
                                " to float", &scaledOperand) ||
        scaledOperand != scale.result)
      continue;
    if (++graphCount > kMaximumGraphs)
      return {Unorm24TransformStatus::kTooLarge, 0};
    transformed[index] = transformed[index + 1] = transformed[index + 2] =
        transformed[index + 3] = graphKind;
    index += 3;
  }

  if (graphCount == 0)
    return {Unorm24TransformStatus::kNoMatch, 0};
  for (size_t index = 0; index < lines.size(); ++index) {
    if (detail::lineHasFp64(lines[index]) &&
        transformed[index] == detail::GraphKind::kNone)
      return {Unorm24TransformStatus::kUnhandledFp64, graphCount};
  }

  output->reserve(input.size());
  for (size_t index = 0; index < lines.size(); ++index) {
    const detail::Assignment assignment = detail::parseAssignment(lines[index]);
    const detail::GraphKind graphKind = transformed[index];
    if (index + 3 < lines.size() && graphKind != detail::GraphKind::kNone &&
        transformed[index + 1] == graphKind &&
        transformed[index + 2] == graphKind &&
        transformed[index + 3] == graphKind) {
      const detail::Assignment convert = detail::parseAssignment(lines[index + 1]);
      const detail::Assignment scale = detail::parseAssignment(lines[index + 2]);
      const detail::Assignment truncate = detail::parseAssignment(lines[index + 3]);
      output->append(lines[index]);
      output->push_back('\n');
      output->append(convert.indent);
      output->append(convert.result);
      output->append(graphKind == detail::GraphKind::kUnorm24
                         ? " = uitofp i32 "
                         : " = sitofp i32 ");
      output->append(assignment.result);
      output->append(" to float\n");
      output->append(scale.indent);
      output->append(scale.result);
      output->append(" = fdiv float ");
      output->append(convert.result);
      output->append(", ");
      output->append(graphKind == detail::GraphKind::kUnorm24
                         ? kUnorm24FloatDenominator
                         : kUnorm16TimesTwoFloatDenominator);
      output->push_back('\n');
      output->append(truncate.indent);
      output->append(truncate.result);
      output->append(" = fadd float ");
      output->append(scale.result);
      output->append(", 0.000000e+00");
      index += 3;
    } else {
      output->append(lines[index]);
    }
    if (index + 1 < lines.size())
      output->push_back('\n');
  }
  if (hadTrailingNewline)
    output->push_back('\n');
  return {Unorm24TransformStatus::kSuccess, graphCount};
}

// This is intentionally not a general FP64 lowering pass.  The caller gates
// it to the captured InjectCache source digest, and this routine accepts that
// source only when every FP64 instruction is one of the known codecs below.
// The old transform could only see the first adjacent UNORM24 sequence; the
// RGB lanes in InjectCache are deliberately interleaved (convert A/B/C, then
// multiply A/B/C, then truncate A/B/C), so the ownership check is SSA based.
inline Unorm24TransformResult transformKnownInjectCache843Only(
    std::string_view input, std::string *output) {
  constexpr size_t kMaximumTextBytes = 1024 * 1024;
  constexpr size_t kExpectedUnorm24 = 1;
  constexpr size_t kExpectedUnorm16 = 27;
  constexpr size_t kExpectedMilli = 27;
  constexpr size_t kExpectedEncode = 27;
  constexpr size_t kExpectedGraphs =
      kExpectedUnorm24 + kExpectedUnorm16 + kExpectedMilli +
      kExpectedEncode;
  constexpr std::string_view kUnorm24DoubleScale = "0x3E70000010000010";
  constexpr std::string_view kUnorm24FloatDenominator =
      "0x416FFFFFE0000000";
  constexpr std::string_view kUnorm16DoubleScale = "0x3F00001000100010";
  constexpr std::string_view kUnorm16FloatDenominator =
      "0x40DFFFE000000000";
  constexpr std::string_view kMilliDoubleScale = "1.000000e-03";
  constexpr std::string_view kMilliFloatDenominator = "1.000000e+03";
  constexpr std::string_view kEncodeDoubleScale = "3.276750e+04";
  constexpr std::string_view kEncodeFloatScale = "3.276800e+04";

  if (!output) return {Unorm24TransformStatus::kNoMatch, 0};
  output->clear();
  if (input.empty() || input.size() > kMaximumTextBytes)
    return {Unorm24TransformStatus::kTooLarge, 0};

  // Both the source digest gate and these entry facts are required.  The
  // latter makes an accidental attempt against a different LLVM entry fail
  // before any ownership or rewrite work begins.
  if (!detail::containsExactlyOnce(input, "define void @InjectCache() {") ||
      input.find("; Compute Shader") == std::string_view::npos ||
      input.find("; NumThreads=(8,8,1)") == std::string_view::npos ||
      input.find("!\"InjectCache\"") == std::string_view::npos ||
      input.find("%yaagl_enc_") != std::string_view::npos)
    return {Unorm24TransformStatus::kNoMatch, 0};

  const bool hadTrailingNewline = input.back() == '\n';
  std::vector<std::string_view> lines;
  lines.reserve(8192);
  size_t cursor = 0;
  while (cursor < input.size()) {
    const size_t newline = input.find('\n', cursor);
    const size_t end =
        newline == std::string_view::npos ? input.size() : newline;
    lines.push_back(input.substr(cursor, end - cursor));
    cursor = newline == std::string_view::npos ? input.size() : newline + 1;
  }

  std::vector<detail::Assignment> assignments(lines.size());
  std::unordered_map<std::string_view, size_t> definitions;
  definitions.reserve(lines.size());
  for (size_t index = 0; index < lines.size(); ++index) {
    assignments[index] = detail::parseAssignment(lines[index]);
    if (!assignments[index].valid) continue;
    if (!definitions.emplace(assignments[index].result, index).second)
      return {Unorm24TransformStatus::kNoMatch, 0};
  }

  std::vector<detail::InjectCacheAction> actions;
  actions.reserve(kExpectedGraphs);
  std::vector<bool> claimed(lines.size(), false);
  size_t unorm24Count = 0;
  size_t unorm16Count = 0;
  size_t milliCount = 0;
  size_t encodeCount = 0;

  const auto registerAction = [&](detail::InjectCacheGraphKind kind,
                                  size_t convertIndex, size_t scaleIndex,
                                  size_t terminalIndex,
                                  std::string_view actionInput) -> bool {
    if (convertIndex >= lines.size() || scaleIndex >= lines.size() ||
        terminalIndex >= lines.size() || claimed[convertIndex] ||
        claimed[scaleIndex] || claimed[terminalIndex])
      return false;
    claimed[convertIndex] = claimed[scaleIndex] = claimed[terminalIndex] =
        true;
    actions.push_back(
        {kind, convertIndex, scaleIndex, terminalIndex, actionInput});
    switch (kind) {
    case detail::InjectCacheGraphKind::kUnorm24:
      ++unorm24Count;
      break;
    case detail::InjectCacheGraphKind::kUnorm16TimesTwo:
      ++unorm16Count;
      break;
    case detail::InjectCacheGraphKind::kMilliResult5:
      ++milliCount;
      break;
    case detail::InjectCacheGraphKind::kClampedEncode:
      ++encodeCount;
      break;
    }
    return true;
  };

  // Decode graphs terminate in fptrunc.  Each predecessor is resolved by SSA
  // name instead of source-line distance, which is necessary for the nine
  // interleaved RGB batches in the captured shader.
  for (size_t terminalIndex = 0; terminalIndex < assignments.size();
       ++terminalIndex) {
    const detail::Assignment &terminal = assignments[terminalIndex];
    if (!terminal.valid) continue;
    std::string_view scaled;
    if (!detail::parseUnaryEdge(terminal.expression, "fptrunc double ",
                                " to float", &scaled))
      continue;
    size_t scaleIndex = 0;
    const detail::Assignment *scale = detail::findDefinition(
        definitions, assignments, scaled, &scaleIndex);
    if (!scale) continue;

    std::string_view converted;
    std::string_view source;
    size_t convertIndex = 0;
    const detail::Assignment *convert = nullptr;
    size_t maskIndex = 0;
    const detail::Assignment *mask = nullptr;

    if (detail::parseBinaryEdge(scale->expression, "fmul fast double ",
                                ", " + std::string(kUnorm24DoubleScale),
                                &converted) &&
        (convert = detail::findDefinition(definitions, assignments, converted,
                                          &convertIndex)) &&
        detail::parseUnaryEdge(convert->expression, "uitofp i32 ",
                               " to double", &source) &&
        (mask = detail::findDefinition(definitions, assignments, source,
                                       &maskIndex))) {
      std::string_view ignored;
      if (detail::parseBinaryEdge(mask->expression, "and i32 ", ", 16777215",
                                  &ignored)) {
        if (!registerAction(detail::InjectCacheGraphKind::kUnorm24,
                            convertIndex, scaleIndex, terminalIndex, source))
          return {Unorm24TransformStatus::kNoMatch, 0};
        continue;
      }
    }

    if (detail::parseBinaryEdge(scale->expression, "fmul fast double ",
                                ", " + std::string(kUnorm16DoubleScale),
                                &converted) &&
        (convert = detail::findDefinition(definitions, assignments, converted,
                                          &convertIndex)) &&
        detail::parseUnaryEdge(convert->expression, "sitofp i32 ",
                               " to double", &source) &&
        (mask = detail::findDefinition(definitions, assignments, source,
                                       &maskIndex))) {
      std::string_view ignored;
      if (detail::parseBinaryEdge(mask->expression, "and i32 ", ", 65535",
                                  &ignored)) {
        if (!registerAction(detail::InjectCacheGraphKind::kUnorm16TimesTwo,
                            convertIndex, scaleIndex, terminalIndex, source))
          return {Unorm24TransformStatus::kNoMatch, 0};
        continue;
      }
    }

    if (detail::parseBinaryEdge(scale->expression, "fmul fast double ",
                                ", " + std::string(kMilliDoubleScale),
                                &converted) &&
        (convert = detail::findDefinition(definitions, assignments, converted,
                                          &convertIndex)) &&
        detail::parseUnaryEdge(convert->expression, "uitofp i32 ",
                               " to double", &source) &&
        detail::isInjectCacheResult5Load(definitions, assignments, source)) {
      if (!registerAction(detail::InjectCacheGraphKind::kMilliResult5,
                          convertIndex, scaleIndex, terminalIndex, source))
        return {Unorm24TransformStatus::kNoMatch, 0};
    }
  }

  // The encoder starts with a direct [0,2] clamp.  The replacement preserves
  // its f64 truncation behavior using the validated 32768/borrow identity,
  // while keeping all intermediates at i32/f32 precision.
  for (size_t terminalIndex = 0; terminalIndex < assignments.size();
       ++terminalIndex) {
    const detail::Assignment &terminal = assignments[terminalIndex];
    if (!terminal.valid) continue;
    std::string_view scaled;
    if (!detail::parseUnaryEdge(terminal.expression, "fptosi double ",
                                " to i32", &scaled))
      continue;
    size_t scaleIndex = 0;
    const detail::Assignment *scale = detail::findDefinition(
        definitions, assignments, scaled, &scaleIndex);
    if (!scale) continue;
    std::string_view extended;
    if (!detail::parseBinaryEdge(scale->expression, "fmul fast double ",
                                 ", " + std::string(kEncodeDoubleScale),
                                 &extended))
      continue;
    size_t convertIndex = 0;
    const detail::Assignment *convert = detail::findDefinition(
        definitions, assignments, extended, &convertIndex);
    std::string_view clamped;
    if (!convert ||
        !detail::parseUnaryEdge(convert->expression, "fpext float ",
                                " to double", &clamped) ||
        !detail::isDirectClampZeroToTwo(definitions, assignments, clamped) ||
        !detail::isDirectLow16EncodeSink(assignments, terminal.result))
      continue;
    if (!registerAction(detail::InjectCacheGraphKind::kClampedEncode,
                        convertIndex, scaleIndex, terminalIndex, clamped))
      return {Unorm24TransformStatus::kNoMatch, 0};
  }

  if (actions.size() != kExpectedGraphs ||
      unorm24Count != kExpectedUnorm24 || unorm16Count != kExpectedUnorm16 ||
      milliCount != kExpectedMilli || encodeCount != kExpectedEncode)
    return {Unorm24TransformStatus::kNoMatch, 0};
  for (size_t index = 0; index < lines.size(); ++index)
    if (detail::lineHasFp64(lines[index]) && !claimed[index])
      return {Unorm24TransformStatus::kNoMatch, 0};

  std::vector<int> actionAt(lines.size(), -1);
  for (size_t actionIndex = 0; actionIndex < actions.size(); ++actionIndex) {
    const detail::InjectCacheAction &action = actions[actionIndex];
    actionAt[action.convert_index] = static_cast<int>(actionIndex);
    actionAt[action.scale_index] = static_cast<int>(actionIndex);
    actionAt[action.terminal_index] = static_cast<int>(actionIndex);
  }

  output->reserve(input.size() + actions.size() * 256);
  for (size_t index = 0; index < lines.size(); ++index) {
    const int actionIndex = actionAt[index];
    if (actionIndex < 0) {
      output->append(lines[index]);
    } else {
      const detail::InjectCacheAction &action =
          actions[static_cast<size_t>(actionIndex)];
      const detail::Assignment &convert = assignments[action.convert_index];
      const detail::Assignment &scale = assignments[action.scale_index];
      const detail::Assignment &terminal = assignments[action.terminal_index];
      if (index == action.convert_index) {
        output->append(convert.indent);
        output->append(convert.result);
        if (action.kind == detail::InjectCacheGraphKind::kClampedEncode) {
          output->append(" = fmul float ");
          output->append(action.input);
          output->append(", ");
          output->append(kEncodeFloatScale);
        } else {
          output->append(action.kind ==
                                 detail::InjectCacheGraphKind::kUnorm16TimesTwo
                             ? " = sitofp i32 "
                             : " = uitofp i32 ");
          output->append(action.input);
          output->append(" to float");
        }
      } else if (index == action.scale_index) {
        if (action.kind == detail::InjectCacheGraphKind::kClampedEncode) {
          const std::string_view suffix = scale.result.substr(1);
          output->append(scale.indent);
          output->append("%yaagl_enc_");
          output->append(suffix);
          output->append("_whole = fptoui float ");
          output->append(convert.result);
          output->append(" to i32\n");
          output->append(scale.indent);
          output->append("%yaagl_enc_");
          output->append(suffix);
          output->append("_wholef = uitofp i32 %yaagl_enc_");
          output->append(suffix);
          output->append("_whole to float\n");
          output->append(scale.indent);
          output->append("%yaagl_enc_");
          output->append(suffix);
          output->append("_frac = fsub float ");
          output->append(convert.result);
          output->append(", %yaagl_enc_");
          output->append(suffix);
          output->append("_wholef\n");
          output->append(scale.indent);
          output->append("%yaagl_enc_");
          output->append(suffix);
          output->append("_half = fmul float ");
          output->append(convert.result);
          output->append(", 0x3EF0000000000000\n");
          output->append(scale.indent);
          output->append("%yaagl_enc_");
          output->append(suffix);
          output->append("_borrow1 = fcmp olt float %yaagl_enc_");
          output->append(suffix);
          output->append("_frac, %yaagl_enc_");
          output->append(suffix);
          output->append("_half\n");
          output->append(scale.indent);
          output->append("%yaagl_enc_");
          output->append(suffix);
          output->append("_borrow = zext i1 %yaagl_enc_");
          output->append(suffix);
          output->append("_borrow1 to i32\n");
          output->append(scale.indent);
          output->append(scale.result);
          output->append(" = sub i32 %yaagl_enc_");
          output->append(suffix);
          output->append("_whole, %yaagl_enc_");
          output->append(suffix);
          output->append("_borrow");
        } else {
          output->append(scale.indent);
          output->append(scale.result);
          output->append(" = fdiv float ");
          output->append(convert.result);
          output->append(", ");
          switch (action.kind) {
          case detail::InjectCacheGraphKind::kUnorm24:
            output->append(kUnorm24FloatDenominator);
            break;
          case detail::InjectCacheGraphKind::kUnorm16TimesTwo:
            output->append(kUnorm16FloatDenominator);
            break;
          case detail::InjectCacheGraphKind::kMilliResult5:
            output->append(kMilliFloatDenominator);
            break;
          case detail::InjectCacheGraphKind::kClampedEncode:
            break;
          }
        }
      } else {
        output->append(terminal.indent);
        output->append(terminal.result);
        if (action.kind == detail::InjectCacheGraphKind::kClampedEncode) {
          output->append(" = add i32 ");
          output->append(scale.result);
          output->append(", 0");
        } else {
          output->append(" = fadd float ");
          output->append(scale.result);
          output->append(", 0.000000e+00");
        }
      }
    }
    if (index + 1 < lines.size()) output->push_back('\n');
  }
  if (hadTrailingNewline) output->push_back('\n');
  return {Unorm24TransformStatus::kSuccess, actions.size()};
}

}  // namespace yaagl::metal_ir

import { join } from "path-browserify";
import {
  cp,
  exec,
  fileOrDirExists,
  mkdirp,
  readBinary,
  readFile,
  stats,
  writeFile,
} from "@utils";
import {
  D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST,
  D3DMETAL_LAUNCH_ENVIRONMENT,
  D3DMETAL_VERSION,
  ZZZ_D3D12_SELECTOR,
} from "../wine/d3dmetal";
import {
  hashMetalIrV2AcknowledgementBytes,
  MetalIrV2Acknowledgement,
  MetalIrV2AckExpectation,
  METAL_IR_V2_MAX_CONTROL_BYTES,
  parseMetalIrV2AcknowledgementBytes,
  parseMetalIrV2AcknowledgementFilename,
  sha256Hex,
} from "./metal-ir-v2-protocol";

const ZZZ_D3DMETAL_WINE_TAG = "11.0-1-crossover-signed-experimental" as const;
const ZZZ_STEAM_EXECUTABLE = "C:\\windows\\system32\\steam.exe";
const ZZZ_GAME_EXECUTABLE =
  "Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe";

export const D3DMETAL_SYSTEM_LOG_PREDICATE =
  '(process == "wine" OR process BEGINSWITH "wine-") AND (subsystem == "D3DMetal" OR subsystem == "MetalIRConverter" OR category == "D3DMetal" OR subsystem BEGINSWITH "com.apple.AGX" OR eventMessage CONTAINS[c] "CreateStateObject" OR eventMessage CONTAINS[c] "CreateExecutableStateObject" OR eventMessage CONTAINS[c] "D3D12_STATE_OBJECT_TYPE" OR eventMessage CONTAINS[c] "D3D12_PIPELINE_STATE_SUBOBJECT_TYPE" OR eventMessage CONTAINS[c] "Ray Tracing State Object" OR eventMessage CONTAINS[c] "Failed to compile stage" OR eventMessage CONTAINS[c] "marking PSO")';

export type D3DMetalSelectedRenderer =
  | "d3d12"
  | "d3d11"
  | "moltenvk"
  | "unknown"
  | "conflict";

export type D3DMetalDxrCapability =
  | "supported"
  | "unsupported"
  | "missing"
  | "conflict";

export type D3DMetalDxrRuntimeStatus =
  | "disabled"
  | "pending"
  | "verified"
  | "pipeline-unobserved"
  | "pipeline-failed"
  | "shader-graph-failed"
  | "unsupported"
  | "conflict"
  | "profile-mismatch"
  | "backend-unverified"
  | "capability-missing"
  | "evidence-unreadable";

export interface D3DMetalDxrRuntimeStatusDisplay {
  status: D3DMetalDxrRuntimeStatus;
  label: string;
}

export type D3DMetalMtl4RuntimeStatus =
  | "disabled"
  | "pending"
  | "verified"
  | "profile-mismatch"
  | "backend-unverified"
  | "evidence-unreadable";

export interface D3DMetalMtl4RuntimeStatusDisplay {
  status: D3DMetalMtl4RuntimeStatus;
  label: string;
}

export type D3DMetalMetalFxRuntimeStatus =
  | "disabled"
  | "pending"
  | "verified"
  | "conversion-unverified"
  | "runtime-failed"
  | "profile-mismatch"
  | "backend-unverified"
  | "evidence-unreadable";

export interface D3DMetalMetalFxRuntimeStatusDisplay {
  status: D3DMetalMetalFxRuntimeStatus;
  label: string;
}

export interface D3DMetalPlayerLogFingerprint {
  size: number;
  sha256: string;
  inode: number;
  modifiedAtSeconds: number;
}

export interface D3DMetalLaunchProfile {
  createdAt: string;
  wineTag: string;
  d3dMetalVersion: typeof D3DMETAL_VERSION;
  launchProgram: string;
  gameExecutable: string;
  arguments: string[];
  environment: Record<string, string>;
  launchExitCode: number | null;
  metalIrTerminalStatus: "complete" | "incomplete" | "unavailable" | null;
  metalIrSessionRoot?: string;
  metalIrAggregation?: D3DMetalMetalIrAggregation;
  metalIrProbe?: {
    mode:
      | "metal-ir-observe-v1"
      | "metal-ir-unorm-fix-v2"
      | "metal-ir-unorm-fix-v2-rt"
      | "metal-ir-capture-v2";
    passive?: boolean;
    capturePath?: string;
    captureHash?: string;
    manifestPath?: string;
    aggregateManifestPath?: string;
    d3dMetalPath?: string;
    providerPath?: string;
    d3dMetalHash?: string;
    probeHash?: string;
    probePath?: string;
    providerHash?: string;
    dxcompilerHash?: string;
    dxcompilerPath?: string;
    replacementHash?: string;
    replacementPath?: string;
    controlHelperPath?: string;
    controlHelperHash?: string;
    controlAcknowledgementPath?: string;
    controlAcknowledgementHash?: string;
    controlArmPath?: string;
    controlArmHash?: string;
    controlTerminalValid?: boolean;
    runId?: string;
    sourceRevision?: string;
    buildIdentity?: string;
    sessionRoot?: string;
  };
}

export interface D3DMetalMetalIrInstanceMarker {
  runId: string;
  pid: number;
  instance: string;
  manifestPath: string;
}

export interface D3DMetalMetalIrManifestRecord {
  sequence?: number;
  payload_path?: string;
  payload_length?: number;
  payload_sha256?: string;
  targetObserved?: boolean;
  caller_offset?: number;
  module_identity?: string;
  configured_offset?: string;
  target_predicate?: string;
  module_sha256?: string;
  capture_sha256?: string;
  d3dmetal_sha256?: string;
}

export interface D3DMetalMetalIrManifest {
  schema?: number;
  run_id?: string;
  runId?: string;
  pid?: number;
  instance_id?: string;
  complete?: boolean;
  terminal_status?: string;
  records?: D3DMetalMetalIrManifestRecord[];
  omissions?: unknown[];
  omission_count?: number;
  overflow?: boolean;
  queued?: number;
  published?: number;
  aggregate?: {
    wrapper_entries?: number;
    offset_overflow?: number;
    original_calls?: number;
    target_records?: number;
  };
  failures?: string[];
  failure_diagnostics?: Record<string, boolean>;
  publication_failed?: boolean;
  containment_failed?: boolean;
  collision_failed?: boolean;
  restore_failed?: boolean;
  waterfall_invariant_failed?: boolean;
}

export interface D3DMetalMetalIrAggregation {
  lifecycleValid: boolean;
  sessionComplete: boolean;
  targetObserved: boolean;
  payloadValid: boolean;
  payloadParseable: boolean;
  finalEvidenceReady: boolean;
  visualStatus: "unverified" | "not-ready";
  analysisReady: boolean;
  instances: D3DMetalMetalIrInstanceMarker[];
  manifests: D3DMetalMetalIrManifest[];
  records: D3DMetalMetalIrManifestRecord[];
  failures?: string[];
  reason: string | null;
}

export function validateD3DMetalDxilContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 32) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "DXBC") return false;
  const containerSize = view.getUint32(24, true);
  const chunkCount = view.getUint32(28, true);
  if (containerSize !== bytes.byteLength || chunkCount === 0) return false;
  if (32 + chunkCount * 4 > bytes.byteLength) return false;
  let hasDxil = false;
  for (let i = 0; i < chunkCount; i += 1) {
    const offset = view.getUint32(32 + i * 4, true);
    if (offset < 32 || offset + 8 > bytes.byteLength) return false;
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.byteLength) return false;
    const fourcc = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    if (fourcc === "DXIL") hasDxil = size > 0;
  }
  return hasDxil;
}

export const D3DMETAL_IR_SCAN_INTERVAL_MS = 100;
export const D3DMETAL_IR_STABLE_SEAL_MS = 500;
export const D3DMETAL_IR_TERMINAL_DEADLINE_MS = 30_000;
export const D3DMETAL_CAPTURE_CONFIGURED_OFFSET = "0x87ec9" as const;
export const D3DMETAL_CAPTURE_TARGET_PREDICATE =
  "exact-offset-precall-dxil" as const;

export interface D3DMetalCaptureAcknowledgement
  extends MetalIrV2Acknowledgement {
  path: string;
  rawBytes: Uint8Array;
  rawSha256: string;
}

export const D3DMETAL_CAPTURE_MAX_CONTROL_BYTES =
  METAL_IR_V2_MAX_CONTROL_BYTES;

function secureHexToken(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, value => value.toString(16).padStart(2, "0")).join("");
}

export interface D3DMetalProcessCandidate {
  pid: number;
  ppid: number;
  startIdentity: string;
  args: string;
}

export interface D3DMetalProcessIdentity {
  pid: number;
  uid?: number;
  ppid?: number;
  startIdentity: string;
  args?: string;
}

export function parseD3DMetalProcessIdentity(value: string): D3DMetalProcessIdentity | null {
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(value);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 && match[2]
    ? { pid, startIdentity: match[2] }
    : null;
}

export function equalD3DMetalProcessIdentity(
  left: D3DMetalProcessIdentity | null | undefined,
  right: D3DMetalProcessIdentity | null | undefined
) {
  return !!left && !!right && left.pid === right.pid &&
    left.uid === right.uid && left.startIdentity === right.startIdentity;
}

export function parseD3DMetalDetailedProcessIdentity(
  value: string
): D3DMetalProcessIdentity | null {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s*(.*)$/.exec(value);
  if (!match) return null;
  const [pid, uid, ppid] = match.slice(1, 4).map(Number);
  if (![pid, uid, ppid].every(Number.isSafeInteger) || pid <= 0 || uid < 0 || ppid < 0) {
    return null;
  }
  return {
    pid,
    uid,
    ppid,
    startIdentity: match[4].trim(),
    args: match[5],
  };
}

export interface D3DMetalLsofRecord {
  pid: number;
  command?: string;
  fd?: string;
  dev?: bigint;
  inode?: bigint;
  type?: string;
  name?: string;
}

function parseLsofBigInt(value: string, radix: 10 | 16) {
  value = value.replace(/^0x/i, "");
  if (!value || !/^[0-9a-f]+$/i.test(value)) return undefined;
  try {
    return BigInt(radix === 16 ? `0x${value}` : value);
  } catch {
    return undefined;
  }
}

/** Parse NUL-delimited lsof -F0pcfDintn output without relying on field order. */
export function parseD3DMetalLsofFields(output: Uint8Array | string): D3DMetalLsofRecord[] {
  const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
  const records: D3DMetalLsofRecord[] = [];
  let current: D3DMetalLsofRecord | undefined;
  let seenPid = false;
  let token: number[] = [];
  const finish = () => {
    if (!token.length) throw new Error("empty lsof field");
    const tag = String.fromCharCode(token[0]);
    const value = new TextDecoder().decode(new Uint8Array(token.slice(1)));
    token = [];
    if (!"pcfDintn".includes(tag)) throw new Error(`unknown lsof field: ${tag}`);
    if (tag === "p") {
      if (seenPid) throw new Error("duplicate lsof process");
      const pid = Number(value);
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("invalid lsof pid");
      if (current) records.push(current);
      current = { pid };
      seenPid = true;
      return;
    }
    if (!current) throw new Error("lsof field before pid");
    if (tag === "c") {
      if (current.command !== undefined) throw new Error("duplicate lsof command");
      current.command = value;
    }
    else if (tag === "f") {
      if (current.fd !== undefined || current.name !== undefined) {
        records.push(current);
        current = { pid: current.pid, command: current.command };
      }
      if (current.fd !== undefined) throw new Error("duplicate lsof fd");
      current.fd = value;
    }
    else if (tag === "D") {
      if (current.dev !== undefined) throw new Error("duplicate lsof device");
      current.dev = parseLsofBigInt(value, 16);
    }
    else if (tag === "i") {
      if (current.inode !== undefined) throw new Error("duplicate lsof inode");
      current.inode = parseLsofBigInt(value, 10);
    }
    else if (tag === "t") {
      if (current.type !== undefined) throw new Error("duplicate lsof type");
      current.type = value.trim();
    }
    else if (tag === "n") {
      if (current.name !== undefined) throw new Error("duplicate lsof name");
      current.name = value;
    }
  };
  for (const byte of bytes) {
    if (byte === 0) finish();
    else if (byte === 10 && token.length === 0) continue;
    else token.push(byte);
  }
  if (token.length) throw new Error("unterminated lsof field");
  if (current) records.push(current);
  return records;
}

export interface D3DMetalExpectedVnodePath {
  requestedPath: string;
  canonicalPath: string;
  realPath?: string;
  device: bigint;
  inode: bigint;
}

export interface D3DMetalExpectedVnodeFsOperations {
  lstat(path: string): Promise<{ type: string; dev?: bigint; ino?: bigint }>;
  stat(path: string): Promise<{ type: string; dev?: bigint; ino?: bigint }>;
  realpath(path: string): Promise<string>;
}

function isAbsoluteCleanD3DMetalPath(path: string) {
  return path.startsWith("/") && !path.split("/").some(part => part === "." || part === ".." || part.includes("\\"));
}

export async function preflightD3DMetalExpectedVnode(
  requestedPath: string,
  fs: D3DMetalExpectedVnodeFsOperations
): Promise<D3DMetalExpectedVnodePath> {
  if (!isAbsoluteCleanD3DMetalPath(requestedPath)) throw new Error("expected vnode path must be absolute and clean");
  const parts = requestedPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts.slice(0, -1)) {
    current += `/${part}`;
    const entry = await fs.lstat(current);
    if (entry.type === "LNK") throw new Error("expected vnode path contains symlink component");
    if (entry.type !== "DIR") throw new Error("expected vnode parent is not a directory");
  }
  const link = await fs.lstat(requestedPath);
  if (link.type !== "REG") throw new Error("expected vnode is not a regular file");
  const canonicalPath = await fs.realpath(requestedPath);
  if (!isAbsoluteCleanD3DMetalPath(canonicalPath)) throw new Error("canonical vnode path is not clean");
  const target = await fs.stat(requestedPath);
  if (target.type !== "REG" || target.dev === undefined || target.ino === undefined) throw new Error("expected vnode stat rejected");
  const canonicalLink = await fs.lstat(canonicalPath);
  const canonicalTarget = await fs.stat(canonicalPath);
  if (canonicalLink.type !== "REG" || canonicalTarget.type !== "REG" ||
      canonicalTarget.dev !== target.dev || canonicalTarget.ino !== target.ino ||
      target.ino <= BigInt(0)) {
    throw new Error("expected canonical vnode identity rejected");
  }
  return { requestedPath, canonicalPath, realPath: canonicalPath === requestedPath ? undefined : canonicalPath, device: target.dev, inode: target.ino };
}

export interface D3DMetalVnodePathEvidence {
  type?: string;
  name?: string;
  dev?: bigint;
  inode?: bigint;
}

function normalizeD3DMetalPath(value: string) {
  return value.replace(/\/+$/, "");
}

export function isD3DMetalExpectedVnodePath(
  evidence: D3DMetalVnodePathEvidence,
  expected: D3DMetalExpectedVnodePath
) {
  if (evidence.type !== "REG" || evidence.dev !== expected.device || evidence.inode !== expected.inode) return false;
  const name = normalizeD3DMetalPath(evidence.name || "");
  const paths = [expected.canonicalPath, expected.realPath].filter((value): value is string => !!value)
    .map(normalizeD3DMetalPath);
  return paths.includes(name);
}

export function hasD3DMetalExpectedVnode(
  records: D3DMetalLsofRecord[],
  expected: D3DMetalExpectedVnodePath
) {
  return records.some(record => isD3DMetalExpectedVnodePath(record, expected));
}

export type D3DMetalVnodeValidation =
  | { ok: true; vnode: { dev: bigint; inode: bigint }; paths: string[] }
  | { ok: false; reason: "missing" | "conflicting-vnode" | "hard-link-alias" };

/** Validate the configured executable as one canonical vnode, fail-closed on aliases/conflicts. */
export function validateD3DMetalExpectedVnode(
  records: D3DMetalLsofRecord[],
  expected: D3DMetalExpectedVnodePath
): D3DMetalVnodeValidation {
  const paths = new Set(
    [expected.canonicalPath, expected.realPath]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeD3DMetalPath)
  );
  const matches = records.filter(record => record.type === "REG" && paths.has(normalizeD3DMetalPath(record.name || "")) && !/ \(deleted\)$/i.test(record.name || ""));
  if (!matches.length) return { ok: false, reason: "missing" };
  const aliases = records.filter(record => record.type === "REG" && record.dev === expected.device && record.inode === expected.inode && !paths.has(normalizeD3DMetalPath(record.name || "")));
  if (aliases.length) return { ok: false, reason: "hard-link-alias" };
  const vnodes = new Set(matches.map(record => `${record.dev?.toString()}:${record.inode?.toString()}`));
  if (vnodes.size !== 1) return { ok: false, reason: "conflicting-vnode" };
  const vnode = matches[0];
  if (vnode.dev !== expected.device || vnode.inode !== expected.inode) return { ok: false, reason: "hard-link-alias" };
  return { ok: true, vnode: { dev: vnode.dev!, inode: vnode.inode! }, paths: [...new Set(matches.map(record => record.name!))] };
}

export function hasD3DMetalRuntimeModules(records: D3DMetalLsofRecord[]) {
  return records.some(record => /D3DMetal\.framework(?:\/|$)/i.test(record.name || "")) &&
    records.some(record => /(?:^|\/)d3d12\.dll(?:$|\s)/i.test(record.name || ""));
}

export function hasD3DMetalRequiredArtifacts(
  records: D3DMetalLsofRecord[],
  requiredPaths: readonly string[]
) {
  const actual = new Set(records.filter(record => record.type === "REG" && record.name).map(record => normalizeD3DMetalPath(record.name!)));
  const required = new Set(requiredPaths.map(normalizeD3DMetalPath));
  return [...required].every(path => actual.has(path));
}

export function validateD3DMetalRequiredVnodes(
  records: D3DMetalLsofRecord[],
  expected: readonly D3DMetalExpectedVnodePath[]
) {
  const validations = expected.map(item => validateD3DMetalExpectedVnode(records, item));
  if (validations.some(item => !item.ok)) {
    return { ok: false as const, validations };
  }
  return {
    ok: true as const,
    vnodes: expected.map((item, index) => ({
      canonicalPath: item.canonicalPath,
      device: item.device,
      inode: item.inode,
      paths: validations[index].ok
        ? (validations[index] as Extract<D3DMetalVnodeValidation, { ok: true }>).paths
        : [],
    })),
  };
}

export function equalD3DMetalRequiredVnodes(
  left: readonly D3DMetalExpectedVnodePath[],
  right: readonly D3DMetalExpectedVnodePath[]
) {
  return left.length === right.length && left.every((item, index) =>
    item.canonicalPath === right[index].canonicalPath &&
    item.device === right[index].device && item.inode === right[index].inode
  );
}

const NON_GAME_PROCESS_RE =
  /(?:cef|chrome|ZFGameBrowser\.exe|UnityCrashHandler|helper)/i;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findAuthoritativeD3DMetalGameCandidates(
  processList: string,
  gameExecutable: string,
  _launchPid: number,
  _prefixIdentity?: string
): D3DMetalProcessCandidate[] {
  const expected = gameExecutable.replaceAll("\\", "/").toLowerCase();
  const nativeExpected = expected.replace(/^z:/, "");
  const basename = expected.split("/").pop()!;
  const rows = processList.split(/\r?\n/).flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/.exec(line);
    if (!match) return [];
    return [
      {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        startIdentity: match[3].trim(),
        args: match[4],
      },
    ];
  });
  return rows.filter(row => {
    const normalized = row.args.replaceAll("\\", "/").toLowerCase();
    const exactCommand =
      new RegExp(`(?:^|\\s)"?${escapeRegExp(expected)}(?:"?(?:\\s|$))`, "i").test(normalized) ||
      new RegExp(`(?:^|\\s)"?${escapeRegExp(nativeExpected)}(?:"?(?:\\s|$))`, "i").test(normalized);
    return (
      exactCommand &&
      normalized.includes(basename) &&
      !NON_GAME_PROCESS_RE.test(row.args) &&
      Number.isSafeInteger(row.pid) &&
      row.pid > 0
    );
  });
}

export async function waitForD3DMetalCaptureAcknowledgement({
  path,
  expected,
  snapshotGameExecutable = expected.configured_game_executable || "",
  candidates: _candidates,
  snapshot,
  processIdentity,
  expectedVnode,
  expectedVnodes,
  requiredArtifactPaths,
  enumerate = () => enumerateD3DMetalCaptureAcknowledgements({
    directory: path,
    expected,
  }),
  timeoutMs = 10_000,
  pollIntervalMs = 100,
  sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
}: {
  path: string;
  expected: MetalIrV2AckExpectation;
  snapshotGameExecutable?: string;
  /** Retained only for source compatibility; never participates in authority. */
  candidates?: D3DMetalProcessCandidate[];
  snapshot: (pid: number) => Promise<Uint8Array | string>;
  processIdentity?: (pid: number) => Promise<D3DMetalProcessIdentity | null>;
  expectedVnode?: D3DMetalExpectedVnodePath;
  expectedVnodes?: readonly D3DMetalExpectedVnodePath[];
  requiredArtifactPaths?: readonly string[];
  enumerate?: () => Promise<D3DMetalCaptureAcknowledgement[]>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<D3DMetalCaptureAcknowledgement> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "acknowledgement missing";
  while (Date.now() <= deadline) {
    try {
      const acknowledgements = await enumerate();
      if (acknowledgements.length > 1) {
        lastError = "multiple validated ACKs";
        await sleep(pollIntervalMs);
        continue;
      }
      const ack = acknowledgements[0];
      if (ack) {
        const identity = processIdentity ? await processIdentity(ack.pid!) : null;
        const lsof = await snapshot(ack.pid!);
        const records = parseD3DMetalLsofFields(lsof);
        if (records.some(record => record.pid !== ack.pid)) throw new Error("lsof PID mismatch");
        const vnodeOk = expectedVnodes ? validateD3DMetalRequiredVnodes(records, expectedVnodes).ok :
          expectedVnode ? validateD3DMetalExpectedVnode(records, expectedVnode).ok :
          typeof lsof === "string" && lsof.includes(snapshotGameExecutable);
        if (!identity && processIdentity || !vnodeOk || requiredArtifactPaths && !hasD3DMetalRequiredArtifacts(records, requiredArtifactPaths) || !requiredArtifactPaths && !hasD3DMetalRuntimeModules(records) && expectedVnode ||
            (!expectedVnode && !expectedVnodes && typeof lsof === "string" &&
              (!/D3DMetal\.framework/i.test(lsof) || !/d3d12\.dll/i.test(lsof)))) {
          lastError = "authoritative game lsof identity mismatch";
        } else {
          if (processIdentity) {
            const recheck = await processIdentity(ack.pid!);
            if (!equalD3DMetalProcessIdentity(identity, recheck)) {
              lastError = "process identity changed";
              await sleep(pollIntervalMs);
              continue;
            }
          }
          return ack;
        }
      } else {
        lastError = "no authoritative ACK";
      }
    } catch {
      lastError = "acknowledgement unreadable";
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`capture acknowledgement timeout: ${lastError}`);
}

export async function armD3DMetalCaptureSession({
  sessionRoot,
  runId,
}: {
  sessionRoot: string;
  runId: string;
}) {
  await prepareD3DMetalCaptureSession(sessionRoot);
  const ledgerRoot = join(sessionRoot, "ledger");
  await mkdirp(ledgerRoot);
  const attemptId = `${runId}-${Date.now()}`;
  if (!/^[0-9]{13}-[0-9]{13}$/.test(attemptId)) throw new Error("invalid capture attempt id");
  const token = secureHexToken(16);
  const attemptPath = join(ledgerRoot, `attempt-${attemptId}`);
  await exec([
    "/bin/sh",
    "-c",
    'umask 077; set -C; printf "%s\\n" "$2" > "$1"; sync',
    "yaagl-attempt",
    attemptPath,
    token,
  ]);
  return {
    attemptId,
    token,
    attemptPath,
    acknowledgementPath: join(sessionRoot, "acks"),
    ackDirectory: join(sessionRoot, "acks"),
    armDirectory: join(sessionRoot, "arms"),
    controlsDirectory: join(sessionRoot, "controls"),
  };
}

export async function prepareD3DMetalCaptureSession(sessionRoot: string) {
  for (const name of [
    "acks",
    "arms",
    "controls",
    "instances",
    "markers",
  ]) {
    const path = join(sessionRoot, name);
    await mkdirp(path);
    await exec(["/bin/chmod", "700", path]);
  }
  await exec(["/bin/chmod", "700", sessionRoot]);
  await exec(["/bin/sync"]);
}

export async function enumerateD3DMetalCaptureAcknowledgements({
  directory,
  expected,
}: {
  directory: string;
  expected: MetalIrV2AckExpectation;
}) {
  const names = (await exec(["/usr/bin/find", directory, "-mindepth", "1", "-maxdepth", "1", "-print"])).stdOut
    .split(/\r?\n/).filter(Boolean).map(path => path.slice(directory.length + 1));
  const acknowledgements: D3DMetalCaptureAcknowledgement[] = [];
  for (const name of names) {
    const filename = parseMetalIrV2AcknowledgementFilename(name);
    if (!filename) throw new Error("malformed capture ACK filename");
    const path = join(directory, name);
    await exec(["/bin/test", "!", "-L", path]);
    const size = Number((await exec(["/usr/bin/stat", "-f", "%z", path])).stdOut.trim());
    if (!Number.isSafeInteger(size) || size <= 0 || size > D3DMETAL_CAPTURE_MAX_CONTROL_BYTES) throw new Error("capture ACK size rejected");
    const owner = Number((await exec(["/usr/bin/stat", "-f", "%u", path])).stdOut.trim());
    const currentOwner = Number((await exec(["/usr/bin/id", "-u"])).stdOut.trim());
    const mode = Number.parseInt((await exec(["/usr/bin/stat", "-f", "%Lp", path])).stdOut.trim(), 8);
    const links = Number((await exec(["/usr/bin/stat", "-f", "%l", path])).stdOut.trim());
    if (owner !== currentOwner || !Number.isInteger(mode) || mode !== 0o600 || links !== 1) throw new Error("capture ACK owner/mode/link rejected");
    const rawBytes = new Uint8Array(await readBinary(path));
    const value = parseMetalIrV2AcknowledgementBytes(rawBytes, expected);
    if (value.pid !== filename.pid || value.nonce !== filename.nonce) {
      throw new Error("capture ACK filename identity rejected");
    }
    acknowledgements.push({
      ...value,
      path,
      rawBytes,
      rawSha256: hashMetalIrV2AcknowledgementBytes(rawBytes),
    });
  }
  const identities = new Set(acknowledgements.map(value => `${value.pid}:${value.nonce}`));
  if (identities.size !== acknowledgements.length) throw new Error("duplicate capture ACK");
  return acknowledgements;
}

export async function assertD3DMetalCaptureAcknowledgementUnchanged({
  directory,
  expected,
  original,
}: {
  directory: string;
  expected: MetalIrV2AckExpectation;
  original: D3DMetalCaptureAcknowledgement;
}) {
  const acknowledgements = await enumerateD3DMetalCaptureAcknowledgements({
    directory,
    expected,
  });
  if (acknowledgements.length !== 1) {
    throw new Error("capture ACK uniqueness changed");
  }
  const current = acknowledgements[0];
  if (
    current.path !== original.path || current.pid !== original.pid ||
    current.nonce !== original.nonce || current.rawSha256 !== original.rawSha256 ||
    current.rawBytes.byteLength !== original.rawBytes.byteLength ||
    current.rawBytes.some((value, index) => value !== original.rawBytes[index])
  ) {
    throw new Error("capture ACK raw identity changed");
  }
  return current;
}

export async function writeD3DMetalCaptureAuthorityLedger({
  sessionRoot,
  attemptId,
  phase,
  value,
}: {
  sessionRoot: string;
  attemptId: string;
  phase: "initial" | "prearm" | "postarm";
  value: Record<string, unknown>;
}) {
  if (!/^[0-9]{13}-[0-9]{13}$/.test(attemptId)) {
    throw new Error("invalid authority ledger attempt id");
  }
  const destination = join(sessionRoot, "ledger", `authority-${phase}-${attemptId}.json`);
  const serialized = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item
  );
  await exec([
    "/bin/sh",
    "-c",
    'umask 077; set -C; printf "%s" "$2" > "$1"; /bin/chmod 600 "$1"; /bin/sync',
    "yaagl-authority-ledger",
    destination,
    serialized,
  ]);
  const persisted = new Uint8Array(await readBinary(destination));
  const expectedBytes = new TextEncoder().encode(serialized);
  if (
    persisted.byteLength !== expectedBytes.byteLength ||
    persisted.some((item, index) => item !== expectedBytes[index])
  ) {
    throw new Error("authority ledger persistence mismatch");
  }
  return {
    path: destination,
    sha256: sha256Hex(expectedBytes),
  };
}

export async function terminateAndConfirmProcess({
  pid,
  terminate = signal => exec(["/bin/kill", signal, String(pid)]),
  isAlive = async () =>
    (await exec(["/bin/kill", "-0", String(pid)])).exitCode === 0,
  sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
  timeoutMs = 5_000,
}: {
  pid: number;
  terminate?: (signal: string) => Promise<unknown>;
  isAlive?: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}) {
  for (const signal of ["-TERM", "-KILL"]) {
    try {
      await terminate(signal);
    } catch {
      /* already exited */
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (!(await isAlive())) return true;
      await sleep(100);
    }
  }
  throw new Error(`capture process death not confirmed: pid=${pid}`);
}

export async function terminateAndConfirmD3DMetalWineTree({
  rootPid,
  knownPids,
  terminatePrefix,
  terminate = pid => exec(["/bin/kill", "-KILL", String(pid)]),
  isAlive = async pid =>
    (await exec(["/bin/kill", "-0", String(pid)])).exitCode === 0,
  sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
  timeoutMs = 5_000,
}: {
  rootPid: number;
  knownPids: number[];
  terminatePrefix: () => Promise<unknown>;
  terminate?: (pid: number) => Promise<unknown>;
  isAlive?: (pid: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}) {
  try {
    await terminatePrefix();
  } catch {
    /* continue with explicit tree */
  }
  const pids = [...new Set([rootPid, ...knownPids])];
  for (const pid of pids) {
    try {
      await terminate(pid);
    } catch {
      /* already exited */
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const alive = await Promise.all(pids.map(pid => isAlive(pid)));
    if (alive.every(value => !value)) return true;
    await sleep(100);
  }
  throw new Error(
    `Wine prefix process tree death not confirmed: ${pids.join(",")}`
  );
}

export async function startD3DMetalCaptureWithAckGate<T>({
  start,
  acknowledge,
  terminate,
}: {
  start: () => Promise<{
    pid: number;
    result: Promise<T>;
    release?: () => Promise<void>;
  }>;
  acknowledge: (started: {
    pid: number;
    result: Promise<T>;
    release?: () => Promise<void>;
  }) => Promise<D3DMetalCaptureAcknowledgement>;
  terminate?: (pid: number) => Promise<unknown>;
}) {
  const started = await start();
  try {
    const acknowledgement = await acknowledge(started);
    if (started.release) await started.release();
    return { started, acknowledgement };
  } catch (error) {
    if (terminate) await terminate(started.pid);
    else await terminateAndConfirmProcess({ pid: started.pid });
    throw error;
  }
}

export function validateD3DMetalModuleSnapshotForAcknowledgement(
  snapshot: string,
  acknowledgement: Pick<
    D3DMetalCaptureAcknowledgement,
    "pid" | "process_executable" | "configured_game_executable"
  >
) {
  return (
    snapshot.includes(`# pid=${acknowledgement.pid}`) &&
    snapshot.includes(acknowledgement.process_executable) &&
    snapshot.includes(acknowledgement.configured_game_executable) &&
    hasLoadedD3DMetalFramework(snapshot) &&
    /d3d12\.dll/i.test(snapshot)
  );
}

/**
 * The terminal artifact is native-owned evidence. Read it twice without
 * following links and require unchanged bytes before aggregation examines its
 * records and blobs.
 */
export async function readD3DMetalV2InstanceTerminal({
  sessionRoot,
  acknowledgement,
}: {
  sessionRoot: string;
  acknowledgement: Pick<
    D3DMetalCaptureAcknowledgement,
    "run_id" | "pid" | "instance_id" | "manifest_rel"
  >;
}): Promise<D3DMetalMetalIrManifest | null> {
  const path = join(sessionRoot, acknowledgement.manifest_rel);
  try {
    await exec(["/bin/test", "!", "-L", path]);
    await exec(["/bin/test", "-f", path]);
    const first = new Uint8Array(await readBinary(path));
    const firstHash = sha256Hex(first);
    const second = new Uint8Array(await readBinary(path));
    if (firstHash !== sha256Hex(second)) {
      throw new Error("native v2 instance terminal changed while reading");
    }
    if (first.byteLength === 0 || first.byteLength > 128 * 1024) {
      throw new Error("native v2 terminal size rejected");
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(first)
    ) as {
      schema?: number;
      kind?: string;
      run_id?: string;
      pid?: number;
      instance_id?: string;
      status?: string;
      outcome?: string;
      drain?: { records?: number; persisted?: number; in_flight?: number };
    };
    const recordCount = value.drain?.records;
    if (
      value.schema !== 2 ||
      value.kind !== "terminal" ||
      value.run_id !== acknowledgement.run_id ||
      value.pid !== acknowledgement.pid ||
      value.instance_id !== acknowledgement.instance_id ||
      value.status !== "complete" ||
      !["partial_count", "expected_count", "count_divergent"].includes(
        value.outcome || ""
      ) ||
      !Number.isSafeInteger(recordCount) ||
      recordCount! < 1 ||
      recordCount! > 32 ||
      value.drain?.persisted !== recordCount ||
      value.drain?.in_flight !== 0
    ) {
      throw new Error("native v2 instance terminal identity rejected");
    }
    const instanceRoot = join(
      sessionRoot,
      `instances/${acknowledgement.instance_id}`
    );
    const records: D3DMetalMetalIrManifestRecord[] = [];
    for (let index = 0; index < recordCount!; index += 1) {
      const recordPath = join(
        instanceRoot,
        `record_${String(index).padStart(2, "0")}.json`
      );
      await exec(["/bin/test", "!", "-L", recordPath]);
      const recordBytes = new Uint8Array(await readBinary(recordPath));
      if (recordBytes.byteLength === 0 || recordBytes.byteLength > 16 * 1024) {
        throw new Error("native v2 record size rejected");
      }
      const record = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(recordBytes)
      ) as {
        schema?: number;
        kind?: string;
        sequence?: number;
        caller_offset?: string;
        capture?: {
          status?: string;
          blob?: string;
          size?: number;
          sha256?: string;
        };
      };
      if (
        record.schema !== 2 ||
        record.kind !== "record" ||
        record.sequence !== index ||
        record.caller_offset !== D3DMETAL_CAPTURE_CONFIGURED_OFFSET ||
        record.capture?.status !== "captured" ||
        !record.capture.blob ||
        !/^[A-Za-z0-9._-]+$/.test(record.capture.blob) ||
        !Number.isSafeInteger(record.capture.size) ||
        record.capture.size! <= 0 ||
        record.capture.size! > 65_536 ||
        !/^[0-9a-f]{64}$/.test(record.capture.sha256 || "")
      ) {
        throw new Error("native v2 record identity rejected");
      }
      records.push({
        sequence: record.sequence,
        payload_path: record.capture.blob,
        payload_length: record.capture.size,
        payload_sha256: record.capture.sha256,
        targetObserved: true,
        caller_offset: parseInt(D3DMETAL_CAPTURE_CONFIGURED_OFFSET, 16),
        configured_offset: D3DMETAL_CAPTURE_CONFIGURED_OFFSET,
        target_predicate: D3DMETAL_CAPTURE_TARGET_PREDICATE,
      });
    }
    return {
      schema: 2,
      run_id: value.run_id,
      pid: value.pid,
      instance_id: value.instance_id,
      complete: true,
      terminal_status: "complete",
      records,
      omission_count: 0,
      overflow: false,
      queued: records.length,
      published: records.length,
      aggregate: {
        original_calls: records.length,
        target_records: records.length,
      },
    };
  } catch {
    return null;
  }
}

export async function waitForD3DMetalV2Capturing({
  sessionRoot,
  acknowledgement,
  timeoutMs = 10_000,
  beforePoll,
  sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
}: {
  sessionRoot: string;
  acknowledgement: D3DMetalCaptureAcknowledgement;
  timeoutMs?: number;
  beforePoll?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}) {
  const path = join(
    sessionRoot,
    acknowledgement.artifact_dir_rel,
    "capturing.json"
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (beforePoll) await beforePoll();
    try {
      await exec(["/bin/test", "!", "-L", path]);
      const bytes = new Uint8Array(await readBinary(path));
      if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024) {
        throw new Error("capturing marker size rejected");
      }
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      ) as Record<string, unknown>;
      if (
        value.schema === 2 &&
        value.mode === "metal-ir-capture-v2" &&
        value.state === "capturing" &&
        value.pid === acknowledgement.pid &&
        value.nonce === acknowledgement.nonce &&
        value.ack_sha256 === acknowledgement.rawSha256
      ) {
        return path;
      }
    } catch {
      // Readiness is fail-closed and bounded by the launcher deadline.
    }
    await sleep(50);
  }
  throw new Error("v2 capture readiness timeout");
}

export interface D3DMetalMetalIrProbeDiagnostics {
  loaded: boolean;
  resolved: boolean;
  installed: boolean;
  targetEntered: boolean;
  resultObserved: boolean;
  resolverFailed: boolean;
  errorCode: string | null;
  evidence: string[];
}

export const D3DMETAL_STATE_OBJECT_FAILURE_TAGS = {
  "0x8004d001": "descriptor-parser",
  "0x8004d002": "export-config-precheck",
  "0x8004d003": "pipeline-config-inheritance",
  "0x8004d004": "shader-config-inheritance",
} as const;

export type D3DMetalStateObjectFailureStage =
  (typeof D3DMETAL_STATE_OBJECT_FAILURE_TAGS)[keyof typeof D3DMETAL_STATE_OBJECT_FAILURE_TAGS];

export type D3DMetalCompileContext =
  | "rt"
  | "graphics"
  | "compute"
  | "unknown";

export interface D3DMetalCompileObservation {
  sequence: number;
  timeNs: string;
  threadId: string;
  callerOffset: string;
  context: D3DMetalCompileContext;
  stage: string;
  sourceSize: number;
  sourceSha256: string | null;
  captureStatus: string;
  result: "returned_nonnull" | "returned_null" | "unwound";
  errorCode: string | null;
  errorStatus: string;
  sink: "null" | "non-null";
  exportStatus: string;
  exportPath: string | null;
  psoObject: string | null;
  psoId: number | null;
  selection: string | null;
  selectionReason: string | null;
  stackOffsets: string[];
}

export interface D3DMetalError19Correlation {
  systemIndex: number;
  systemStage: string;
  noOpPsoId: number | null;
  observerSequence: number;
  callerOffset: string;
  context: D3DMetalCompileContext;
  observerStage: string;
  sourceSize: number;
  sourceSha256: string | null;
  psoObject: string | null;
  psoId: number | null;
  result: D3DMetalCompileObservation["result"];
  errorCode: "0x13";
}

export interface D3DMetalDxrPipelineDiagnostics {
  rayTracingPsoFailureCount: number;
  rtxgiInvalidStateObjectCount: number;
  createStateObjectFailureCount: number;
  hresultCounts: Record<string, number>;
  stateObjectFailureStage: D3DMetalStateObjectFailureStage | "mixed" | null;
  stateObjectFailureTagCounts: Partial<
    Record<D3DMetalStateObjectFailureStage, number>
  >;
  metalCompileFailureCount: number;
  metalCompileFailuresByStage: Record<string, number>;
  metalCompileError19Count: number;
  metalIrUnhandledFp64Count: number;
  metalIrCompileObservations: D3DMetalCompileObservation[];
  metalIrError19Correlations: D3DMetalError19Correlation[];
  metalIrError19CorrelationComplete: boolean;
  metalIrError19UnmatchedObserverCount: number;
  metalIrError19UnmatchedSystemCount: number;
  noOpPsoCount: number;
  noOpPsoIds: number[];
  rtOutputInstalled: boolean;
  rtOutputValid: boolean;
  rtOutputInvalidReasons: string[];
  rtOutputDispatchCount: number;
  rtOutputCompleteDispatchCount: number;
  rtOutputPaths: string[];
  rtOutputResourceEventCount: number;
  rtOutputWriteResourceEventCount: number;
  rtOutputBarrierEventCount: number;
  rtOutputEvidence: string[];
  rejectedSubobject: string | null;
  rejectedSubobjectEvidence: string[];
  firstFailure: string | null;
}

export interface D3DMetalRuntimeEvidence {
  createdAt: string;
  validatedD3DMetalVersion: string | null;
  exactD3DMetalVersion: boolean;
  playerLogCaptured: boolean;
  moduleSnapshotCaptured: boolean;
  selectedRenderer: D3DMetalSelectedRenderer;
  rendererSource: "player-log" | null;
  rendererEvidence: string[];
  dxrCapability: D3DMetalDxrCapability;
  dxrEvidence: string[];
  dxrPipelineFailed: boolean;
  dxrPipelineDiagnostics: D3DMetalDxrPipelineDiagnostics;
  metalIrProbe: D3DMetalMetalIrProbeDiagnostics;
  metalIrMode:
    | "metal-ir-observe-v1"
    | "metal-ir-unorm-fix-v2"
    | "metal-ir-unorm-fix-v2-rt"
    | "metal-ir-capture-v2"
    | null;
  metalIrPassive: boolean;
  metalIrDiagnosticOnly: boolean;
  metalIrCapturePath: string | null;
  metalIrCaptureHash: string | null;
  metalIrManifestPath: string | null;
  metalIrRunId: string | null;
  metalIrSourceRevision: string | null;
  metalIrBuildIdentity: string | null;
  launchExitCode: number | null;
  metalIrTerminalStatus: "complete" | "incomplete" | "unavailable" | null;
  metalIrDiagnosticPass: boolean;
  metalIrLifecycleValid: boolean;
  metalIrSessionComplete: boolean;
  metalIrTargetObserved: boolean;
  metalIrPayloadValid: boolean;
  metalIrPayloadParseable: boolean;
  metalIrFinalEvidenceReady: boolean;
  metalIrVisualStatus: "unverified" | "not-ready";
  metalIrAnalysisReady: boolean;
  launchProfileVerified: boolean;
  mtl4Configured: boolean;
  mtl4BackendEnabled: boolean;
  mtl4Evidence: string[];
  observations: {
    d3dMetal: boolean;
    d3d12: boolean;
    d3d12Module: boolean;
    nvngx: boolean;
    metalFx: boolean;
    metalFxConversion: boolean;
    metalFxFailure: boolean;
    d3d11: boolean;
    dxmt: boolean;
    moltenVk: boolean;
  };
  backendVerified: boolean;
  metalFxVerified: boolean;
  dxrVerified: boolean;
  verified: boolean;
}

const DIAGNOSTIC_ENVIRONMENT_KEYS = [
  "MTL_HUD_ENABLED",
  "WINE_ENABLE_TIMEOUT_FIX",
  "WINEMSYNC",
  "CX_ACTIVE_GRAPHICS_BACKEND",
  "D3DM_MTL4",
  "D3DM_ENABLE_METALFX",
  "D3DM_SUPPORT_DXR",
  "D3DM_VENDOR_ID",
  "D3DM_DEVICE_ID",
  "D3DM_DEVICE_DESCRIPTION",
  "YAAGL_RUNTIME_MODE",
  "YAAGL_DYLD_INSERT_LIBRARIES",
  "YAAGL_METAL_IR_REPLACEMENT",
  "YAAGL_METAL_IR_CAPTURE_PATH",
  "YAAGL_METAL_IR_CAPTURE_SHA256",
  "YAAGL_METAL_IR_MANIFEST",
  "YAAGL_METAL_IR_PROVIDER",
  "YAAGL_METAL_IR_D3DMETAL",
  "YAAGL_METAL_IR_DXCOMPILER",
  "YAAGL_METAL_IR_D3DMETAL_SHA256",
  "YAAGL_METAL_IR_PROVIDER_SHA256",
  "YAAGL_METAL_IR_RUN_ID",
  "YAAGL_METAL_IR_SOURCE_REVISION",
  "YAAGL_METAL_IR_BUILD_ID",
  "YAAGL_METAL_IR_SESSION_ROOT",
  "YAAGL_METAL_IR_SOURCE",
] as const;

/**
 * Keeps launch evidence useful without persisting proxy URLs or credentials.
 */
export function createD3DMetalDiagnosticEnvironment(
  environment: Record<string, string>
) {
  return Object.fromEntries(
    DIAGNOSTIC_ENVIRONMENT_KEYS.flatMap(key => {
      const value = environment[key];
      return value === undefined || value === "" ? [] : [[key, value]];
    })
  );
}

export function createD3DMetalDiagnosticPaths(
  logsDirectory: string,
  timestamp = Date.now()
) {
  const stem = `d3dmetal_${timestamp}`;
  return {
    wineLog: join(logsDirectory, `${stem}_wine.log`),
    systemLog: join(logsDirectory, `${stem}_system.log`),
    playerLog: join(logsDirectory, `${stem}_player.log`),
    moduleSnapshot: join(logsDirectory, `${stem}_modules.log`),
    metalIrProbe: join(logsDirectory, `${stem}_metal_ir_probe.log`),
    metalIrManifest: join(logsDirectory, `${stem}_metal_ir_manifest.json`),
    metalIrAggregateManifest: join(
      logsDirectory,
      `${stem}_metal_ir_aggregate_manifest.json`
    ),
    metalIrSessionRoot: join(logsDirectory, `${stem}_metal_ir_session`),
    metalIrDxil: join(logsDirectory, `${stem}_fp64.dxil`),
    profile: join(logsDirectory, `${stem}_profile.json`),
    evidence: join(logsDirectory, `${stem}_evidence.json`),
  };
}

function canonicalPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function parseD3DMetalMetalIrInstanceMarkers(
  contents: string,
  expectedRunId?: string
): D3DMetalMetalIrInstanceMarker[] {
  const markers: D3DMetalMetalIrInstanceMarker[] = [];
  const pattern =
    /^capture installed mode=metal-ir-capture-v1 run=([^\s]+) pid=(\d+) instance=([^\s]+) manifest=(\S+)$/;
  const identities = new Set<string>();
  const pairIdentities = new Map<string, string>();
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("capture installed")) {
      const match = pattern.exec(line);
      if (!match) throw new Error("malformed Metal IR instance marker");
      const runId = match[1];
      if (expectedRunId && runId !== expectedRunId) continue;
      const marker = {
        runId,
        pid: Number(match[2]),
        instance: match[3],
        manifestPath: match[4],
      };
      const key = `${marker.runId}:${marker.pid}:${marker.instance}:${marker.manifestPath}`;
      const pair = `${marker.runId}:${marker.pid}:${marker.instance}`;
      if (!Number.isSafeInteger(marker.pid) || marker.pid <= 0) {
        throw new Error("duplicate or invalid Metal IR instance identity");
      }
      const prior = pairIdentities.get(pair);
      if (prior !== undefined && prior !== marker.manifestPath) {
        throw new Error("conflicting Metal IR instance identity");
      }
      if (identities.has(key)) continue;
      pairIdentities.set(pair, marker.manifestPath);
      identities.add(key);
      markers.push(marker);
      continue;
    }
  }
  return markers;
}

export function validateD3DMetalMetalIrPayload(
  record: D3DMetalMetalIrManifestRecord,
  input: {
    sessionRoot: string;
    instance: D3DMetalMetalIrInstanceMarker;
    regular: boolean;
    symlink: boolean;
    byteLength: number;
    sha256: string;
    resolvedPath: string;
  }
) {
  const path = record.payload_path ?? "";
  const length = record.payload_length;
  const resolved = canonicalPath(input.resolvedPath);
  const instanceRoot = canonicalPath(
    join(input.sessionRoot, "instances", input.instance.instance)
  );
  const directChild =
    resolved.startsWith(`${instanceRoot}/`) &&
    !resolved.slice(instanceRoot.length + 1).includes("/");
  const declared = path.includes("/")
    ? canonicalPath(path)
    : canonicalPath(join(instanceRoot, path));
  const declaredDirectChild =
    declared.startsWith(`${instanceRoot}/`) &&
    !declared.slice(instanceRoot.length + 1).includes("/");
  return (
    path !== "" &&
    declaredDirectChild &&
    directChild &&
    input.regular &&
    !input.symlink &&
    length !== undefined &&
    length > 0 &&
    input.byteLength === length &&
    input.sha256.toLowerCase() === (record.payload_sha256 ?? "").toLowerCase()
  );
}

export function aggregateD3DMetalMetalIrManifests({
  runId,
  sessionRoot,
  markers,
  manifests,
  payloadValidity,
  terminalStatus,
  failures = [],
  authoritativeInstanceIds = markers.map(marker => marker.instance),
  directMarkerInstanceIds = markers.map(marker => marker.instance),
  expectedModuleIdentity,
  expectedCaptureHash,
  expectedD3DMetalHash,
  expectedAckPid,
  moduleSnapshotValid = false,
  expectedArmNonce,
}: {
  runId: string;
  sessionRoot: string;
  markers: D3DMetalMetalIrInstanceMarker[];
  manifests: D3DMetalMetalIrManifest[];
  payloadValidity: boolean[];
  terminalStatus: "complete" | "incomplete" | "failed" | null;
  failures?: string[];
  authoritativeInstanceIds?: string[];
  directMarkerInstanceIds?: string[];
  expectedModuleIdentity?: string;
  expectedCaptureHash?: string;
  expectedD3DMetalHash?: string;
  expectedAckPid?: number;
  moduleSnapshotValid?: boolean;
  expectedArmNonce?: string;
}): D3DMetalMetalIrAggregation {
  const identities = new Set<string>();
  const expectedInstanceIds = new Set(authoritativeInstanceIds);
  const lifecycleValid =
    (terminalStatus === "complete" &&
      markers.length > 0 &&
      expectedInstanceIds.size === authoritativeInstanceIds.length &&
      authoritativeInstanceIds.length === markers.length &&
      authoritativeInstanceIds.every(id =>
        markers.some(marker => marker.instance === id)
      ) &&
      markers.every(marker => {
        const key = `${marker.pid}:${marker.instance}`;
        if (
          marker.runId !== runId ||
          !Number.isInteger(marker.pid) ||
          marker.pid <= 0 ||
          marker.instance === "" ||
          identities.has(key)
        )
          return false;
        identities.add(key);
        return true;
      }) &&
      manifests.length === markers.length &&
      manifests.every(manifest =>
        markers.some(
          marker =>
            manifest.run_id === runId &&
            manifest.pid === marker.pid &&
            manifest.instance_id === marker.instance &&
            canonicalPath(marker.manifestPath) ===
              canonicalPath(
                join(sessionRoot, "instances", marker.instance, "manifest.json")
              ) &&
            manifest.complete === true &&
            manifest.terminal_status === "complete" &&
            (manifest.omission_count ?? 0) === 0 &&
            manifest.overflow !== true &&
            typeof manifest.aggregate?.wrapper_entries === "number" &&
            manifest.aggregate?.offset_overflow === 0 &&
            manifest.aggregate.original_calls ===
              manifest.aggregate.wrapper_entries &&
            typeof manifest.queued === "number" &&
            typeof manifest.published === "number" &&
            manifest.queued === manifest.published &&
            manifest.published === (manifest.records ?? []).length &&
            manifest.aggregate.target_records ===
              (manifest.records ?? []).filter(
                record => record.targetObserved === true
              ).length &&
          (!expectedAckPid || manifest.pid === expectedAckPid)
          && (!expectedArmNonce || marker.instance.endsWith(expectedArmNonce))
        )
      ) &&
      manifests.every(
        manifest =>
          !(manifest.failures ?? []).length &&
          !Object.values(manifest.failure_diagnostics ?? {}).some(Boolean) &&
          ![
            "publication_failed",
            "containment_failed",
            "collision_failed",
            "restore_failed",
            "waterfall_invariant_failed",
          ].some(
            name => manifest[name as keyof D3DMetalMetalIrManifest] === true
          )
      ) &&
      !failures.some(failure =>
        [
          "publication_failed",
          "containment_failed",
          "collision_failed",
          "restore_failed",
          "waterfall_invariant_failed",
        ].includes(failure)
      ) &&
      manifests.reduce(
        (total, manifest) => total + (manifest.aggregate?.wrapper_entries ?? 0),
        0
      ) > 0 &&
      expectedAckPid === undefined) ||
    (Boolean(expectedAckPid) && moduleSnapshotValid);
  const records = manifests.flatMap(manifest => manifest.records ?? []);
  const recordReferences = records
    .map(record => canonicalPath(record.payload_path ?? ""))
    .filter(Boolean);
  const payloadDeclarations = new Map<string, string>();
  const referencesValid =
    recordReferences.length === records.length &&
    records.every(record => {
      const path = canonicalPath(record.payload_path ?? "");
      const declaration = `${record.payload_length}:${
        record.payload_sha256 ?? ""
      }`;
      const prior = payloadDeclarations.get(path);
      if (prior !== undefined) return prior === declaration;
      payloadDeclarations.set(path, declaration);
      return true;
    });
  const targetObserved = records.some(
    record =>
      record.targetObserved === true &&
      typeof record.module_identity === "string" &&
      record.module_identity !== "" &&
      typeof record.configured_offset === "string" &&
      record.configured_offset !== "" &&
      record.configured_offset.toLowerCase() ===
        D3DMETAL_CAPTURE_CONFIGURED_OFFSET &&
      typeof record.target_predicate === "string" &&
      record.target_predicate === D3DMETAL_CAPTURE_TARGET_PREDICATE &&
      record.caller_offset ===
        parseInt(D3DMETAL_CAPTURE_CONFIGURED_OFFSET, 16) &&
      (!expectedModuleIdentity ||
        record.module_identity === expectedModuleIdentity) &&
      Boolean(expectedModuleIdentity) &&
      Boolean(expectedCaptureHash && expectedD3DMetalHash) &&
      record.module_sha256?.toLowerCase() ===
        expectedD3DMetalHash?.toLowerCase() &&
      record.d3dmetal_sha256?.toLowerCase() ===
        expectedD3DMetalHash?.toLowerCase() &&
      record.capture_sha256?.toLowerCase() ===
        expectedCaptureHash?.toLowerCase()
  );
  const payloadValid =
    targetObserved &&
    referencesValid &&
    payloadValidity.length === records.length &&
    payloadValidity.every(Boolean);
  const payloadParseable =
    records.length > 0 &&
    payloadValidity.length === records.length &&
    payloadValidity.every(Boolean);
  const sessionComplete = lifecycleValid;
  const finalEvidenceReady =
    sessionComplete && targetObserved && payloadValid && payloadParseable;
  const analysisReady = finalEvidenceReady;
  const allFailures = [
    ...new Set([
      ...failures,
      ...manifests.flatMap(manifest => manifest.failures ?? []),
      ...manifests.flatMap(manifest => [
        ...Object.entries(manifest.failure_diagnostics ?? {})
          .filter(([, failed]) => failed)
          .map(([name]) => name),
        ...[
          "publication_failed",
          "containment_failed",
          "collision_failed",
          "restore_failed",
          "waterfall_invariant_failed",
        ].filter(
          name => manifest[name as keyof D3DMetalMetalIrManifest] === true
        ),
      ]),
      ...(lifecycleValid ? [] : ["lifecycle_invalid"]),
    ]),
  ];
  return {
    lifecycleValid,
    sessionComplete,
    targetObserved,
    payloadValid,
    payloadParseable,
    finalEvidenceReady,
    visualStatus: finalEvidenceReady ? "unverified" : "not-ready",
    analysisReady,
    instances: markers,
    manifests,
    records,
    failures: allFailures,
    reason: analysisReady
      ? null
      : allFailures.length
      ? allFailures[0]
      : !lifecycleValid
      ? "lifecycle-invalid"
      : !targetObserved
      ? "target-unobserved"
      : "payload-invalid",
  };
}

export async function settleD3DMetalMetalIrAggregation({
  runId,
  sessionRoot,
  launchExitedAt,
  scan,
  readManifest,
  validateRecords,
  now = () => Date.now(),
  sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
  writeAggregate,
  expectedModuleIdentity,
  expectedCaptureHash,
  expectedD3DMetalHash,
  expectedAckPid,
  moduleSnapshotValid = false,
  expectedArmNonce,
}: {
  runId: string;
  sessionRoot: string;
  launchExitedAt: number;
  scan: () => Promise<
    | D3DMetalMetalIrInstanceMarker[]
    | {
        markers: D3DMetalMetalIrInstanceMarker[];
        instanceIds: string[];
        markerInstanceIds: string[];
        installedLogInstanceIds?: string[];
      }
  >;
  readManifest: (
    marker: D3DMetalMetalIrInstanceMarker
  ) => Promise<D3DMetalMetalIrManifest | null>;
  validateRecords: (
    manifest: D3DMetalMetalIrManifest,
    marker: D3DMetalMetalIrInstanceMarker
  ) => Promise<boolean[]>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  writeAggregate?: (aggregation: D3DMetalMetalIrAggregation) => Promise<void>;
  expectedModuleIdentity?: string;
  expectedCaptureHash?: string;
  expectedD3DMetalHash?: string;
  expectedAckPid?: number;
  moduleSnapshotValid?: boolean;
  expectedArmNonce?: string;
}): Promise<D3DMetalMetalIrAggregation> {
  let lastKey = "";
  let stableSince = now();
  let latest: D3DMetalMetalIrAggregation = aggregateD3DMetalMetalIrManifests({
    runId,
    sessionRoot,
    markers: [],
    manifests: [],
    payloadValidity: [],
    terminalStatus: "incomplete",
    failures: ["missing_manifest"],
  });
  for (;;) {
    const scanned = await scan();
    const scanResult = Array.isArray(scanned)
      ? {
          markers: scanned,
          instanceIds: scanned.map(marker => marker.instance),
          markerInstanceIds: scanned.map(marker => marker.instance),
          installedLogInstanceIds: scanned.map(marker => marker.instance),
        }
      : scanned;
    const markers = scanResult.markers;
    const loaded = await Promise.all(
      markers.map(async marker => ({
        marker,
        manifest: await readManifest(marker),
      }))
    );
    const usable = loaded.filter(
      (
        item
      ): item is {
        marker: D3DMetalMetalIrInstanceMarker;
        manifest: D3DMetalMetalIrManifest;
      } => item.manifest !== null
    );
    const key =
      markers
        .map(
          marker => `${marker.pid}:${marker.instance}:${marker.manifestPath}`
        )
        .sort()
        .join("|") + JSON.stringify(usable.map(item => item.manifest));
    if (key !== lastKey) {
      lastKey = key;
      stableSince = now();
    }
    const payloadValidity = (
      await Promise.all(
        usable.flatMap(item =>
          item.manifest.records?.length
            ? [validateRecords(item.manifest, item.marker)]
            : []
        )
      )
    ).flat();
    const manifestIds = new Set(usable.map(item => item.marker.instance));
    const authoritativeIds = markers.map(marker => marker.instance);
    const reconciliationFailures = [
      ...authoritativeIds
        .filter(id => !manifestIds.has(id))
        .map(() => "missing_manifest"),
      ...scanResult.instanceIds
        .filter(id => !scanResult.markerInstanceIds.includes(id))
        .map(() => "missing_marker"),
      ...scanResult.instanceIds
        .filter(
          id =>
            !(
              scanResult.installedLogInstanceIds ??
              markers.map(marker => marker.instance)
            ).includes(id)
        )
        .map(() => "missing_install_log"),
    ];
    latest = aggregateD3DMetalMetalIrManifests({
      runId,
      sessionRoot,
      markers,
      manifests: usable.map(item => item.manifest),
      payloadValidity,
      terminalStatus:
        reconciliationFailures.length > 0 ? "incomplete" : "complete",
      failures: reconciliationFailures,
      authoritativeInstanceIds: authoritativeIds,
      directMarkerInstanceIds: authoritativeIds,
      expectedModuleIdentity,
      expectedCaptureHash,
      expectedD3DMetalHash,
      expectedAckPid,
      moduleSnapshotValid,
      expectedArmNonce,
    });
    const stable = now() - stableSince >= D3DMETAL_IR_STABLE_SEAL_MS;
    const deadline = now() - launchExitedAt >= D3DMETAL_IR_TERMINAL_DEADLINE_MS;
    if (
      stable &&
      usable.some(
        item =>
          item.manifest.complete !== true ||
          (item.manifest.terminal_status !== undefined &&
            item.manifest.terminal_status !== "complete")
      ) &&
      !(latest.failures ?? []).includes("missing_terminal")
    ) {
      latest.failures = [...(latest.failures ?? []), "missing_terminal"];
      latest.reason = latest.reason ?? "missing_terminal";
    }
    if ((stable && latest.lifecycleValid) || deadline) {
      const failures = (latest.failures ??= []);
      if (
        deadline &&
        !latest.lifecycleValid &&
        !failures.includes("missing_terminal")
      ) {
        failures.push("missing_terminal");
        latest.reason = latest.reason ?? "missing_terminal";
      }
      if (writeAggregate) {
        try {
          await writeAggregate(latest);
        } catch {
          failures.push("aggregate_publication_failed");
          latest.reason = latest.reason ?? "aggregate_publication_failed";
        }
      }
      return latest;
    }
    await sleep(D3DMETAL_IR_SCAN_INTERVAL_MS);
  }
}

export function parseD3DMetalMetalIrProbe(
  contents: string
): D3DMetalMetalIrProbeDiagnostics {
  const evidence = uniqueFirst(
    contents
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(
        line =>
          line.startsWith("probe ") ||
          line.startsWith("observer ") ||
          /^capture installed mode=metal-ir-capture-v1\s+run=\S+\s+pid=\d+\s+instance=\S+\s+manifest=\S+$/.test(
            line
          )
      ),
    160
  );
  return {
    loaded: evidence.some(
      line =>
        /^probe loaded mode=metal-ir-(?:(?:probe|code|fp64)-v[12]|unorm-fix-v[12](?:-rt)?|dxil-v2)$/.test(
          line
        ) ||
        /^observer loaded mode=metal-ir-observe-v1$/.test(line) ||
        /^capture installed mode=metal-ir-capture-v1\s+run=\S+\s+pid=\d+\s+instance=\S+\s+manifest=\S+$/.test(
          line
        )
    ),
    resolved: evidence.some(line =>
      /^(?:probe|observer) resolved=0x[0-9a-f]+$/.test(line)
    ),
    installed: evidence.some(
      line =>
        /^probe installed got=0x4ae1a0(?: mode=metal-ir-(?:(?:code|fp64)-v[12]|unorm-fix-v[12](?:-rt)?|dxil-v2))?(?: rt_output=(?:installed|unavailable) compute_correlation=(?:installed|unavailable))?$/.test(
          line
        ) ||
        /^observer installed got=0x4ae1a0 mode=metal-ir-observe-v1 rt_output=(?:installed|unavailable)(?: compute_correlation=(?:installed|unavailable))?$/.test(
          line
        ) ||
        /^capture installed mode=metal-ir-capture-v1\s+run=\S+\s+pid=\d+\s+instance=\S+\s+manifest=\S+$/.test(
          line
        )
    ),
    targetEntered: evidence.some(
      line =>
        /^probe target-entry caller=D3DMetal offset=0x(?:87ec9|9a12f) sink=(?:null|non-null)$/.test(
          line
        ) || /^observer compile sequence=\d+\b/.test(line)
    ),
    resultObserved: evidence.some(
      line =>
        /^probe target-result=0x[0-9a-f]+$/.test(line) ||
        /^observer compile sequence=\d+\b.*\bresult=(?:returned_nonnull|returned_null|unwound)\b/.test(
          line
        )
    ),
    resolverFailed: evidence.some(line =>
      /^(?:probe|observer) (?:resolver-invalid|resolver-recursion|identity-invalid|binding-shape-invalid|exact-export-invalid|alignment-invalid|slot-invalid|writable-failed|cas-failed|protection-restore-failed|protection-verify-failed|replacement-file-invalid|replacement-sha-invalid)(?: exit=126)?$/.test(
        line
      )
    ),
    errorCode:
      evidence
        .map(
          line =>
            /^probe error-code=(0x[0-9a-f]+)$/.exec(line)?.[1] ??
            /^observer compile sequence=\d+\b.*\berror=(0x[0-9a-f]+)\b/.exec(
              line
            )?.[1]
        )
        .find((value): value is string => value !== undefined) ?? null,
    evidence,
  };
}

export function createZzzPlayerLogPath(winePrefix: string) {
  return join(
    winePrefix,
    "drive_c",
    "users",
    "crossover",
    "AppData",
    "LocalLow",
    "miHoYo",
    "ZenlessZoneZero",
    "Player.log"
  );
}

function matchingLines(contents: string, patterns: readonly RegExp[]) {
  return contents
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(
      line => line !== "" && patterns.some(pattern => pattern.test(line))
    );
}

function countByCapture(
  contents: string,
  pattern: RegExp,
  normalize: (value: string) => string = value => value
) {
  const counts: Record<string, number> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match?.[1]) continue;
    const key = normalize(match[1]);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function uniqueFirst(lines: readonly string[], limit = 20) {
  return [...new Set(lines)].slice(0, limit);
}

interface D3DMetalSystemError19Event {
  systemIndex: number;
  stage: string;
  noOpPsoId: number | null;
}

function parseD3DMetalCompileObservations(
  contents: string
): D3DMetalCompileObservation[] {
  const pattern =
    /^observer compile sequence=(\d+) time_ns=(\d+) tid=(\d+) caller=(0x[0-9a-f]+) context=(rt|graphics|compute|unknown) stage=([a-z0-9_]+) size=(\d+) sha256=(none|[0-9a-f]{64}) capture=([a-z0-9_]+) result=(returned_nonnull|returned_null|unwound) error=(none|0x[0-9a-f]+) error_status=([a-z0-9_]+) sink=(null|non-null) export=([a-z0-9_]+) path=(.*?)(?: pso_object=(none|0x[0-9a-f]+) pso_id=(none|\d+) selection=([a-z0-9_]+) selection_reason=([a-z0-9_]+))? stack=(.*)$/i;
  const observations: D3DMetalCompileObservation[] = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const match = pattern.exec(rawLine.trim());
    if (!match) continue;
    const sequence = Number(match[1]);
    const sourceSize = Number(match[7]);
    if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(sourceSize)) {
      continue;
    }
    const context = match[5].toLowerCase() as D3DMetalCompileContext;
    const result = match[10].toLowerCase() as D3DMetalCompileObservation["result"];
    const sourceSha256 = match[8].toLowerCase();
    const errorCode = match[11].toLowerCase();
    const exportPath = match[15] === "none" ? null : match[15];
    const psoObject =
      !match[16] || match[16].toLowerCase() === "none"
        ? null
        : match[16].toLowerCase();
    const parsedPsoId = match[17] && match[17] !== "none" ? Number(match[17]) : null;
    const psoId =
      parsedPsoId !== null && Number.isSafeInteger(parsedPsoId)
        ? parsedPsoId
        : null;
    const stack = match[20] ?? "none";
    observations.push({
      sequence,
      timeNs: match[2],
      threadId: match[3],
      callerOffset: match[4].toLowerCase(),
      context,
      stage: match[6].toLowerCase(),
      sourceSize,
      sourceSha256: sourceSha256 === "none" ? null : sourceSha256,
      captureStatus: match[9].toLowerCase(),
      result,
      errorCode: errorCode === "none" ? null : errorCode,
      errorStatus: match[12].toLowerCase(),
      sink: match[13].toLowerCase() as "null" | "non-null",
      exportStatus: match[14].toLowerCase(),
      exportPath,
      psoObject,
      psoId,
      selection: match[18]?.toLowerCase() ?? null,
      selectionReason: match[19]?.toLowerCase() ?? null,
      stackOffsets:
        stack === "none"
          ? []
          : stack
              .split(",")
              .map(value => value.trim().toLowerCase())
              .filter(value => /^0x[0-9a-f]+$/.test(value)),
    });
  }
  return observations.sort((left, right) => left.sequence - right.sequence);
}

function parseD3DMetalSystemError19Events(
  contents: string
): D3DMetalSystemError19Event[] {
  const events: D3DMetalSystemError19Event[] = [];
  let pendingFragment: number | null = null;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    const failure =
      /Failed to compile stage\s+(\w+)\s+-\s+error:\s*(0x[0-9a-f]+|\d+)/i.exec(
        line
      );
    if (failure) {
      const rawCode = failure[2].toLowerCase();
      const code = rawCode.startsWith("0x")
        ? Number.parseInt(rawCode.slice(2), 16)
        : Number.parseInt(rawCode, 10);
      if (code === 19) {
        const event: D3DMetalSystemError19Event = {
          systemIndex: events.length,
          stage: failure[1].toLowerCase(),
          noOpPsoId: null,
        };
        events.push(event);
        pendingFragment = event.stage === "fragment" ? events.length - 1 : null;
      }
      continue;
    }
    const noOp = /marking PSO\((\d+)\) as no-op/i.exec(line);
    if (noOp && pendingFragment !== null) {
      const psoId = Number(noOp[1]);
      if (Number.isSafeInteger(psoId)) {
        events[pendingFragment].noOpPsoId = psoId;
      }
      pendingFragment = null;
    }
  }
  return events;
}

function effectiveObserverStage(observation: D3DMetalCompileObservation) {
  if (observation.stage !== "unknown") return observation.stage;
  return observation.context === "compute" ? "compute" : "unknown";
}

function correlateD3DMetalError19(
  observations: readonly D3DMetalCompileObservation[],
  systemEvents: readonly D3DMetalSystemError19Event[]
) {
  const observerErrors = observations.filter(
    observation => observation.errorCode === "0x13"
  );
  const unused = new Set(observerErrors.map((_, index) => index));
  const correlations: D3DMetalError19Correlation[] = [];
  let unmatchedSystemCount = 0;
  for (const systemEvent of systemEvents) {
    const observerIndex = observerErrors.findIndex(
      (observation, index) =>
        unused.has(index) && effectiveObserverStage(observation) === systemEvent.stage
    );
    if (observerIndex < 0) {
      unmatchedSystemCount += 1;
      continue;
    }
    unused.delete(observerIndex);
    const observation = observerErrors[observerIndex];
    correlations.push({
      systemIndex: systemEvent.systemIndex,
      systemStage: systemEvent.stage,
      noOpPsoId: systemEvent.noOpPsoId,
      observerSequence: observation.sequence,
      callerOffset: observation.callerOffset,
      context: observation.context,
      observerStage: observation.stage,
      sourceSize: observation.sourceSize,
      sourceSha256: observation.sourceSha256,
      psoObject: observation.psoObject,
      psoId: observation.psoId,
      result: observation.result,
      errorCode: "0x13",
    });
  }
  return {
    correlations,
    complete:
      systemEvents.length > 0 &&
      unmatchedSystemCount === 0 &&
      unused.size === 0 &&
      correlations.length === systemEvents.length,
    unmatchedObserverCount: unused.size,
    unmatchedSystemCount,
  };
}

function parseD3DMetalRtOutput(contents: string) {
  const evidence = contents
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith("observer rt-output"));
  const installed = evidence.some(line =>
    /^observer rt-output installed target=0x16015b body_end=0x1607be method_hooks=\d+$/.test(
      line
    )
  );
  const paths = uniqueFirst(
    evidence
      .map(line => /\bevent=end path=([^\s]+)/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined),
    8
  );
  const beginSequences = new Set(
    evidence
      .filter(line => /\bevent=begin\b/.test(line))
      .map(line => /\bsequence=(\d+)/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
  );
  const endSequences = new Set(
    evidence
      .filter(line => /\bevent=end\b/.test(line))
      .map(line => /\bsequence=(\d+)/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
  );
  const completeDispatchCount = [...beginSequences].filter(sequence =>
    endSequences.has(sequence)
  ).length;
  const dispatchDimensionEvents = evidence.filter(
    line =>
      /\bevent=dispatch-threads\b.*\bgrid=\d+x\d+x\d+\b/.test(line) ||
      /\bevent=dispatch-threadgroups\b.*\bgroups=\d+x\d+x\d+\b/.test(
        line
      ) ||
      /\bevent=dispatch-indirect\b.*\bgroups=\d+x\d+x\d+\b/.test(line)
  );
  const unavailableDispatchDimensionEvents = evidence.filter(
    line =>
      /\bevent=dispatch-indirect\b.*\bgroups=unavailable\b/.test(line) ||
      /\bevent=execute-icb\b/.test(line)
  );
  const resourceEvents = evidence.filter(line =>
    /\bevent=(?:dispatch-argument-buffer|set-buffer|set-texture|set-acceleration-structure|use-resource|dispatch-indirect-buffer|execute-icb|barrier-resource)\b/.test(
      line
    )
  );
  const resourceIdentityEvents = resourceEvents.filter(
    line =>
      /\bresource=0x[0-9a-f]+\b/i.test(line) &&
      /\b(?:gpu_resource_id|resource_id|gpu_address)=0x[0-9a-f]+\b/i.test(
        line
      )
  );
  const resourceStateEvents = resourceEvents.filter(line =>
    /\bstate=(?:read|write|read_write|bound|barrier|unknown)\b/.test(line)
  );
  const outputResourceEvents = resourceEvents.filter(
    line =>
      /\brole=output_candidate\b/.test(line) ||
      /\bstate=(?:write|read_write)\b/.test(line)
  );
  const barrierEvents = evidence.filter(
    line =>
      /\bevent=(?:memory-barrier|memory-barrier-resources)\b/.test(line) ||
      /\bevent=end\b.*\binternal_barrier_src=\d+\b.*\binternal_barrier_dst=\d+\b/.test(
        line
      )
  );
  const invalidReasons = [
    ...(installed ? [] : ["observer-not-installed"]),
    ...(completeDispatchCount > 0 ? [] : ["dispatch-incomplete"]),
    ...(dispatchDimensionEvents.length > 0
      ? []
      : [
          unavailableDispatchDimensionEvents.length > 0
            ? "dispatch-dimensions-unavailable"
            : "dispatch-dimensions-missing",
        ]),
    ...(paths.some(path => path === "direct" || path === "icb")
      ? []
      : ["dispatch-path-missing"]),
    ...(resourceIdentityEvents.length > 0
      ? []
      : ["resource-identifiers-missing"]),
    ...(resourceStateEvents.length > 0 ? [] : ["resource-state-missing"]),
    ...(outputResourceEvents.length > 0 ? [] : ["output-resource-missing"]),
    ...(barrierEvents.length > 0 ? [] : ["barrier-missing"]),
  ];
  return {
    installed,
    valid: invalidReasons.length === 0,
    invalidReasons,
    dispatchCount: beginSequences.size,
    completeDispatchCount,
    paths,
    resourceEventCount: resourceEvents.length,
    outputResourceEventCount: outputResourceEvents.length,
    barrierEventCount: barrierEvents.length,
    evidence: uniqueFirst(evidence, 300),
  };
}

export function parseD3DMetalDxrPipelineDiagnostics(
  contents: string
): D3DMetalDxrPipelineDiagnostics {
  const rayTracingPsoFailures = matchingLines(contents, [
    /could not create a Ray Tracing Pipeline State Object/i,
  ]);
  const rtxgiInvalidStateObjects = matchingLines(contents, [
    /Dispatching Ray Tracing Shader\s+["“]?RTXGI["”]?\s+failed\. Invalid Ray Tracing State Object/i,
  ]);
  const createStateObjectFailures = matchingLines(contents, [
    /(?:CreateStateObject|CreateExecutableStateObject)[^\n]*(?:failed|error|unsupported|invalid)/i,
  ]);
  const metalCompileFailures = matchingLines(contents, [
    /Failed to compile stage\s+\w+\s+-\s+error:\d+/i,
  ]);
  const metalIrUnhandledFp64 = matchingLines(contents, [
    /MetalIRConverter[^\n]*FP64Usage\s*:\s*Unhandled FP64 usage/i,
  ]);
  const noOpPsos = matchingLines(contents, [/marking PSO\(\d+\) as no-op/i]);
  const rejectedSubobjectEvidence = matchingLines(contents, [
    /unhandled D3D12_STATE_OBJECT_TYPE/i,
    /Unsupported D3D12_PIPELINE_STATE_SUBOBJECT_TYPE/i,
    /(?:pipeline|shader) config[^\n]*(?:mismatch|invalid|missing|failed|conflict)/i,
    /(?:subobject|association|hit group|DXIL library|root signature)[^\n]*(?:unsupported|invalid|missing|mismatch|failed|conflict)/i,
    /(?:unsupported|invalid|missing|mismatch|failed|conflict)[^\n]*(?:subobject|association|hit group|DXIL library|root signature)/i,
  ]);
  const rejectedSubobjectMatch = rejectedSubobjectEvidence
    .map(line =>
      /(?:D3D12_PIPELINE_STATE_SUBOBJECT_TYPE|D3D12_STATE_OBJECT_TYPE)\s*[:=]?\s*([A-Za-z0-9_]+)/i.exec(
        line
      )
    )
    .find((match): match is RegExpExecArray => match !== null);
  const firstFailure = matchingLines(contents, [
    /could not create a Ray Tracing Pipeline State Object/i,
    /Dispatching Ray Tracing Shader\s+["“]?RTXGI["”]?\s+failed\. Invalid Ray Tracing State Object/i,
    /(?:CreateStateObject|CreateExecutableStateObject)[^\n]*(?:failed|error|unsupported|invalid)/i,
    /unhandled D3D12_STATE_OBJECT_TYPE/i,
    /Unsupported D3D12_PIPELINE_STATE_SUBOBJECT_TYPE/i,
  ])[0];
  const noOpPsoIds = Object.keys(
    countByCapture(contents, /marking PSO\((\d+)\) as no-op/i)
  )
    .map(Number)
    .filter(value => Number.isSafeInteger(value));
  const hresultCounts = countByCapture(
    contents,
    /(?:Ray Tracing Pipeline State Object|CreateStateObject|CreateExecutableStateObject)[^\n]*?(0x[0-9a-f]{8})/i,
    value => value.toLowerCase()
  );
  const stateObjectFailureTagCounts: Partial<
    Record<D3DMetalStateObjectFailureStage, number>
  > = {};
  for (const [hresult, stage] of Object.entries(
    D3DMETAL_STATE_OBJECT_FAILURE_TAGS
  )) {
    const count = hresultCounts[hresult];
    if (count) stateObjectFailureTagCounts[stage] = count;
  }
  const taggedStages = Object.keys(
    stateObjectFailureTagCounts
  ) as D3DMetalStateObjectFailureStage[];
  const metalIrCompileObservations = parseD3DMetalCompileObservations(contents);
  const systemError19Events = parseD3DMetalSystemError19Events(contents);
  const error19Correlation = correlateD3DMetalError19(
    metalIrCompileObservations,
    systemError19Events
  );
  const rtOutput = parseD3DMetalRtOutput(contents);

  return {
    rayTracingPsoFailureCount: rayTracingPsoFailures.length,
    rtxgiInvalidStateObjectCount: rtxgiInvalidStateObjects.length,
    createStateObjectFailureCount: createStateObjectFailures.length,
    hresultCounts,
    stateObjectFailureStage:
      taggedStages.length === 0
        ? null
        : taggedStages.length === 1
        ? taggedStages[0]
        : "mixed",
    stateObjectFailureTagCounts,
    metalCompileFailureCount: metalCompileFailures.length,
    metalCompileFailuresByStage: countByCapture(
      contents,
      /Failed to compile stage\s+(\w+)\s+-\s+error:\d+/i,
      value => value.toLowerCase()
    ),
    metalCompileError19Count: systemError19Events.length,
    metalIrUnhandledFp64Count: metalIrUnhandledFp64.length,
    metalIrCompileObservations,
    metalIrError19Correlations: error19Correlation.correlations,
    metalIrError19CorrelationComplete: error19Correlation.complete,
    metalIrError19UnmatchedObserverCount:
      error19Correlation.unmatchedObserverCount,
    metalIrError19UnmatchedSystemCount: error19Correlation.unmatchedSystemCount,
    noOpPsoCount: noOpPsos.length,
    noOpPsoIds,
    rtOutputInstalled: rtOutput.installed,
    rtOutputValid: rtOutput.valid,
    rtOutputInvalidReasons: rtOutput.invalidReasons,
    rtOutputDispatchCount: rtOutput.dispatchCount,
    rtOutputCompleteDispatchCount: rtOutput.completeDispatchCount,
    rtOutputPaths: rtOutput.paths,
    rtOutputResourceEventCount: rtOutput.resourceEventCount,
    rtOutputWriteResourceEventCount: rtOutput.outputResourceEventCount,
    rtOutputBarrierEventCount: rtOutput.barrierEventCount,
    rtOutputEvidence: rtOutput.evidence,
    rejectedSubobject: rejectedSubobjectMatch?.[1] ?? null,
    rejectedSubobjectEvidence: uniqueFirst(rejectedSubobjectEvidence),
    firstFailure: firstFailure ?? null,
  };
}

export function parseD3DMetalSelectedRenderer(playerLog: string): {
  selectedRenderer: D3DMetalSelectedRenderer;
  evidence: string[];
} {
  const d3d12SelectionPatterns = [
    /^Forcing GfxDevice:\s*Direct3D\s*12\b/i,
    /^Version:\s*Direct3D\s*12(?:\s|\[|$)/i,
  ];
  const d3d12SupportPatterns = [/^d3d12:\s*loaded!/i];
  const d3d11Patterns = [
    /^Forcing GfxDevice:\s*Direct3D\s*11(?:\.\d+)?\b/i,
    /^Version:\s*Direct3D\s*11(?:\.\d+)?(?:\s|\[|$)/i,
  ];
  const moltenVkPatterns = [
    /^Forcing GfxDevice:\s*Vulkan\b/i,
    /^GfxDevice:\s*Vulkan\b/i,
    /^Vulkan:\s*(?:$|API\b)/i,
    /^Renderer:.*MoltenVK/i,
  ];
  const d3d12 = matchingLines(playerLog, d3d12SelectionPatterns);
  const d3d12Support = matchingLines(playerLog, d3d12SupportPatterns);
  const d3d11 = matchingLines(playerLog, d3d11Patterns);
  const moltenVk = matchingLines(playerLog, moltenVkPatterns);
  const candidates = [
    d3d12.length > 0 ? "d3d12" : undefined,
    d3d11.length > 0 ? "d3d11" : undefined,
    moltenVk.length > 0 ? "moltenvk" : undefined,
  ].filter(
    (
      renderer
    ): renderer is Exclude<D3DMetalSelectedRenderer, "unknown" | "conflict"> =>
      renderer !== undefined
  );

  return {
    selectedRenderer:
      candidates.length === 0
        ? "unknown"
        : candidates.length === 1
        ? candidates[0]
        : "conflict",
    evidence: [...d3d12, ...d3d12Support, ...d3d11, ...moltenVk],
  };
}

/**
 * Reads Unity's startup-time DXR capability result. This intentionally does
 * not inspect the saved graphics setting: the user may turn ray tracing off
 * before exit without changing the device capability established at startup.
 */
export function parseD3DMetalDxrCapability(playerLog: string): {
  capability: D3DMetalDxrCapability;
  evidence: string[];
} {
  const evidence = matchingLines(playerLog, [
    /^supportsRayTracing\s*=\s*[01]\s*$/i,
  ]);
  const reported = new Set(
    evidence.map(line =>
      /=\s*1\s*$/i.test(line) ? "supported" : "unsupported"
    )
  );
  return {
    capability:
      reported.size === 0
        ? "missing"
        : reported.size === 1
        ? reported.values().next().value
        : "conflict",
    evidence,
  };
}

export function findLatestD3DMetalEvidenceFile(
  entries: readonly { entry: string; type: "FILE" | "DIRECTORY" }[]
) {
  return entries
    .flatMap(({ entry, type }) => {
      if (type !== "FILE") return [];
      const match = /^d3dmetal_(\d+)_evidence\.json$/.exec(entry);
      if (!match) return [];
      const timestamp = Number(match[1]);
      return Number.isSafeInteger(timestamp) ? [{ entry, timestamp }] : [];
    })
    .sort((left, right) => right.timestamp - left.timestamp)[0]?.entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createD3DMetalDxrRuntimeStatus(
  dxrConfigured: boolean,
  evidence?: unknown
): D3DMetalDxrRuntimeStatusDisplay {
  if (!dxrConfigured) return { status: "disabled", label: "disabled" };
  if (evidence === undefined) {
    return { status: "pending", label: "enabled — verification pending" };
  }
  if (!isRecord(evidence)) {
    return {
      status: "evidence-unreadable",
      label: "enabled — evidence unreadable",
    };
  }

  const capability = evidence["dxrCapability"];
  const verified = evidence["dxrVerified"];
  if (capability === undefined || verified === undefined) {
    // Evidence written by builds predating DXR capability collection cannot
    // prove or disprove the current runtime configuration.
    return { status: "pending", label: "enabled — verification pending" };
  }
  if (evidence["launchProfileVerified"] !== true) {
    return {
      status: "profile-mismatch",
      label: "profile mismatch — not verified",
    };
  }
  if (capability === "unsupported") {
    return {
      status: "unsupported",
      label: "enabled — runtime reports unsupported",
    };
  }
  if (capability === "conflict") {
    return {
      status: "conflict",
      label: "enabled — conflicting runtime reports",
    };
  }
  if (capability === "missing") {
    return {
      status: "capability-missing",
      label: "enabled — capability report missing",
    };
  }
  if (evidence["dxrPipelineFailed"] === true) {
    return {
      status: "pipeline-failed",
      label: "enabled — RTXGI pipeline failed",
    };
  }
  const diagnostics = evidence["dxrPipelineDiagnostics"];
  if (
    isRecord(diagnostics) &&
    (typeof diagnostics["metalCompileFailureCount"] === "number" &&
      diagnostics["metalCompileFailureCount"] > 0 ||
      typeof diagnostics["noOpPsoCount"] === "number" &&
        diagnostics["noOpPsoCount"] > 0)
  ) {
    return {
      status: "shader-graph-failed",
      label: "enabled — shader graph failed; RT output unobserved",
    };
  }
  if (
    capability === "supported" &&
    verified === true &&
    evidence["backendVerified"] === true
  ) {
    if (
      isRecord(diagnostics) &&
      diagnostics["rayTracingPsoFailureCount"] === 0 &&
      diagnostics["rtxgiInvalidStateObjectCount"] === 0 &&
      diagnostics["createStateObjectFailureCount"] === 0
    ) {
      return {
        status: "pipeline-unobserved",
        label: "enabled — capability verified; pipeline unobserved",
      };
    }
    return {
      status: "verified",
      label: "enabled — capability verified",
    };
  }
  return {
    status: "backend-unverified",
    label: "enabled — backend not verified",
  };
}

export function createD3DMetalMtl4RuntimeStatus(
  mtl4Configured: boolean,
  evidence?: unknown
): D3DMetalMtl4RuntimeStatusDisplay {
  if (!mtl4Configured) return { status: "disabled", label: "disabled" };
  if (evidence === undefined) {
    return { status: "pending", label: "enabled — verification pending" };
  }
  if (!isRecord(evidence)) {
    return {
      status: "evidence-unreadable",
      label: "enabled — evidence unreadable",
    };
  }
  if (evidence["status"] === "pending") {
    return { status: "pending", label: "enabled — verification pending" };
  }
  if (evidence["launchProfileVerified"] !== true) {
    return {
      status: "profile-mismatch",
      label: "profile mismatch — not verified",
    };
  }
  if (
    evidence["mtl4Configured"] === true &&
    evidence["mtl4BackendEnabled"] === true
  ) {
    return { status: "verified", label: "enabled — verified" };
  }
  return {
    status: "backend-unverified",
    label: "enabled — backend not verified",
  };
}

export function createD3DMetalMetalFxRuntimeStatus(
  metalFxConfigured: boolean,
  evidence?: unknown
): D3DMetalMetalFxRuntimeStatusDisplay {
  if (!metalFxConfigured) return { status: "disabled", label: "disabled" };
  if (evidence === undefined) {
    return { status: "pending", label: "configured — verification pending" };
  }
  if (!isRecord(evidence)) {
    return {
      status: "evidence-unreadable",
      label: "configured — evidence unreadable",
    };
  }
  if (
    evidence["status"] === "pending" ||
    evidence["metalFxVerified"] === undefined
  ) {
    return { status: "pending", label: "configured — verification pending" };
  }
  if (evidence["launchProfileVerified"] !== true) {
    return {
      status: "profile-mismatch",
      label: "profile mismatch — not verified",
    };
  }
  if (evidence["backendVerified"] !== true) {
    return {
      status: "backend-unverified",
      label: "configured — backend not verified",
    };
  }
  const observations = evidence["observations"];
  if (isRecord(observations) && observations["metalFxFailure"] === true) {
    return {
      status: "runtime-failed",
      label: "configured — runtime reported failure",
    };
  }
  if (evidence["metalFxVerified"] === true) {
    return { status: "verified", label: "enabled — verified" };
  }
  return {
    status: "conversion-unverified",
    label: "configured — conversion unverified",
  };
}

export function isFreshD3DMetalPlayerLog(
  before: D3DMetalPlayerLogFingerprint | undefined,
  after: D3DMetalPlayerLogFingerprint | undefined
) {
  return (
    after !== undefined &&
    (before === undefined ||
      before.size !== after.size ||
      before.sha256 !== after.sha256 ||
      before.inode !== after.inode ||
      before.modifiedAtSeconds !== after.modifiedAtSeconds)
  );
}

async function sha256File(target: string) {
  const result = await exec(["/usr/bin/shasum", "-a", "256", target]);
  const match = /^([a-f0-9]{64})\s/i.exec(result.stdOut.trim());
  if (!match) throw new Error(`Unable to hash D3DMetal diagnostic: ${target}`);
  return match[1].toLowerCase();
}

export async function fingerprintD3DMetalPlayerLog(
  target: string
): Promise<D3DMetalPlayerLogFingerprint | undefined> {
  if (!(await fileOrDirExists(target))) return undefined;
  try {
    const [metadata, sha256, identity] = await Promise.all([
      stats(target),
      sha256File(target),
      exec(["/usr/bin/stat", "-f", "%i %m", target]),
    ]);
    const identityMatch = /^(\d+)\s+(\d+)\s*$/.exec(identity.stdOut);
    if (!identityMatch) {
      throw new Error(`Unable to identify D3DMetal diagnostic: ${target}`);
    }
    return {
      size: metadata.size,
      sha256,
      inode: Number(identityMatch[1]),
      modifiedAtSeconds: Number(identityMatch[2]),
    };
  } catch (error) {
    if (!(await fileOrDirExists(target))) return undefined;
    throw error;
  }
}

export async function captureFreshD3DMetalPlayerLog({
  source,
  destination,
  before,
}: {
  source: string;
  destination: string;
  before: D3DMetalPlayerLogFingerprint | undefined;
}) {
  const after = await fingerprintD3DMetalPlayerLog(source);
  if (!isFreshD3DMetalPlayerLog(before, after)) return false;
  await cp(source, destination);
  const copied = await fingerprintD3DMetalPlayerLog(destination);
  if (
    copied === undefined ||
    copied.size !== after?.size ||
    copied.sha256 !== after.sha256
  ) {
    throw new Error("Per-run Player.log copy failed integrity verification");
  }
  return true;
}

export function findD3DMetalGameProcessIds(
  processList: string,
  gameExecutable: string
) {
  const expected = gameExecutable.toLowerCase();
  return processList
    .split("\n")
    .map(line => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter(
      (match): match is RegExpExecArray =>
        match !== null && match[2].toLowerCase().includes(expected)
    )
    .map(match => Number(match[1]))
    .filter(pid => Number.isSafeInteger(pid) && pid > 0);
}

function hasLoadedD3DMetalFramework(moduleSnapshot: string) {
  return /D3DMetal\.framework\/(?:(?:Contents\/MacOS|Versions\/[^/\s]+)\/)?D3DMetal(?:\s|$)/i.test(
    moduleSnapshot
  );
}

function moduleSnapshotComplete(snapshot: string) {
  return hasLoadedD3DMetalFramework(snapshot) && /d3d12\.dll/i.test(snapshot);
}

export async function collectD3DMetalModuleSnapshot({
  destination,
  gameExecutable,
  launchFinished,
  timeoutMs = 90_000,
  pollIntervalMs = 1_000,
}: {
  destination: string;
  gameExecutable: string;
  launchFinished: () => boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}) {
  const deadline = Date.now() + timeoutMs;
  let bestSnapshot = "";

  while (Date.now() < deadline) {
    let processList = "";
    try {
      processList = (await exec(["/bin/ps", "-axww", "-o", "pid=,args="]))
        .stdOut;
    } catch {
      // The module snapshot is best-effort and must never block game launch.
    }
    const pids = findD3DMetalGameProcessIds(processList, gameExecutable);
    const snapshots: string[] = [];
    for (const pid of pids) {
      try {
        const output = (
          await exec(["/usr/sbin/lsof", "-n", "-P", "-p", String(pid)])
        ).stdOut;
        snapshots.push(`# pid=${pid}\n${output}`);
      } catch {
        // The process may have exited between ps and lsof.
      }
    }
    const snapshot = snapshots.join("\n");
    if (snapshot.length > bestSnapshot.length) bestSnapshot = snapshot;
    if (moduleSnapshotComplete(snapshot)) {
      try {
        await writeFile(
          destination,
          snapshot.endsWith("\n") ? snapshot : `${snapshot}\n`
        );
        return { captured: true, complete: true };
      } catch {
        return { captured: false, complete: false };
      }
    }
    if (launchFinished()) break;
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  if (bestSnapshot !== "") {
    try {
      await writeFile(
        destination,
        bestSnapshot.endsWith("\n") ? bestSnapshot : `${bestSnapshot}\n`
      );
    } catch {
      return { captured: false, complete: false };
    }
  }
  return {
    captured: bestSnapshot !== "",
    complete: moduleSnapshotComplete(bestSnapshot),
  };
}

export function verifyD3DMetalLaunchProfile(
  profile: D3DMetalLaunchProfile | undefined
) {
  if (profile === undefined) return false;
  const normalized = (value: string) =>
    value.replaceAll("/", "\\").toLowerCase();
  const requiredEnvironment = Object.entries(D3DMETAL_LAUNCH_ENVIRONMENT).every(
    ([key, value]) => profile.environment[key] === value
  );
  const inheritedBackendAbsent = D3DMETAL_INHERITED_ENVIRONMENT_BLOCKLIST.every(
    key => !profile.environment[key]
  );
  return (
    profile.wineTag === ZZZ_D3DMETAL_WINE_TAG &&
    profile.d3dMetalVersion === D3DMETAL_VERSION &&
    normalized(profile.launchProgram) === normalized(ZZZ_STEAM_EXECUTABLE) &&
    normalized(profile.gameExecutable) === normalized(ZZZ_GAME_EXECUTABLE) &&
    profile.arguments.length === 2 &&
    normalized(profile.arguments[0]) === normalized(profile.gameExecutable) &&
    profile.arguments[1] === ZZZ_D3D12_SELECTOR &&
    requiredEnvironment &&
    inheritedBackendAbsent
  );
}

export function analyzeD3DMetalRuntimeEvidence({
  wineLog,
  systemLog,
  playerLog,
  moduleSnapshot,
  metalIrProbeLog = "",
  launchProfile,
  validatedD3DMetalVersion,
  createdAt = new Date().toISOString(),
}: {
  wineLog: string;
  systemLog: string;
  playerLog: string;
  moduleSnapshot: string;
  metalIrProbeLog?: string;
  launchProfile: D3DMetalLaunchProfile | undefined;
  validatedD3DMetalVersion: string | undefined;
  createdAt?: string;
}): D3DMetalRuntimeEvidence {
  const moduleEvidence = `${wineLog}\n${systemLog}\n${moduleSnapshot}`;
  const combined = `${moduleEvidence}\n${playerLog}`;
  const renderer = parseD3DMetalSelectedRenderer(playerLog);
  const dxr = parseD3DMetalDxrCapability(playerLog);
  const dxrPipelineDiagnostics = parseD3DMetalDxrPipelineDiagnostics(
    `${combined}\n${metalIrProbeLog}`
  );
  const metalIrProbe = parseD3DMetalMetalIrProbe(metalIrProbeLog);
  const dxrPipelineFailed =
    dxrPipelineDiagnostics.rayTracingPsoFailureCount > 0 ||
    dxrPipelineDiagnostics.rtxgiInvalidStateObjectCount > 0 ||
    dxrPipelineDiagnostics.createStateObjectFailureCount > 0;
  const mtl4Evidence = matchingLines(moduleEvidence, [
    /Enabled MTL4 backend(?:\s*-\s*options=.*)?/i,
  ]);
  const metalFxConversion =
    /(?:converting|converted)\s+(?:an?\s+)?DLSS(?:\s+request)?\s+to\s+MetalFX/i.test(
      combined
    ) || /DLSS\s*(?:->|→)\s*MetalFX/i.test(combined);
  const metalFxFailure =
    /NvApi\s+is\s+not\s+supported/i.test(combined) ||
    /\[streamline\][^\n]*(?:not supported on your device|DLSS\b[^\n]*(?:not requested|failed|unsupported))/i.test(
      combined
    ) ||
    /MetalFX[^\n]*(?:failed|unsupported)/i.test(combined);
  const observations = {
    d3dMetal: hasLoadedD3DMetalFramework(moduleSnapshot),
    d3d12: /d3d12(?:\.dll|\.so)?|Direct3D\s*12/i.test(combined),
    d3d12Module: /d3d12\.dll/i.test(moduleSnapshot),
    nvngx: /nvngx(?:\.dll|\.so)?|\bNGX\b/i.test(combined),
    metalFx: /MetalFX/i.test(combined),
    metalFxConversion,
    metalFxFailure,
    d3d11: /d3d11(?:\.dll|\.so)?|Direct3D\s*11/i.test(combined),
    dxmt: /\bDXMT\b|winemetal/i.test(combined),
    moltenVk: /MoltenVK|\[mvk-/i.test(combined),
  };
  const launchProfileVerified = verifyD3DMetalLaunchProfile(launchProfile);
  const mtl4Configured = launchProfile?.environment.D3DM_MTL4 === "1";
  const mtl4BackendEnabled = mtl4Evidence.length > 0;
  const backendVerified =
    validatedD3DMetalVersion === D3DMETAL_VERSION &&
    launchProfileVerified &&
    playerLog !== "" &&
    renderer.selectedRenderer === "d3d12" &&
    observations.d3dMetal &&
    observations.d3d12 &&
    observations.d3d12Module &&
    !observations.dxmt;
  const metalFxVerified =
    observations.nvngx && metalFxConversion && !metalFxFailure;
  const dxrVerified = backendVerified && dxr.capability === "supported";
  const launchExitCode = launchProfile?.launchExitCode ?? null;
  const metalIrTerminalStatus = launchProfile?.metalIrTerminalStatus ?? null;
  const metalIrDiagnosticPass =
    launchProfile?.metalIrProbe?.passive === true &&
    launchProfile.metalIrAggregation?.analysisReady === true;
  const metalIrAggregation = launchProfile?.metalIrAggregation;
  return {
    createdAt,
    validatedD3DMetalVersion: validatedD3DMetalVersion ?? null,
    exactD3DMetalVersion: validatedD3DMetalVersion === D3DMETAL_VERSION,
    playerLogCaptured: playerLog !== "",
    moduleSnapshotCaptured: moduleSnapshot !== "",
    selectedRenderer: renderer.selectedRenderer,
    rendererSource: playerLog === "" ? null : "player-log",
    rendererEvidence: renderer.evidence,
    dxrCapability: dxr.capability,
    dxrEvidence: dxr.evidence,
    dxrPipelineFailed,
    dxrPipelineDiagnostics,
    metalIrProbe,
    metalIrMode: launchProfile?.metalIrProbe?.mode ?? null,
    metalIrPassive: launchProfile?.metalIrProbe?.passive === true,
    metalIrDiagnosticOnly:
      launchProfile?.metalIrProbe?.passive === true ||
      launchProfile?.metalIrProbe?.mode === "metal-ir-observe-v1",
    metalIrCapturePath: launchProfile?.metalIrProbe?.capturePath ?? null,
    metalIrCaptureHash: launchProfile?.metalIrProbe?.captureHash ?? null,
    metalIrManifestPath: launchProfile?.metalIrProbe?.manifestPath ?? null,
    metalIrRunId: launchProfile?.metalIrProbe?.runId ?? null,
    metalIrSourceRevision: launchProfile?.metalIrProbe?.sourceRevision ?? null,
    metalIrBuildIdentity: launchProfile?.metalIrProbe?.buildIdentity ?? null,
    launchExitCode,
    metalIrTerminalStatus,
    metalIrDiagnosticPass,
    metalIrLifecycleValid: metalIrAggregation?.lifecycleValid === true,
    metalIrSessionComplete: metalIrAggregation?.sessionComplete === true,
    metalIrTargetObserved: metalIrAggregation?.targetObserved === true,
    metalIrPayloadValid: metalIrAggregation?.payloadValid === true,
    metalIrPayloadParseable: metalIrAggregation?.payloadParseable === true,
    metalIrFinalEvidenceReady: metalIrAggregation?.finalEvidenceReady === true,
    metalIrVisualStatus: metalIrAggregation?.visualStatus ?? "not-ready",
    metalIrAnalysisReady: metalIrAggregation?.analysisReady === true,
    launchProfileVerified,
    mtl4Configured,
    mtl4BackendEnabled,
    mtl4Evidence,
    observations,
    backendVerified,
    metalFxVerified,
    dxrVerified,
    verified: backendVerified && metalFxVerified,
  };
}

export async function writeD3DMetalRuntimeEvidence({
  wineLog,
  systemLog,
  playerLog,
  moduleSnapshot,
  metalIrProbe,
  destination,
  launchProfile,
  validatedD3DMetalVersion,
  createdAt,
}: {
  wineLog: string;
  systemLog: string;
  playerLog: string;
  moduleSnapshot: string;
  metalIrProbe?: string;
  destination: string;
  launchProfile: D3DMetalLaunchProfile | undefined;
  validatedD3DMetalVersion: string | undefined;
  createdAt?: string;
}) {
  const [wine, system, player, modules, probe] = await Promise.all(
    [wineLog, systemLog, playerLog, moduleSnapshot, metalIrProbe].map(
      async target =>
        target && (await fileOrDirExists(target)) ? await readFile(target) : ""
    )
  );
  const evidence = analyzeD3DMetalRuntimeEvidence({
    wineLog: wine,
    systemLog: system,
    playerLog: player,
    moduleSnapshot: modules,
    metalIrProbeLog: probe,
    launchProfile,
    validatedD3DMetalVersion,
    createdAt,
  });
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

export async function writePendingD3DMetalRuntimeEvidence({
  destination,
  createdAt,
}: {
  destination: string;
  createdAt: string;
}) {
  await writeFile(
    destination,
    `${JSON.stringify({ status: "pending", createdAt }, null, 2)}\n`
  );
}

export async function writeD3DMetalLaunchProfile(
  profilePath: string,
  profile: D3DMetalLaunchProfile
) {
  await writeFile(
    profilePath,
    `${JSON.stringify(
      {
        ...profile,
        environment: createD3DMetalDiagnosticEnvironment(profile.environment),
      },
      null,
      2
    )}\n`
  );
}

export async function collectD3DMetalSystemLog({
  destination,
  since,
}: {
  destination: string;
  since: Date;
}) {
  await mkdirp(join(destination, ".."));
  const start = formatLogDate(since);
  const end = formatLogDate(new Date());
  await exec(
    [
      "/usr/bin/log",
      "show",
      "--style",
      "compact",
      "--start",
      start,
      "--end",
      end,
      "--info",
      "--debug",
      "--predicate",
      D3DMETAL_SYSTEM_LOG_PREDICATE,
    ],
    {},
    false,
    destination
  );
}

function formatLogDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`,
  ].join(" ");
}

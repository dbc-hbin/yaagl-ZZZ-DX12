/**
 * v2 control files are raw-byte identities. Parsing is followed by an exact
 * canonical serialization comparison, so JSON conveniences such as duplicate
 * keys, whitespace, a BOM, escaped alternate spellings, or trailing bytes
 * are all rejected before an ACK can be hashed or armed.
 */
export const METAL_IR_V2_SCHEMA = 2 as const;
export const METAL_IR_V2_MODE = "metal-ir-capture-v2" as const;
export const METAL_IR_V2_ACK_STATE = "installed" as const;
export const METAL_IR_V2_ARM_STATE = "armed" as const;
export const METAL_IR_V2_NONCE_HEX_LENGTH = 32 as const;
export const METAL_IR_V2_MAX_CONTROL_BYTES = 16 * 1024;

export interface MetalIrV2Acknowledgement {
  schema: typeof METAL_IR_V2_SCHEMA;
  mode: typeof METAL_IR_V2_MODE;
  state: typeof METAL_IR_V2_ACK_STATE;
  uid: number;
  pid: number;
  nonce: string;
  token: string;
  attempt_id: string;
  run_id: string;
  session_root: string;
  instance_id: string;
  manifest_rel: string;
  artifact_dir_rel: string;
  capture_sha256: string;
  module_sha256: string;
  d3dmetal_sha256: string;
  provider_sha256: string;
  configured_offset: string;
  target_predicate: string;
  process_executable: string;
  configured_game_executable: string;
  got_slot: string;
  got_readback: true;
  protection_restored: true;
}

export interface MetalIrV2Arm {
  schema: typeof METAL_IR_V2_SCHEMA;
  mode: typeof METAL_IR_V2_MODE;
  state: typeof METAL_IR_V2_ARM_STATE;
  uid: number;
  pid: number;
  nonce: string;
  ack_sha256: string;
}

export interface MetalIrV2Stop extends Omit<MetalIrV2Arm, "state"> {
  state: "stop";
}

/** All known launch-bound ACK fields must match exactly. */
export type MetalIrV2AckExpectation = Partial<MetalIrV2Acknowledgement>;

const textEncoder = new TextEncoder();
const hex64 = /^[0-9a-f]{64}$/;
const noncePattern = /^[0-9a-f]{32}$/;
const safeRelativePath = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertControlText(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > METAL_IR_V2_MAX_CONTROL_BYTES) {
    throw new Error("v2 capture control size rejected");
  }
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) {
      throw new Error("v2 capture control is not compact ASCII JSON");
    }
  }
  return String.fromCharCode(...bytes);
}

function parseRawObject(bytes: Uint8Array) {
  const raw = assertControlText(bytes);
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) throw new Error("not an object");
    return { raw, value };
  } catch {
    throw new Error("v2 capture control is invalid JSON");
  }
}

function assertSafeInteger(value: unknown, name: string, allowZero = false) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1)
  ) {
    throw new Error(`v2 capture ${name} is invalid`);
  }
  return value;
}

function assertText(value: unknown, name: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f-\uffff]/.test(value)
  ) {
    throw new Error(`v2 capture ${name} is invalid`);
  }
  return value;
}

function assertHash(value: unknown, name: string) {
  const hash = assertText(value, name);
  if (!hex64.test(hash)) throw new Error(`v2 capture ${name} is invalid`);
  return hash;
}

function assertRelativePath(value: unknown, name: string) {
  const path = assertText(value, name);
  if (!safeRelativePath.test(path) || path.includes("//")) {
    throw new Error(`v2 capture ${name} is invalid`);
  }
  return path;
}

function acknowledgementFrom(value: Record<string, unknown>): MetalIrV2Acknowledgement {
  const acknowledgement: MetalIrV2Acknowledgement = {
    schema: value.schema as typeof METAL_IR_V2_SCHEMA,
    mode: value.mode as typeof METAL_IR_V2_MODE,
    state: value.state as typeof METAL_IR_V2_ACK_STATE,
    uid: assertSafeInteger(value.uid, "uid", true),
    pid: assertSafeInteger(value.pid, "pid"),
    nonce: assertText(value.nonce, "nonce"),
    token: assertText(value.token, "token"),
    attempt_id: assertText(value.attempt_id, "attempt_id"),
    run_id: assertText(value.run_id, "run_id"),
    session_root: assertText(value.session_root, "session_root"),
    instance_id: assertText(value.instance_id, "instance_id"),
    manifest_rel: assertRelativePath(value.manifest_rel, "manifest_rel"),
    artifact_dir_rel: assertRelativePath(
      value.artifact_dir_rel,
      "artifact_dir_rel"
    ),
    capture_sha256: assertHash(value.capture_sha256, "capture_sha256"),
    module_sha256: assertHash(value.module_sha256, "module_sha256"),
    d3dmetal_sha256: assertHash(value.d3dmetal_sha256, "d3dmetal_sha256"),
    provider_sha256: assertHash(value.provider_sha256, "provider_sha256"),
    configured_offset: assertText(value.configured_offset, "configured_offset"),
    target_predicate: assertText(value.target_predicate, "target_predicate"),
    process_executable: assertText(value.process_executable, "process_executable"),
    configured_game_executable: assertText(
      value.configured_game_executable,
      "configured_game_executable"
    ),
    got_slot: assertText(value.got_slot, "got_slot"),
    got_readback: value.got_readback as true,
    protection_restored: value.protection_restored as true,
  };
  if (
    acknowledgement.schema !== METAL_IR_V2_SCHEMA ||
    acknowledgement.mode !== METAL_IR_V2_MODE ||
    acknowledgement.state !== METAL_IR_V2_ACK_STATE ||
    !noncePattern.test(acknowledgement.nonce) ||
    acknowledgement.configured_offset !== "0x87ec9" ||
    acknowledgement.target_predicate !== "exact-offset-precall-dxil" ||
    acknowledgement.got_readback !== true ||
    acknowledgement.protection_restored !== true ||
    acknowledgement.manifest_rel !==
      `${acknowledgement.artifact_dir_rel}/terminal.json` ||
    acknowledgement.artifact_dir_rel !==
      `instances/${acknowledgement.instance_id}`
  ) {
    throw new Error("v2 capture acknowledgement identity is invalid");
  }
  return acknowledgement;
}

function canonicalAcknowledgement(value: MetalIrV2Acknowledgement) {
  return {
    schema: value.schema,
    mode: value.mode,
    state: value.state,
    uid: value.uid,
    pid: value.pid,
    nonce: value.nonce,
    token: value.token,
    attempt_id: value.attempt_id,
    run_id: value.run_id,
    session_root: value.session_root,
    instance_id: value.instance_id,
    manifest_rel: value.manifest_rel,
    artifact_dir_rel: value.artifact_dir_rel,
    capture_sha256: value.capture_sha256,
    module_sha256: value.module_sha256,
    d3dmetal_sha256: value.d3dmetal_sha256,
    provider_sha256: value.provider_sha256,
    configured_offset: value.configured_offset,
    target_predicate: value.target_predicate,
    process_executable: value.process_executable,
    configured_game_executable: value.configured_game_executable,
    got_slot: value.got_slot,
    got_readback: value.got_readback,
    protection_restored: value.protection_restored,
  };
}

function assertExpected<T extends object>(
  value: T,
  expected: Partial<T> | undefined,
  kind: string
) {
  if (!expected) return;
  for (const key of Object.keys(expected) as Array<keyof T>) {
    if (expected[key] !== undefined && value[key] !== expected[key]) {
      throw new Error(`v2 capture ${kind} identity mismatch: ${String(key)}`);
    }
  }
}

export function serializeMetalIrV2Acknowledgement(
  acknowledgement: MetalIrV2Acknowledgement
) {
  const parsed = acknowledgementFrom(
    acknowledgement as unknown as Record<string, unknown>
  );
  return textEncoder.encode(JSON.stringify(canonicalAcknowledgement(parsed)));
}

export function parseMetalIrV2AcknowledgementBytes(
  bytes: Uint8Array,
  expected?: MetalIrV2AckExpectation
): MetalIrV2Acknowledgement {
  const { raw, value } = parseRawObject(bytes);
  const acknowledgement = acknowledgementFrom(value);
  if (JSON.stringify(canonicalAcknowledgement(acknowledgement)) !== raw) {
    throw new Error("v2 capture acknowledgement is noncanonical or unknown");
  }
  assertExpected(acknowledgement, expected, "acknowledgement");
  return acknowledgement;
}

export function isMetalIrV2AcknowledgementBytes(
  bytes: Uint8Array,
  expected?: MetalIrV2AckExpectation
) {
  try {
    parseMetalIrV2AcknowledgementBytes(bytes, expected);
    return true;
  } catch {
    return false;
  }
}

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

/** SHA-256 over original bytes, never a reserialized acknowledgement. */
export function sha256Hex(bytes: Uint8Array) {
  const initial = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
    0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.byteLength * 8;
  if (!Number.isSafeInteger(bitLength)) throw new Error("SHA-256 input too large");
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const words = new Uint32Array(64);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(block + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15], b = words[index - 2];
      words[index] = (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) + words[index - 16] +
        (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) + words[index - 7];
    }
    let [a, b, c, d, e, f, g, h] = initial;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const temp1 = (h + sigma1 + ((e & f) ^ (~e & g)) + constants[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const temp2 = (sigma0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    initial[0] = (initial[0] + a) >>> 0; initial[1] = (initial[1] + b) >>> 0;
    initial[2] = (initial[2] + c) >>> 0; initial[3] = (initial[3] + d) >>> 0;
    initial[4] = (initial[4] + e) >>> 0; initial[5] = (initial[5] + f) >>> 0;
    initial[6] = (initial[6] + g) >>> 0; initial[7] = (initial[7] + h) >>> 0;
  }
  return initial.map(value => value.toString(16).padStart(8, "0")).join("");
}

export function hashMetalIrV2AcknowledgementBytes(bytes: Uint8Array) {
  parseMetalIrV2AcknowledgementBytes(bytes);
  return sha256Hex(bytes);
}

function armFrom(value: Record<string, unknown>): MetalIrV2Arm {
  const arm: MetalIrV2Arm = {
    schema: value.schema as typeof METAL_IR_V2_SCHEMA,
    mode: value.mode as typeof METAL_IR_V2_MODE,
    state: value.state as typeof METAL_IR_V2_ARM_STATE,
    uid: assertSafeInteger(value.uid, "uid", true),
    pid: assertSafeInteger(value.pid, "pid"),
    nonce: assertText(value.nonce, "nonce"),
    ack_sha256: assertHash(value.ack_sha256, "ack_sha256"),
  };
  if (
    arm.schema !== METAL_IR_V2_SCHEMA || arm.mode !== METAL_IR_V2_MODE ||
    arm.state !== METAL_IR_V2_ARM_STATE || !noncePattern.test(arm.nonce)
  ) throw new Error("v2 capture ARM identity is invalid");
  return arm;
}

function canonicalArm(value: MetalIrV2Arm | MetalIrV2Stop) {
  return { schema: value.schema, mode: value.mode, state: value.state, uid: value.uid, pid: value.pid, nonce: value.nonce, ack_sha256: value.ack_sha256 };
}

export function serializeMetalIrV2Arm(
  acknowledgement: MetalIrV2Acknowledgement,
  acknowledgementBytes: Uint8Array
) {
  parseMetalIrV2AcknowledgementBytes(acknowledgementBytes, acknowledgement);
  return textEncoder.encode(JSON.stringify(canonicalArm({
    schema: METAL_IR_V2_SCHEMA, mode: METAL_IR_V2_MODE, state: METAL_IR_V2_ARM_STATE,
    uid: acknowledgement.uid, pid: acknowledgement.pid, nonce: acknowledgement.nonce,
    ack_sha256: hashMetalIrV2AcknowledgementBytes(acknowledgementBytes),
  })));
}

export function parseMetalIrV2ArmBytes(bytes: Uint8Array, expected?: Partial<MetalIrV2Arm>) {
  const { raw, value } = parseRawObject(bytes);
  const arm = armFrom(value);
  if (JSON.stringify(canonicalArm(arm)) !== raw) throw new Error("v2 capture ARM is noncanonical or unknown");
  assertExpected(arm, expected, "ARM");
  return arm;
}

export function serializeMetalIrV2Stop(
  acknowledgement: MetalIrV2Acknowledgement,
  acknowledgementBytes: Uint8Array
) {
  parseMetalIrV2AcknowledgementBytes(acknowledgementBytes, acknowledgement);
  const stop: MetalIrV2Stop = {
    schema: METAL_IR_V2_SCHEMA,
    mode: METAL_IR_V2_MODE,
    state: "stop",
    uid: acknowledgement.uid,
    pid: acknowledgement.pid,
    nonce: acknowledgement.nonce,
    ack_sha256: hashMetalIrV2AcknowledgementBytes(acknowledgementBytes),
  };
  return textEncoder.encode(JSON.stringify(canonicalArm(stop)));
}

export function parseMetalIrV2StopBytes(
  bytes: Uint8Array,
  expected?: Partial<MetalIrV2Stop>
) {
  const { raw, value } = parseRawObject(bytes);
  const stop = armFrom({ ...value, state: METAL_IR_V2_ARM_STATE }) as unknown as MetalIrV2Stop;
  stop.state = value.state as "stop";
  if (stop.state !== "stop" || JSON.stringify(canonicalArm(stop)) !== raw) {
    throw new Error("v2 capture STOP is noncanonical or unknown");
  }
  assertExpected(stop, expected, "STOP");
  return stop;
}

export function metalIrV2AcknowledgementFilename(value: Pick<MetalIrV2Acknowledgement, "pid" | "nonce">) {
  return `ack-${value.pid}-${value.nonce}.json`;
}

export function metalIrV2ArmFilename(value: Pick<MetalIrV2Acknowledgement, "pid" | "nonce">) {
  return `arm-${value.pid}-${value.nonce}.json`;
}

export function parseMetalIrV2AcknowledgementFilename(name: string) {
  const match = /^ack-([1-9][0-9]*)-([0-9a-f]{32})\.json$/.exec(name);
  return match ? { pid: Number(match[1]), nonce: match[2] } : null;
}

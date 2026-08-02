import { join } from "path-browserify";
import {
  exec,
  mkdirp,
  readBinary,
  removeFileIfExists,
  writeBinary,
} from "@utils";
import {
  hashMetalIrV2AcknowledgementBytes,
  parseMetalIrV2AcknowledgementBytes,
  parseMetalIrV2ArmBytes,
  sha256Hex,
  serializeMetalIrV2Arm,
  serializeMetalIrV2Stop,
  metalIrV2ArmFilename,
  MetalIrV2AckExpectation,
} from "../diagnostics/metal-ir-v2-protocol";

export const CAPTURE_FS_HELPER_RELATIVE_PATH =
  "sidecar/diagnostics/yaagl-capture-fs-helper" as const;
export const CAPTURE_CONTROL_STAGING_DIRECTORY = "controls/v2-staged" as const;

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function assertSafeRelativePath(value: string, label: string) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(
      value
    ) ||
    value.split("/").some(component => component === "." || component === "..")
  ) {
    throw new Error(`unsafe ${label}`);
  }
}

function assertSafeLeaf(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error("unsafe capture control leaf");
  }
}

function stageLeaf() {
  const entropy = new Uint8Array(12);
  crypto.getRandomValues(entropy);
  return `control-${Array.from(entropy, byte => byte.toString(16).padStart(2, "0")).join("")}.json`;
}

export async function installedCaptureFsHelperSha256(helperPath: string) {
  return sha256Hex(new Uint8Array(await readBinary(helperPath)));
}

export async function publishCaptureControlJson({
  helperPath,
  sessionRoot,
  destinationDirectoryRelative,
  leaf,
  bytes,
}: {
  helperPath: string;
  sessionRoot: string;
  destinationDirectoryRelative: string;
  leaf: string;
  bytes: Uint8Array;
}) {
  assertSafeRelativePath(destinationDirectoryRelative, "destination directory");
  assertSafeLeaf(leaf);
  if (bytes.byteLength === 0) throw new Error("capture control is empty");
  const stagingDirectory = join(sessionRoot, CAPTURE_CONTROL_STAGING_DIRECTORY);
  const sourceRelative = join(CAPTURE_CONTROL_STAGING_DIRECTORY, stageLeaf());
  const sourcePath = join(sessionRoot, sourceRelative);
  await mkdirp(stagingDirectory);
  await exec(["/bin/chmod", "700", stagingDirectory]);
  await writeBinary(sourcePath, bytesToArrayBuffer(bytes));
  await exec(["/bin/chmod", "600", sourcePath]);
  try {
    await exec([
      helperPath,
      "publish-json",
      sessionRoot,
      sourceRelative,
      destinationDirectoryRelative,
      leaf,
    ]);
  } finally {
    // The helper only reads the source file. It never unlinks caller-owned
    // staging, so a failed publish leaves no replayable source control.
    await removeFileIfExists(sourcePath);
  }
  return join(sessionRoot, destinationDirectoryRelative, leaf);
}

export async function stageMetalIrV2Arm({
  helperPath,
  sessionRoot,
  acknowledgementBytes,
  expectedAcknowledgement,
}: {
  helperPath: string;
  sessionRoot: string;
  acknowledgementBytes: Uint8Array;
  expectedAcknowledgement?: Partial<MetalIrV2AckExpectation>;
}) {
  const acknowledgement = parseMetalIrV2AcknowledgementBytes(
    acknowledgementBytes,
    expectedAcknowledgement
  );
  const acknowledgementHash = hashMetalIrV2AcknowledgementBytes(
    acknowledgementBytes
  );
  const armBytes = serializeMetalIrV2Arm(acknowledgement, acknowledgementBytes);
  const leaf = metalIrV2ArmFilename(acknowledgement);
  const path = await publishCaptureControlJson({
    helperPath,
    sessionRoot,
    destinationDirectoryRelative: "arms",
    leaf,
    bytes: armBytes,
  });
  return {
    acknowledgement,
    acknowledgementHash,
    armBytes,
    armHash: sha256Hex(armBytes),
    path,
  };
}

export async function stageMetalIrV2Stop({
  helperPath,
  sessionRoot,
  acknowledgementBytes,
  expectedAcknowledgement,
}: {
  helperPath: string;
  sessionRoot: string;
  acknowledgementBytes: Uint8Array;
  expectedAcknowledgement?: Partial<MetalIrV2AckExpectation>;
}) {
  const acknowledgement = parseMetalIrV2AcknowledgementBytes(
    acknowledgementBytes,
    expectedAcknowledgement
  );
  const stopBytes = serializeMetalIrV2Stop(
    acknowledgement,
    acknowledgementBytes
  );
  const path = await publishCaptureControlJson({
    helperPath,
    sessionRoot,
    destinationDirectoryRelative: "controls",
    leaf: `stop-${acknowledgement.pid}-${acknowledgement.nonce}.json`,
    bytes: stopBytes,
  });
  return { acknowledgement, stopBytes, path };
}

export async function validateMetalIrV2TerminalControls({
  acknowledgementPath,
  armPath,
  expectedAcknowledgement,
  expectedAcknowledgementHash,
  expectedArmHash,
}: {
  acknowledgementPath: string;
  armPath: string;
  expectedAcknowledgement: MetalIrV2AckExpectation;
  expectedAcknowledgementHash: string;
  expectedArmHash?: string;
}) {
  const acknowledgementBytes = new Uint8Array(await readBinary(acknowledgementPath));
  const acknowledgement = parseMetalIrV2AcknowledgementBytes(
    acknowledgementBytes,
    expectedAcknowledgement
  );
  const acknowledgementHash = hashMetalIrV2AcknowledgementBytes(
    acknowledgementBytes
  );
  if (acknowledgementHash !== expectedAcknowledgementHash) {
    throw new Error("v2 capture acknowledgement hash changed before terminal validation");
  }
  const armBytes = new Uint8Array(await readBinary(armPath));
  const armHash = sha256Hex(armBytes);
  if (expectedArmHash && armHash !== expectedArmHash) {
    throw new Error("v2 capture ARM hash changed before terminal validation");
  }
  const arm = parseMetalIrV2ArmBytes(armBytes, {
    ...acknowledgement,
    state: "armed",
    ack_sha256: acknowledgementHash,
  });
  return { acknowledgement, acknowledgementHash, arm, armHash };
}

export async function cleanupMetalIrV2ControlFiles(paths: readonly string[]) {
  await Promise.all(paths.map(path => removeFileIfExists(path)));
}

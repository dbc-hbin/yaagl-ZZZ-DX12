import { execFileSync, spawn, spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hashMetalIrV2AcknowledgementBytes,
  parseMetalIrV2AcknowledgementBytes,
  parseMetalIrV2ArmBytes,
  serializeMetalIrV2Acknowledgement,
  serializeMetalIrV2Arm,
  serializeMetalIrV2Stop,
  sha256Hex,
} from "./metal-ir-v2-protocol";

const encoder = new TextEncoder();
const nonce = "a".repeat(32);
const acknowledgement = {
  schema: 2 as const,
  mode: "metal-ir-capture-v2" as const,
  state: "installed" as const,
  uid: 501,
  pid: 4242,
  nonce,
  token: "b".repeat(32),
  attempt_id: "run-1-attempt-1",
  run_id: "run-1",
  session_root: "/tmp/session",
  instance_id: "instance-1",
  manifest_rel: "instances/instance-1/terminal.json",
  artifact_dir_rel: "instances/instance-1",
  capture_sha256: "c".repeat(64),
  module_sha256: "d".repeat(64),
  d3dmetal_sha256: "d".repeat(64),
  provider_sha256: "e".repeat(64),
  configured_offset: "0x87ec9",
  target_predicate: "exact-offset-precall-dxil",
  process_executable: "C:\\windows\\system32\\steam.exe",
  configured_game_executable:
    "Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe",
  got_slot: "0x4ae1a0",
  got_readback: true as const,
  protection_restored: true as const,
};
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const helper = join(workspace, "sidecar/diagnostics/yaagl-capture-fs-helper");
let fixtureRoot = "";

describe("Metal IR v2 raw-byte protocol", () => {
  it("binds ARM to the exact compact acknowledgement bytes", () => {
    const acknowledgementBytes = serializeMetalIrV2Acknowledgement(acknowledgement);
    const acknowledgementHash = hashMetalIrV2AcknowledgementBytes(
      acknowledgementBytes
    );
    expect(acknowledgementHash).toBe(
      createHash("sha256").update(acknowledgementBytes).digest("hex")
    );
    const armBytes = serializeMetalIrV2Arm(
      acknowledgement,
      acknowledgementBytes
    );
    expect(parseMetalIrV2AcknowledgementBytes(acknowledgementBytes)).toEqual(
      acknowledgement
    );
    expect(parseMetalIrV2ArmBytes(armBytes)).toEqual({
      schema: 2,
      mode: "metal-ir-capture-v2",
      state: "armed",
      uid: acknowledgement.uid,
      pid: acknowledgement.pid,
      nonce: acknowledgement.nonce,
      ack_sha256: acknowledgementHash,
    });
    expect(sha256Hex(new Uint8Array([0xfe, 0x72, 0x61, 0x77]))).toBe(
      createHash("sha256")
        .update(Buffer.from([0xfe, 0x72, 0x61, 0x77]))
        .digest("hex")
    );
  });

  it("rejects v1, unknown, duplicate, BOM, trailing, and noncanonical controls", () => {
    const canonical = new TextDecoder().decode(
      serializeMetalIrV2Acknowledgement(acknowledgement)
    );
    const rejected = [
      canonical.replace('"schema":2', '"schema":1'),
      canonical.replace("}", ',"extra":true}'),
      canonical.replace('"uid":501', '"uid":501,"uid":501'),
      `\ufeff${canonical}`,
      `${canonical}\n`,
      `${canonical} `,
      canonical.replace('"uid":501', '"uid":0501'),
      canonical.replace('"state":"installed","uid"', '"uid":501,"state":"installed"'),
    ];
    for (const value of rejected) {
      expect(() => parseMetalIrV2AcknowledgementBytes(encoder.encode(value))).toThrow();
    }
  });

  it("requires the ARM to contain exactly the acknowledgement binding fields", () => {
    const acknowledgementBytes = serializeMetalIrV2Acknowledgement(acknowledgement);
    const arm = new TextDecoder().decode(
      serializeMetalIrV2Arm(acknowledgement, acknowledgementBytes)
    );
    expect(() =>
      parseMetalIrV2ArmBytes(encoder.encode(arm.replace("}", ',"uid":501}')))
    ).toThrow();
    expect(() => parseMetalIrV2ArmBytes(encoder.encode(`${arm}\n`))).toThrow();
  });
});

describe("capture-fs-helper native fixture", () => {
  beforeAll(() => {
    // This is the production helper built from the native source, not a
    // JavaScript stand-in. A missing compiler/helper is a test failure.
    execFileSync("bash", [join(workspace, "scripts/build-capture-fs-helper.sh")], {
      cwd: workspace,
      stdio: "inherit",
    });
    fixtureRoot = mkdtempSync(join(tmpdir(), "yaagl-capture-fs-helper-"));
    chmodSync(fixtureRoot, 0o700);
    for (const directory of ["controls", "acks", "arms"]) {
      const target = join(fixtureRoot, directory);
      mkdirSync(target);
      chmodSync(target, 0o700);
    }
  });

  afterAll(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("publishes the actual fixture bytes with O_NOFOLLOW, 0600, fsync, and exclusive rename", () => {
    const bytes = serializeMetalIrV2Acknowledgement(acknowledgement);
    const source = join(fixtureRoot, "controls/ack.json");
    const leaf = `ack-${acknowledgement.pid}-${acknowledgement.nonce}.json`;
    writeFileSync(source, bytes, { mode: 0o600 });
    chmodSync(source, 0o600);
    execFileSync(helper, [
      "publish-json",
      fixtureRoot,
      "controls/ack.json",
      "acks",
      leaf,
    ]);
    const published = join(fixtureRoot, "acks", leaf);
    expect(readFileSync(published)).toEqual(Buffer.from(bytes));
    expect(lstatSync(published).isSymbolicLink()).toBe(false);
    expect(lstatSync(published).mode & 0o777).toBe(0o600);

    const collision = spawnSync(
      helper,
      ["publish-json", fixtureRoot, "controls/ack.json", "acks", leaf],
      { encoding: "utf8" }
    );
    expect(collision.status).not.toBe(0);
    expect(readFileSync(published)).toEqual(Buffer.from(bytes));
  });

  it("rejects a descriptor-traversing symlink source without a fallback path", () => {
    const source = join(fixtureRoot, "controls/link.json");
    symlinkSync("ack.json", source);
    const result = spawnSync(
      helper,
      [
        "publish-json",
        fixtureRoot,
        "controls/link.json",
        "arms",
        `arm-${acknowledgement.pid}-${nonce}.json`,
      ],
      { encoding: "utf8" }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("source control rejected");
  });
});

describe("native to TypeScript v2 round trip", () => {
  it("accepts the native raw ACK and returns a hash-bound ARM", async () => {
    execFileSync(
      "bash",
      [join(workspace, "scripts/build-metal-ir-capture.sh"), "--v2-integration-fixture"],
      { cwd: workspace, stdio: "ignore" }
    );
    execFileSync("bash", [join(workspace, "scripts/build-capture-fs-helper.sh")], {
      cwd: workspace,
      stdio: "ignore",
    });
    const root = mkdtempSync(join(tmpdir(), "yaagl-metal-ir-v2-roundtrip-"));
    chmodSync(root, 0o700);
    const host = spawn(
      join(workspace, "build/metal-ir-capture-tests/v2-fixture-host"),
      ["--external", root],
      { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    let errorOutput = "";
    host.stdout.setEncoding("utf8");
    host.stderr.setEncoding("utf8");
    host.stdout.on("data", chunk => {
      output += chunk;
    });
    host.stderr.on("data", chunk => {
      errorOutput += chunk;
    });
    try {
      const deadline = Date.now() + 5000;
      while (!output.includes("\n") && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const ackPath = output.split("\n")[0];
      expect(ackPath).toBeTruthy();
      const ackBytes = new Uint8Array(readFileSync(ackPath));
      const nativeAck = parseMetalIrV2AcknowledgementBytes(ackBytes);
      expect(nativeAck.nonce).toMatch(/^[0-9a-f]{32}$/);
      const armBytes = serializeMetalIrV2Arm(nativeAck, ackBytes);
      const armSource = join(root, "controls/arm.json");
      writeFileSync(armSource, armBytes, { mode: 0o600 });
      chmodSync(armSource, 0o600);
      execFileSync(helper, [
        "publish-json",
        root,
        "controls/arm.json",
        "arms",
        `arm-${nativeAck.pid}-${nativeAck.nonce}.json`,
      ]);
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        host.once("error", reject);
        host.once("close", resolve);
      });
      expect(exitCode, errorOutput).toBe(0);
      const lines = output.trim().split("\n");
      const terminal = JSON.parse(readFileSync(lines[lines.length - 1], "utf8"));
      expect(terminal).toMatchObject({
        schema: 2,
        kind: "terminal",
        status: "complete",
        outcome: "expected_count",
        capture_count: 11,
      });
    } finally {
      if (host.exitCode === null) host.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("installed production dylib constructor round trip", () => {
  it("patches the fixture GOT, arms through TypeScript, captures eleven calls, and restores", async () => {
    execFileSync(
      "bash",
      [join(workspace, "scripts/build-metal-ir-capture.sh"), "--v2-constructor-fixture-build"],
      { cwd: workspace, stdio: "ignore" }
    );
    const support = join(
      process.env.HOME || "",
      "Library/Application Support/Yaagl ZZZ DX12"
    );
    const installedDylib = join(
      support,
      "sidecar/diagnostics/libyaagl-metal-ir-capture.dylib"
    );
    const installedHelper = join(
      support,
      "sidecar/diagnostics/yaagl-capture-fs-helper"
    );
    const sourceDylib = join(
      workspace,
      "sidecar/diagnostics/libyaagl-metal-ir-capture.dylib"
    );
    const fileHash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(fileHash(installedDylib)).toBe(fileHash(sourceDylib));
    const root = mkdtempSync(join(tmpdir(), "yaagl-v2-constructor-"));
    chmodSync(root, 0o700);
    for (const directory of ["acks", "arms", "controls", "instances"]) {
      mkdirSync(join(root, directory));
      chmodSync(join(root, directory), 0o700);
    }
    const build = join(workspace, "build/metal-ir-capture-tests");
    const consumer = join(build, "libv2-fixture-consumer.dylib");
    const provider = join(build, "libv2-fixture-provider.dylib");
    const host = spawn(join(build, "v2-constructor-host"), [], {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DYLD_INSERT_LIBRARIES: installedDylib,
        YAAGL_RUNTIME_MODE: "metal-ir-capture-v2",
        YAAGL_METAL_IR_V2_CONSTRUCTOR_FIXTURE: "1",
        YAAGL_METAL_IR_FIXTURE_GOT_OFFSET: readFileSync(
          join(build, "v2-fixture-got-offset.txt"),
          "utf8"
        ).trim(),
        YAAGL_METAL_IR_SESSION_ROOT: root,
        YAAGL_METAL_IR_RUN_ID: "constructor-run",
        YAAGL_METAL_IR_ATTEMPT_ID: "constructor-attempt",
        YAAGL_METAL_IR_ACK_TOKEN: "f".repeat(32),
        YAAGL_METAL_IR_CAPTURE_SHA256: fileHash(installedDylib),
        YAAGL_METAL_IR_D3DMETAL_SHA256: fileHash(consumer),
        YAAGL_METAL_IR_PROVIDER_SHA256: fileHash(provider),
        YAAGL_METAL_IR_D3DMETAL: consumer,
        YAAGL_METAL_IR_PROVIDER: provider,
        YAAGL_METAL_IR_GAME_EXECUTABLE:
          "Z:\\Applications\\ZenlessZoneZero\\ZenlessZoneZero.exe",
      },
    });
    let stdout = "";
    let stderr = "";
    host.stdout.setEncoding("utf8");
    host.stderr.setEncoding("utf8");
    host.stdout.on("data", chunk => {
      stdout += chunk;
    });
    host.stderr.on("data", chunk => {
      stderr += chunk;
    });
    try {
      let ackLeaf = "";
      const deadline = Date.now() + 5000;
      while (!ackLeaf && Date.now() < deadline) {
        ackLeaf = readdirSync(join(root, "acks")).find(name =>
          /^ack-\d+-[0-9a-f]{32}\.json$/.test(name)
        ) || "";
        if (!ackLeaf) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(ackLeaf, stderr).toBeTruthy();
      const ackBytes = new Uint8Array(readFileSync(join(root, "acks", ackLeaf)));
      const ack = parseMetalIrV2AcknowledgementBytes(ackBytes, {
        run_id: "constructor-run",
        attempt_id: "constructor-attempt",
        token: "f".repeat(32),
        session_root: root,
        capture_sha256: fileHash(installedDylib),
        module_sha256: fileHash(installedDylib),
        d3dmetal_sha256: fileHash(consumer),
        provider_sha256: fileHash(provider),
      });
      const armBytes = serializeMetalIrV2Arm(ack, ackBytes);
      const source = join(root, "controls/arm.json");
      writeFileSync(source, armBytes, { mode: 0o600 });
      chmodSync(source, 0o600);
      execFileSync(installedHelper, [
        "publish-json",
        root,
        "controls/arm.json",
        "arms",
        `arm-${ack.pid}-${ack.nonce}.json`,
      ]);
      const callsDeadline = Date.now() + 10_000;
      while (!stdout.includes("calls-complete\n") && Date.now() < callsDeadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(stdout, stderr).toContain("calls-complete\n");
      const stopBytes = serializeMetalIrV2Stop(ack, ackBytes);
      const stopSource = join(root, "controls/stop.json");
      writeFileSync(stopSource, stopBytes, { mode: 0o600 });
      chmodSync(stopSource, 0o600);
      execFileSync(installedHelper, [
        "publish-json",
        root,
        "controls/stop.json",
        "controls",
        `stop-${ack.pid}-${ack.nonce}.json`,
      ]);
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        host.once("error", reject);
        host.once("close", resolve);
      });
      expect(exitCode, stderr).toBe(0);
      const terminalPath = stdout.trim().split("\n").pop() || "";
      const terminal = JSON.parse(readFileSync(terminalPath, "utf8"));
      expect(terminal).toMatchObject({
        schema: 2,
        kind: "terminal",
        run_id: "constructor-run",
        status: "complete",
        outcome: "expected_count",
        capture_count: 11,
        drain: { records: 11, persisted: 11, in_flight: 0, got_restored: true },
        outcomes: { original_calls: 11 },
      });
    } finally {
      if (host.exitCode === null) host.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});

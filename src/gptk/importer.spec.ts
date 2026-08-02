import { createHash } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GPTK_CACHED_LIBRARY_DIRECTORY,
  GPTK_D3DMETAL_INFO_PLIST,
  GPTK_D3DMETAL_VERSION,
  GPTK_MANIFEST_FILENAME,
  GPTK_MANIFEST_SCHEMA_VERSION,
  GPTK_REQUIRED_RUNTIME_FILES,
  GPTK_RUNTIME_VERSION,
  GptkImportError,
  cacheMountedRuntime,
  importGptkRuntime,
  importGptkRuntimeFromCandidates,
  validateCachedRuntime,
  validateMountedEvaluationRoot,
} from "./index";
import type {
  GptkCommandRequest,
  GptkCommandResult,
  GptkFilesystem,
  GptkHostOperations,
} from "./index";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yaagl-gptk-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      })
    )
  );
});

const listFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (target: string): Promise<void> => {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isFile()) {
      files.push(target);
      return;
    }
    if (stat.isDirectory()) {
      for (const child of await fs.readdir(target)) {
        await visit(path.join(target, child));
      }
    }
  };
  await visit(root);
  return files;
};

const nodeFilesystem = (): GptkFilesystem => ({
  exists: async target =>
    fs.access(target).then(
      () => true,
      () => false
    ),
  stat: async target => {
    const stat = await fs.stat(target);
    return {
      type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
      size: stat.size,
    };
  },
  listDirectory: async target =>
    (await fs.readdir(target, { withFileTypes: true })).map(entry => ({
      name: entry.name,
      type: entry.isFile()
        ? "file"
        : entry.isDirectory()
        ? "directory"
        : "other",
    })),
  readText: target => fs.readFile(target, "utf8"),
  readBytes: async target => new Uint8Array(await fs.readFile(target)),
  writeText: async (target, contents) => {
    await fs.writeFile(target, contents, "utf8");
  },
  createDirectory: async (target, options) => {
    await fs.mkdir(target, { recursive: options?.recursive ?? false });
  },
  copyFile: async (source, destination) => {
    await fs.copyFile(source, destination);
  },
  copyDirectory: async (source, destination) => {
    await fs.cp(source, destination, { recursive: true, dereference: false });
  },
  listFiles,
  remove: async (target, options) => {
    await fs.rm(target, {
      recursive: options?.recursive ?? false,
      force: false,
    });
  },
  move: async (source, destination) => {
    await fs.rename(source, destination);
  },
});

interface FakeCommandState {
  requests: GptkCommandRequest[];
  mounts: Map<string, { mountPoint?: string; device?: string }>;
  failedAttachments: Set<string>;
  failedDetachments: Set<string>;
  signatureValid: boolean;
}

const createCommandState = (): FakeCommandState => ({
  requests: [],
  mounts: new Map(),
  failedAttachments: new Set(),
  failedDetachments: new Set(),
  signatureValid: true,
});

const xmlEscape = (value: string) => value.replaceAll("&", "&amp;");

const attachPlist = (mountPoint?: string, device = "/dev/disk-test") => `
  <plist><array><dict><key>system-entities</key><array><dict>
  <key>dev-entry</key><string>${xmlEscape(device)}</string>
  ${
    mountPoint
      ? `<key>mount-point</key><string>${xmlEscape(mountPoint)}</string>`
      : ""
  }
  </dict></array></dict></array></plist>`;

const fakeCommandRunner =
  (state: FakeCommandState) =>
  async (request: GptkCommandRequest): Promise<GptkCommandResult> => {
    state.requests.push(request);
    if (request.executable.endsWith("plutil")) {
      try {
        return {
          exitCode: 0,
          stdout: await fs.readFile(
            request.argv[request.argv.length - 1],
            "utf8"
          ),
          stderr: "",
        };
      } catch (error) {
        return { exitCode: 1, stdout: "", stderr: String(error) };
      }
    }
    if (request.executable.endsWith("codesign")) {
      return state.signatureValid
        ? { exitCode: 0, stdout: "", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "invalid signature" };
    }
    if (request.argv[0] === "attach") {
      const source = request.argv[request.argv.length - 1];
      if (state.failedAttachments.has(source)) {
        return { exitCode: 1, stdout: "", stderr: "attach failed" };
      }
      const mount = state.mounts.get(source);
      return mount
        ? {
            exitCode: 0,
            stdout: attachPlist(mount.mountPoint, mount.device),
            stderr: "",
          }
        : { exitCode: 1, stdout: "", stderr: "unknown image" };
    }
    if (request.argv[0] === "detach") {
      return state.failedDetachments.has(request.argv[1])
        ? { exitCode: 1, stdout: "", stderr: "detach failed" }
        : { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(
      `Unexpected command: ${request.executable} ${request.argv.join(" ")}`
    );
  };

const createHost = (
  state: FakeCommandState,
  filesystem: GptkFilesystem = nodeFilesystem(),
  runCommand = fakeCommandRunner(state)
): GptkHostOperations => {
  let uniqueId = 0;
  return {
    filesystem,
    path: {
      join: (...parts) => path.join(...parts),
      dirname: target => path.dirname(target),
      basename: target => path.basename(target),
      relative: (from, to) => path.relative(from, to),
    },
    runCommand,
    sha256: async bytes => createHash("sha256").update(bytes).digest("hex"),
    now: () => new Date("2026-07-31T00:00:00.000Z"),
    createUniqueId: () => `test-${(uniqueId += 1)}`,
  };
};

const runtimeFile = (evaluationRoot: string, relativePath: string) =>
  path.join(evaluationRoot, "redist", "lib", ...relativePath.split("/"));

const createEvaluationRoot = async (
  evaluationRoot: string,
  options: {
    version?: string;
    marker?: string;
    documents?: boolean;
  } = {}
): Promise<void> => {
  const framework = runtimeFile(evaluationRoot, "external/D3DMetal.framework");
  const resources = path.join(framework, "Versions", "A", "Resources");
  await fs.mkdir(resources, { recursive: true });
  await fs.writeFile(
    path.join(framework, "Versions", "A", "D3DMetal"),
    `D3DMetal-${options.marker ?? "runtime"}`
  );
  await fs.writeFile(
    path.join(resources, "Info.plist"),
    `<plist><dict>
      <key>CFBundleShortVersionString</key><string>${
        options.version ?? GPTK_D3DMETAL_VERSION
      }</string>
      <key>CFBundleVersion</key><string>${
        options.version ?? GPTK_D3DMETAL_VERSION
      }</string>
    </dict></plist>`
  );
  await fs.writeFile(path.join(resources, "default.metallib"), "metal-library");
  await fs.symlink("A", path.join(framework, "Versions", "Current"));
  await fs.symlink(
    "Versions/Current/D3DMetal",
    path.join(framework, "D3DMetal")
  );
  await fs.symlink(
    "Versions/Current/Resources",
    path.join(framework, "Resources")
  );

  for (const relativePath of GPTK_REQUIRED_RUNTIME_FILES) {
    const target = runtimeFile(evaluationRoot, relativePath);
    if (relativePath.includes("D3DMetal.framework/D3DMetal")) {
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      `${relativePath}-${options.marker ?? "runtime"}`
    );
  }

  await fs.writeFile(path.join(evaluationRoot, "License.rtf"), "license");

  if (options.documents) {
    await fs.writeFile(
      path.join(evaluationRoot, "Acknowledgements.rtf"),
      "acknowledgements"
    );
  }
};

const detachTargets = (state: FakeCommandState) =>
  state.requests
    .filter(request => request.argv[0] === "detach")
    .map(request => request.argv[1]);

describe("mounted GPTK validation", () => {
  it("accepts the real 4.0b2 layout and verifies the D3DMetal signature", async () => {
    const evaluationRoot = await createTemporaryDirectory();
    await createEvaluationRoot(evaluationRoot);
    const state = createCommandState();

    const validated = await validateMountedEvaluationRoot(
      createHost(state),
      evaluationRoot
    );

    expect(validated.d3dMetalVersion).toBe(GPTK_D3DMETAL_VERSION);
    expect(state.requests).toEqual([
      {
        executable: "/usr/bin/plutil",
        argv: [
          "-convert",
          "xml1",
          "-o",
          "-",
          "--",
          runtimeFile(evaluationRoot, GPTK_D3DMETAL_INFO_PLIST),
        ],
      },
      {
        executable: "/usr/bin/codesign",
        argv: [
          "--verify",
          "--deep",
          "--strict",
          runtimeFile(evaluationRoot, "external/D3DMetal.framework"),
        ],
      },
    ]);
  });

  const macIt = process.platform === "darwin" ? it : it.skip;
  macIt("normalizes and accepts a binary D3DMetal Info.plist", async () => {
    const evaluationRoot = await createTemporaryDirectory();
    await createEvaluationRoot(evaluationRoot);
    const infoPlist = runtimeFile(evaluationRoot, GPTK_D3DMETAL_INFO_PLIST);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "/usr/bin/plutil",
        ["-convert", "binary1", "--", infoPlist],
        error => (error ? reject(error) : resolve())
      );
    });
    expect((await fs.readFile(infoPlist)).subarray(0, 8).toString()).toBe(
      "bplist00"
    );

    const state = createCommandState();
    const fakeRunner = fakeCommandRunner(state);
    const hostRunner = async (
      request: GptkCommandRequest
    ): Promise<GptkCommandResult> => {
      if (!request.executable.endsWith("plutil")) {
        return fakeRunner(request);
      }
      state.requests.push(request);
      return await new Promise(resolve => {
        execFile(
          request.executable,
          request.argv,
          { encoding: "utf8" },
          (error, stdout, stderr) =>
            resolve({
              exitCode:
                error && typeof error.code === "number"
                  ? error.code
                  : error
                  ? 1
                  : 0,
              stdout,
              stderr,
            })
        );
      });
    };

    await expect(
      validateMountedEvaluationRoot(
        createHost(state, nodeFilesystem(), hostRunner),
        evaluationRoot
      )
    ).resolves.toMatchObject({ d3dMetalVersion: GPTK_D3DMETAL_VERSION });
  });

  it.each(GPTK_REQUIRED_RUNTIME_FILES)(
    "rejects a missing mandatory artifact: %s",
    async relativePath => {
      const evaluationRoot = await createTemporaryDirectory();
      await createEvaluationRoot(evaluationRoot);
      await fs.rm(runtimeFile(evaluationRoot, relativePath));

      await expect(
        validateMountedEvaluationRoot(
          createHost(createCommandState()),
          evaluationRoot
        )
      ).rejects.toMatchObject({ code: "missing-artifact" });
    }
  );

  it("rejects a missing plist, a wrong version, and an invalid signature", async () => {
    const missingPlist = await createTemporaryDirectory();
    await createEvaluationRoot(missingPlist);
    await fs.rm(runtimeFile(missingPlist, GPTK_D3DMETAL_INFO_PLIST));
    await expect(
      validateMountedEvaluationRoot(
        createHost(createCommandState()),
        missingPlist
      )
    ).rejects.toMatchObject({ code: "missing-info-plist" });

    const wrongVersion = await createTemporaryDirectory();
    await createEvaluationRoot(wrongVersion, { version: "4.0b1" });
    await expect(
      validateMountedEvaluationRoot(
        createHost(createCommandState()),
        wrongVersion
      )
    ).rejects.toMatchObject({ code: "unsupported-version" });

    const invalidSignature = await createTemporaryDirectory();
    await createEvaluationRoot(invalidSignature);
    const state = createCommandState();
    state.signatureValid = false;
    await expect(
      validateMountedEvaluationRoot(createHost(state), invalidSignature)
    ).rejects.toMatchObject({ code: "invalid-signature" });
  });
});

describe("GPTK cache manifest", () => {
  it("caches lib at the consumer path, preserves symlinks and documents, and hashes every file", async () => {
    const evaluationRoot = await createTemporaryDirectory();
    const destination = path.join(await createTemporaryDirectory(), "4.0b2");
    await createEvaluationRoot(evaluationRoot, { documents: true });
    const host = createHost(createCommandState());

    const manifest = await cacheMountedRuntime(
      host,
      evaluationRoot,
      destination
    );

    expect(manifest).toMatchObject({
      schemaVersion: GPTK_MANIFEST_SCHEMA_VERSION,
      runtimeVersion: GPTK_RUNTIME_VERSION,
      d3dMetalVersion: GPTK_D3DMETAL_VERSION,
      importedAt: "2026-07-31T00:00:00.000Z",
    });
    expect(manifest.files.length).toBeGreaterThan(
      GPTK_REQUIRED_RUNTIME_FILES.length
    );
    expect(
      manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256))
    ).toBe(true);
    expect(
      await fs.readFile(path.join(destination, "License.rtf"), "utf8")
    ).toBe("license");
    expect(
      await fs.readFile(path.join(destination, "Acknowledgements.rtf"), "utf8")
    ).toBe("acknowledgements");
    expect(
      (
        await fs.lstat(
          path.join(
            destination,
            GPTK_CACHED_LIBRARY_DIRECTORY,
            "external/D3DMetal.framework/D3DMetal"
          )
        )
      ).isSymbolicLink()
    ).toBe(true);
    await expect(validateCachedRuntime(host, destination)).resolves.toEqual(
      manifest
    );
  });

  it("requires the GPTK license in every cached runtime", async () => {
    const evaluationRoot = await createTemporaryDirectory();
    const destination = path.join(await createTemporaryDirectory(), "4.0b2");
    await createEvaluationRoot(evaluationRoot);
    await fs.rm(path.join(evaluationRoot, "License.rtf"));

    await expect(
      cacheMountedRuntime(
        createHost(createCommandState()),
        evaluationRoot,
        destination
      )
    ).rejects.toMatchObject({ code: "missing-artifact" });
  });

  it("detects changed hashes, added files, and unsafe manifest paths", async () => {
    const evaluationRoot = await createTemporaryDirectory();
    const destination = path.join(await createTemporaryDirectory(), "4.0b2");
    await createEvaluationRoot(evaluationRoot);
    const host = createHost(createCommandState());
    await cacheMountedRuntime(host, evaluationRoot, destination);

    const d3d12 = path.join(destination, "lib/wine/x86_64-windows/d3d12.dll");
    await fs.writeFile(d3d12, "same-size-tamper!");
    await expect(
      validateCachedRuntime(host, destination)
    ).rejects.toMatchObject({
      code: "cache-size-mismatch",
    });

    await cacheMountedRuntime(host, evaluationRoot, destination);
    await fs.writeFile(path.join(destination, "unexpected"), "extra");
    await expect(
      validateCachedRuntime(host, destination)
    ).rejects.toMatchObject({
      code: "cache-file-set-mismatch",
    });

    await fs.rm(path.join(destination, "unexpected"));
    const manifestPath = path.join(destination, GPTK_MANIFEST_FILENAME);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.files[0].path = "../outside";
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await expect(
      validateCachedRuntime(host, destination)
    ).rejects.toMatchObject({
      code: "manifest-invalid",
    });
  });

  it("keeps a valid previous cache when staging or commit fails", async () => {
    const previousRoot = await createTemporaryDirectory();
    const replacementRoot = await createTemporaryDirectory();
    const destination = path.join(await createTemporaryDirectory(), "4.0b2");
    await createEvaluationRoot(previousRoot, { marker: "previous" });
    await createEvaluationRoot(replacementRoot, { marker: "replacement" });
    const state = createCommandState();
    const baseFilesystem = nodeFilesystem();
    const originalHost = createHost(state, baseFilesystem);
    const previousManifest = await cacheMountedRuntime(
      originalHost,
      previousRoot,
      destination
    );

    const stagingFailureFilesystem: GptkFilesystem = {
      ...baseFilesystem,
      copyDirectory: async (source, target) => {
        await baseFilesystem.copyDirectory(source, target);
        throw new Error("fixture staging failure");
      },
    };
    await expect(
      cacheMountedRuntime(
        createHost(state, stagingFailureFilesystem),
        replacementRoot,
        destination
      )
    ).rejects.toThrow("fixture staging failure");
    await expect(
      validateCachedRuntime(originalHost, destination)
    ).resolves.toEqual(previousManifest);

    const commitFailureFilesystem: GptkFilesystem = {
      ...baseFilesystem,
      move: async (source, target) => {
        if (source.includes(".staging-") && target === destination) {
          throw new Error("fixture commit failure");
        }
        await baseFilesystem.move(source, target);
      },
    };
    await expect(
      cacheMountedRuntime(
        createHost(state, commitFailureFilesystem),
        replacementRoot,
        destination
      )
    ).rejects.toMatchObject({ code: "cache-commit-failed" });
    await expect(
      validateCachedRuntime(originalHost, destination)
    ).resolves.toEqual(previousManifest);
  });
});

describe("GPTK DMG import", () => {
  it("imports an inner evaluation DMG with readonly attach flags and detaches it", async () => {
    const evaluationMount = await createTemporaryDirectory();
    const destination = path.join(await createTemporaryDirectory(), "4.0b2");
    await createEvaluationRoot(evaluationMount);
    const state = createCommandState();
    state.mounts.set("inner.dmg", { mountPoint: evaluationMount });

    await importGptkRuntime(createHost(state), "inner.dmg", destination);

    expect(state.requests[0]).toEqual({
      executable: "/usr/bin/hdiutil",
      argv: ["attach", "-readonly", "-nobrowse", "-plist", "inner.dmg"],
    });
    expect(detachTargets(state)).toEqual([evaluationMount]);
  });

  it("imports through an outer DMG and detaches inner then outer", async () => {
    const outerMount = await createTemporaryDirectory();
    const evaluationMount = await createTemporaryDirectory();
    const destination = path.join(await createTemporaryDirectory(), "4.0b2");
    const innerDmg = path.join(
      outerMount,
      "Evaluation environment for Windows games 4.0 beta 2.dmg"
    );
    await fs.writeFile(innerDmg, "fixture image");
    await createEvaluationRoot(evaluationMount);
    const state = createCommandState();
    state.mounts.set("outer.dmg", { mountPoint: outerMount });
    state.mounts.set(innerDmg, { mountPoint: evaluationMount });

    await importGptkRuntime(createHost(state), "outer.dmg", destination);

    expect(
      state.requests.filter(request => request.argv[0] === "attach")
    ).toEqual([
      {
        executable: "/usr/bin/hdiutil",
        argv: ["attach", "-readonly", "-nobrowse", "-plist", "outer.dmg"],
      },
      {
        executable: "/usr/bin/hdiutil",
        argv: ["attach", "-readonly", "-nobrowse", "-plist", innerDmg],
      },
    ]);
    expect(detachTargets(state)).toEqual([evaluationMount, outerMount]);
  });

  it("detaches every successful mount after validation and nested attach failures", async () => {
    const invalidMount = await createTemporaryDirectory();
    const state = createCommandState();
    state.mounts.set("invalid.dmg", { mountPoint: invalidMount });
    await expect(
      importGptkRuntime(
        createHost(state),
        "invalid.dmg",
        path.join(await createTemporaryDirectory(), "4.0b2")
      )
    ).rejects.toBeInstanceOf(GptkImportError);
    expect(detachTargets(state)).toEqual([invalidMount]);

    const outerMount = await createTemporaryDirectory();
    const innerDmg = path.join(
      outerMount,
      "Evaluation environment for Windows games 4.0 beta 2.dmg"
    );
    await fs.writeFile(innerDmg, "fixture image");
    const nestedFailure = createCommandState();
    nestedFailure.mounts.set("outer.dmg", { mountPoint: outerMount });
    nestedFailure.failedAttachments.add(innerDmg);
    await expect(
      importGptkRuntime(
        createHost(nestedFailure),
        "outer.dmg",
        path.join(await createTemporaryDirectory(), "4.0b2")
      )
    ).rejects.toMatchObject({ code: "attach-failed" });
    expect(detachTargets(nestedFailure)).toEqual([outerMount]);
  });

  it("attempts every detach even when one detach fails", async () => {
    const outerMount = await createTemporaryDirectory();
    const evaluationMount = await createTemporaryDirectory();
    const innerDmg = path.join(
      outerMount,
      "Evaluation environment for Windows games 4.0 beta 2.dmg"
    );
    await fs.writeFile(innerDmg, "fixture image");
    await createEvaluationRoot(evaluationMount);
    const state = createCommandState();
    state.mounts.set("outer.dmg", { mountPoint: outerMount });
    state.mounts.set(innerDmg, { mountPoint: evaluationMount });
    state.failedDetachments.add(evaluationMount);

    await expect(
      importGptkRuntime(
        createHost(state),
        "outer.dmg",
        path.join(await createTemporaryDirectory(), "4.0b2")
      )
    ).rejects.toMatchObject({ code: "detach-failed" });
    expect(detachTargets(state)).toEqual([evaluationMount, outerMount]);
  });

  it("detaches by device when successful attach output has no mount point", async () => {
    const state = createCommandState();
    state.mounts.set("malformed.dmg", { device: "/dev/disk42" });

    await expect(
      importGptkRuntime(
        createHost(state),
        "malformed.dmg",
        path.join(await createTemporaryDirectory(), "4.0b2")
      )
    ).rejects.toMatchObject({ code: "attach-output-invalid" });
    expect(detachTargets(state)).toEqual(["/dev/disk42"]);
  });
});

describe("candidate and chooser callbacks", () => {
  it("tries automatic candidates in order and does not open the chooser after success", async () => {
    const evaluationMount = await createTemporaryDirectory();
    await createEvaluationRoot(evaluationMount);
    const state = createCommandState();
    state.mounts.set("automatic.dmg", { mountPoint: evaluationMount });
    const callbackOrder: string[] = [];
    let chooserCalled = false;

    const result = await importGptkRuntimeFromCandidates(createHost(state), {
      destination: path.join(await createTemporaryDirectory(), "4.0b2"),
      automaticCandidates: [
        async () => {
          callbackOrder.push("first");
          return "missing.dmg";
        },
        async () => {
          callbackOrder.push("second");
          return "automatic.dmg";
        },
        async () => {
          callbackOrder.push("third");
          return "unused.dmg";
        },
      ],
      chooseFile: async () => {
        chooserCalled = true;
        return null;
      },
    });

    expect(result.status).toBe("imported");
    expect(callbackOrder).toEqual(["first", "second"]);
    expect(chooserCalled).toBe(false);
  });

  it("falls back to the caller chooser and reports caller cancellation", async () => {
    const evaluationMount = await createTemporaryDirectory();
    await createEvaluationRoot(evaluationMount);
    const state = createCommandState();
    state.mounts.set("chosen.dmg", { mountPoint: evaluationMount });

    const imported = await importGptkRuntimeFromCandidates(createHost(state), {
      destination: path.join(await createTemporaryDirectory(), "4.0b2"),
      automaticCandidates: [async () => null],
      chooseFile: async () => "chosen.dmg",
    });
    expect(imported.status).toBe("imported");

    const cancelledState = createCommandState();
    const cancelled = await importGptkRuntimeFromCandidates(
      createHost(cancelledState),
      {
        destination: path.join(await createTemporaryDirectory(), "4.0b2"),
        automaticCandidates: [async () => "missing.dmg"],
        chooseFile: async () => null,
      }
    );
    expect(cancelled.status).toBe("cancelled");
    if (cancelled.status === "cancelled") {
      expect(cancelled.errors).toHaveLength(1);
    }
    expect(detachTargets(cancelledState)).toEqual([]);
  });
});

import { join } from "path-browserify";
import { cp, mkdirp, resolve } from "@utils";

export async function installSteamSupport(prefix: string) {
  const system32Dir = join(prefix, "drive_c", "windows", "system32");
  const syswow64Dir = join(prefix, "drive_c", "windows", "syswow64");
  await mkdirp(system32Dir);
  await mkdirp(syswow64Dir);

  await cp(
    resolve("./sidecar/protonextras/steam64.exe"),
    join(system32Dir, "steam.exe")
  );
  await cp(
    resolve("./sidecar/protonextras/steam32.exe"),
    join(syswow64Dir, "steam.exe")
  );
  await cp(
    resolve("./sidecar/protonextras/lsteamclient64.dll"),
    join(system32Dir, "lsteamclient.dll")
  );
  await cp(
    resolve("./sidecar/protonextras/lsteamclient32.dll"),
    join(syswow64Dir, "lsteamclient.dll")
  );
}

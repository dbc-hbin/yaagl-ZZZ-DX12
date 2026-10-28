# Yet another anime game launcher (Yaagl)

## Current Supported Game Version:
### GI: 5.3.0+ OS/CN **
### HSR: 4.3.0+ OS/CN
### ZZZ: 3.0.0+ OS/CN

#### **: Starting from release 0.3.12 using DXMT 0.74, you need to update to Sequoia or later. Sonoma is getting old and is lacking technical features to improve the translation.

## For Linux users
[Anime Games Launcher](https://github.com/an-anime-team/anime-games-launcher) is a universal linux launcher for anime games

<!-- ## Policy

Please don't link to this repository. If you really want to share it with people, just tell the project name __Yaagl__ and where to find (Github!) but __don't share/disclose the link__ unless it's a private message.

Do __not__ provide any forms of tutorial for _how to use Yaagl_ on public channels. (If you really want to do that, ask the project owner for permission first.)

Do __not__ mention the real name of the game or the game company, in code commits, issues, pr or dicussions. Use _The Anime Game_ or _The Anime Company_ instead.

Just follow these, or share and ruin this project for all other macOS (including Linux as well) players. -->

<!-- ### Hall of Shame

This is a list of people/organization violating Yaagl policies -->

## Is it safe?

Use it at your own risk. Or enjoying it with a new f2p account.

## Support

[Our Discord server](https://discord.gg/HrV52MgSC2) is the **ONLY** place providing support if you have any issue just using this application.

**DON'T FILE AN ISSUE** unless it's a technical problem coming with a clear root cause.

> Simply put _My game doesn't launch_ or _I can't login_ without telling any technical detail is not acceptable, please go to the Discord server instead of abusing Github Issues

**DON'T ASK FOR SUPPORT IN OTHER COMMUNITY**, especially the official one.

## Install

- Go to [Release](https://github.com/3Shain/yet-another-anime-game-launcher/releases/latest) and download the latest version.

- Uncompress and copy the resulting application to your `/Applications` folder. (Do not open the application from Downloads folder).

- Also make sure your game files aren't stored inside `/Applications`, use something inside your home folder instead, e.g `Games/GI`.
<!--
## Development (Outdated)

### Setup
```sh
git clone https://github.com/3Shain/yet-another-anime-game-launcher
cd yet-another-anime-game-launcher
pnpm install
./configure.sh
pnpm exec neu update
```


### Run
```sh
# CN
pnpm start
# Oversea
pnpm run start-hk4eos
```

### Build
```sh
node ./build-app.js
``` -->

## Experimental bundled D3DMetal runtime

The Wine menu entry **Wine 11.20 D3DMetal Async + Game Mode + Reflex**
installs the complete macOS 26 runtime directly from the
[pinned Wine release](https://github.com/dbc-hbin/wine-yaagl-d3dmetal/releases/tag/wine-11.20-gptk4.0b3-2).
It includes the signed D3DMetal framework, stock graphics, native FSR and
dependencies; no GPTK DMG selection, separate GPTK download or native preparation
helper is required.

Before installation, the launcher downloads and verifies `License.rtf` from the
same release and requires explicit acceptance of Apple's license. It checks the
archive's exact size and SHA-256, extracts its `wine/` root into a staging
directory, and verifies the bundled framework's code signature before replacing
the active runtime and prefix. Download, extraction or signature failures leave
the active runtime and prefix untouched and clean up temporary installation files.

## ZZZ Game Mode (opt-in)

ZZZ settings include **macOS Game Mode** directly below DX12. It defaults to off
and requests support on the next launch, not an immediate system toggle. It
requires Apple Silicon, macOS 26 or later, and an installed runtime whose
`yaagl-d3dmetal-runtime.json` advertises the version-3 ZZZ Game Mode capability:
`{ "version": 3, "target": "zzz", "supervisor": "libexec/yaagl-game-mode/game-policy-supervisor", "host": "libexec/yaagl-game-mode/ZZZ.app/Contents/MacOS/wine" }`.
Both paths must identify regular files in the selected runtime. Older or unknown
capabilities are rejected. Runtime selection and installation are unchanged.

For an opted-in game launch, the launcher passes the absolute Unix game EXE path
as `YAAGL_GAME_MODE_TARGET` in the existing Wine command environment. Wine compares
the resolved executable's file identity, not its basename or command line, to
select the bundled `ZZZ.app` host only for that game image. The host carries native
game-app identity and is an internal Wine executable, not a Finder or `open`
launch target. Setup commands retain the ordinary Wine path.

Policy remains outside Wine: the bundled supervisor runs the normal Wine command
and uses the bundled, Apple-signed `gamepolicyctl` to request a system-wide Game
Mode lease for that Wine session. It waits for the command and then for the
session's Wine server to exit, so other processes in the same Wine session can
extend the lease after ZZZ exits. The previous global policy is restored after
the last overlapping supervised session ends. An end-user Xcode installation is
not required.

This option does not enter fullscreen automatically. Native host selection,
gameplay, and policy effectiveness have not been runtime-validated for this
integration; the capability and policy request do not establish those outcomes.

Policy acquisition failures are logged to the game log and do not prevent the
game from starting. Launch failures are surfaced after game cleanup. An intentional
Wine server close is not reported as a launch failure; the next launch clears
that state so later failures remain visible. Turning
the preference off restores ordinary launches without forcing system Game Mode
off; setup commands and other games retain the ordinary Wine path.

## ZZZ Low Latency Mode (opt-in)

ZZZ's Game settings include a separate **Low Latency Mode** checkbox, off by
default. On the next launch, a supported D3DMetal Wine runtime limits queued GPU
frames to 2 without requiring the game to call Reflex Sleep. This may reduce FPS.
The preference persists independently of macOS Game Mode.

The launcher passes `YAAGL_D3DMETAL_LOW_LATENCY=force` when enabled with D3DMetal,
and `0` when disabled or using another backend, overriding inherited settings.
This option does not install or replace Wine; it requires a runtime implementing
that environment-variable contract.

## Uninstall (completely)
1. Drag app to the bin
2. Open Terminal and run:
   ```sh
   open ~/Library/Application\ Support/
   ```
   From there, locate and delete the `Yaagl` folder (or `Yaagl OS` if you are using overseas/global version). (For HSR and ZZZ the name of folder is slightly different)

## Related projects

* Custom `neutralinojs` binary from [3Shain/neutralinojs](https://github.com/3Shain/neutralinojs)
* [DXMT](https://github.com/3Shain/dxmt)
* Custom Wine from [anime-game-wine](https://github.com/yaagl/anime-game-wine)

## Special thanks
* An Anime Team
* Krock, the game running on macOS can not come true without his patch (you can find the link to his work in this repository, while you have to make a little effort ;) )

* mkrsym1, tackled IMO the most challenging AC component. It's a really remarkable and mind-blowing achievement.

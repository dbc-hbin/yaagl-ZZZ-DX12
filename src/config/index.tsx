import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  VStack,
  notificationService,
} from "@hope-ui/solid";
import { CURRENT_YAAGL_VERSION, YAAGL_ADVANCED_ENABLE } from "../constants";
import { Locale } from "../locale";
import { D3DMETAL_LAUNCH_ENVIRONMENT, Wine } from "../wine";
import { Config } from "./config-def";
import { createMetalHUDConfig } from "./metal-hud";
import { createGameInstallDirConfig } from "./game-install-dir";
import { createRetinaConfig } from "./retina";
import { createLeftCmdConfig } from "./left-cmd";
import { createWineDistroConfig } from "./wine-distribution";
import createLocaleConfig from "./ui-locale";
import createFPSUnlock from "./fps-unlock";
import { createD3DMetalGpuSpoofConfig } from "./d3dmetal-gpu-spoof";
import {
  exec2,
  getKeyOrDefault,
  mkdirp,
  readFile,
  resolve,
  setKey,
} from "../utils";
import { createSignal, JSXElement, onCleanup, onMount, Show } from "solid-js";
import createReShade from "./reshade";
import { createProxyEnabledConfig } from "@config/proxy-enabled";
import { createProxyHostConfig } from "@config/proxy-host";
import { join } from "path-browserify";
import {
  createD3DMetalDxrRuntimeStatus,
  createD3DMetalMetalFxRuntimeStatus,
  createD3DMetalMtl4RuntimeStatus,
  D3DMetalDxrRuntimeStatusDisplay,
  D3DMetalMetalFxRuntimeStatusDisplay,
  D3DMetalMtl4RuntimeStatusDisplay,
  findLatestD3DMetalEvidenceFile,
} from "../diagnostics/d3dmetal";

const DXR_STATUS_REFRESH_INTERVAL_MS = 5_000;

async function readLatestD3DMetalEvidence() {
  const logs = resolve("./logs");
  let entries: Neutralino.filesystem.DirectoryEntry[];
  try {
    entries = await Neutralino.filesystem.readDirectory(logs);
  } catch {
    return undefined;
  }
  const latest = findLatestD3DMetalEvidenceFile(entries);
  if (!latest) return undefined;
  try {
    return JSON.parse(await readFile(join(logs, latest)));
  } catch {
    return "unreadable";
  }
}

function D3DMetalDxrStatus() {
  const dxrConfigured = D3DMETAL_LAUNCH_ENVIRONMENT.D3DM_SUPPORT_DXR === "1";
  const [status, setStatus] = createSignal<D3DMetalDxrRuntimeStatusDisplay>(
    createD3DMetalDxrRuntimeStatus(dxrConfigured)
  );

  let mounted = true;
  let refreshInProgress = false;
  async function refresh() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    try {
      const evidence = await readLatestD3DMetalEvidence();
      if (mounted) {
        setStatus(createD3DMetalDxrRuntimeStatus(dxrConfigured, evidence));
      }
    } finally {
      refreshInProgress = false;
    }
  }

  onMount(() => {
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      DXR_STATUS_REFRESH_INTERVAL_MS
    );
    onCleanup(() => {
      mounted = false;
      window.clearInterval(interval);
    });
  });

  return <Text>DXR: {status().label}</Text>;
}

function D3DMetalMtl4Status() {
  const mtl4Configured = D3DMETAL_LAUNCH_ENVIRONMENT.D3DM_MTL4 === "1";
  const [status, setStatus] = createSignal<D3DMetalMtl4RuntimeStatusDisplay>(
    createD3DMetalMtl4RuntimeStatus(mtl4Configured)
  );

  let mounted = true;
  let refreshInProgress = false;
  async function refresh() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    try {
      const evidence = await readLatestD3DMetalEvidence();
      if (mounted) {
        setStatus(createD3DMetalMtl4RuntimeStatus(mtl4Configured, evidence));
      }
    } finally {
      refreshInProgress = false;
    }
  }

  onMount(() => {
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      DXR_STATUS_REFRESH_INTERVAL_MS
    );
    onCleanup(() => {
      mounted = false;
      window.clearInterval(interval);
    });
  });

  return <Text>Metal 4 backend: {status().label}</Text>;
}

function D3DMetalMetalFxStatus() {
  const metalFxConfigured =
    D3DMETAL_LAUNCH_ENVIRONMENT.D3DM_ENABLE_METALFX === "1";
  const [status, setStatus] = createSignal<D3DMetalMetalFxRuntimeStatusDisplay>(
    createD3DMetalMetalFxRuntimeStatus(metalFxConfigured)
  );

  let mounted = true;
  let refreshInProgress = false;
  async function refresh() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    try {
      const evidence = await readLatestD3DMetalEvidence();
      if (mounted) {
        setStatus(
          createD3DMetalMetalFxRuntimeStatus(metalFxConfigured, evidence)
        );
      }
    } finally {
      refreshInProgress = false;
    }
  }

  onMount(() => {
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      DXR_STATUS_REFRESH_INTERVAL_MS
    );
    onCleanup(() => {
      mounted = false;
      window.clearInterval(interval);
    });
  });

  return <Text>DLSS → MetalFX: {status().label}</Text>;
}

export async function createConfiguration({
  wine,
  locale,
  gameInstallDir,
  configForChannelClient,
  onCheckUpdate,
}: {
  wine: Wine;
  locale: Locale;
  gameInstallDir: () => string;
  configForChannelClient: (
    locale: Locale,
    config: Partial<Config>
  ) => Promise<() => JSXElement>;
  onCheckUpdate: () => void;
}) {
  const isZzzDx12 = import.meta.env["YAAGL_CHANNEL_CLIENT"] === "naposdx12";
  const config: Partial<Config> = {};
  const [WD] = await createWineDistroConfig({
    locale,
    config,
  });
  const [MH] = await createMetalHUDConfig({ locale, config });
  const [GPU] = await createD3DMetalGpuSpoofConfig({ config });
  const [R] = await createRetinaConfig({ locale, config });
  const [LC] = await createLeftCmdConfig({ locale, config });
  const [GID] = await createGameInstallDirConfig({
    locale,
    config,
    gameInstallDir,
  });

  const [UL] = await createLocaleConfig({ locale, config });
  const [FO] = await createFPSUnlock({ locale, config });
  const [RS] = await createReShade({ locale, config });

  const [PRE] = await createProxyEnabledConfig({ locale, config });
  const [PRH] = await createProxyHostConfig({ locale, config });

  const ChannelClientConfig = await configForChannelClient(locale, config);

  const _advancedSetting =
    YAAGL_ADVANCED_ENABLE &&
    (await getKeyOrDefault("config_advanced", "false")) == "true";

  const [advanceSetting, setAdvancedSetting] = createSignal(_advancedSetting);

  const clickTimestamp: number[] = [];
  async function onClickVersion() {
    if (!YAAGL_ADVANCED_ENABLE) {
      return;
    }
    clickTimestamp.push(Date.now());
    if (clickTimestamp.length > 5) {
      if (
        clickTimestamp[clickTimestamp.length - 1] -
          clickTimestamp[clickTimestamp.length - 5] <
        1000
      ) {
        if (!advanceSetting()) {
          notificationService.show({
            status: "info",
            title: locale.get("SETTING_ADVANCED_VISIBLE"),
            description: "",
          });
        }
        setAdvancedSetting(x => !x);
        clickTimestamp.length = 0;
        await setKey("config_advanced", String(advanceSetting()));
      }
    }
  }

  return {
    UI: function (props: {
      onClose: (action: "check-integrity" | "close") => void;
    }) {
      return (
        <ModalContent height={570} width={1000} maxWidth={1000}>
          <ModalCloseButton />
          <ModalHeader>{locale.get("SETTING")}</ModalHeader>
          <ModalBody pb={20}>
            <Tabs orientation="vertical" h="100%">
              <TabList minW={120}>
                <Tab>{locale.get("SETTING_GENERAL")}</Tab>
                <Tab>{locale.get("SETTING_GAME")}</Tab>
                <Tab>Wine</Tab>
                <Show when={advanceSetting()}>
                  <Tab>{locale.get("SETTING_ADVANCED")}</Tab>
                </Show>
                <Tab>{locale.get("SETTING_LICENSES")}</Tab>
              </TabList>
              <TabPanel flex={1} pt={0} pb={0}>
                <HStack spacing={"$4"} h="100%">
                  <Box
                    width="40%"
                    alignSelf="stretch"
                    overflowY="scroll"
                    pr={16}
                  >
                    <VStack spacing={"$4"}>
                      <GID />
                      <Divider />
                      <MH />
                      <R />
                      <LC />
                      <Divider />
                      <PRE />
                      <PRH />
                      <Text userSelect={"none"} size="xs">
                        {locale.get("SETTING_PROXY_DESC")}
                      </Text>
                      <Divider />
                      <UL />
                      <FormControl>
                        <FormLabel>
                          {locale.get("SETTING_YAAGL_VERSION")}
                        </FormLabel>
                        <Text userSelect={"none"} onClick={onClickVersion}>
                          {CURRENT_YAAGL_VERSION}
                        </Text>
                      </FormControl>
                    </VStack>
                  </Box>
                  <Box flex={1} />
                  <VStack
                    spacing={"$1"}
                    width="30%"
                    alignItems="start"
                    alignSelf="start"
                  >
                    <Heading level="1" ml={12} mb={"$4"}>
                      {locale.get("SETTING_QUICK_ACTIONS")}
                    </Heading>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onClose("check-integrity")}
                    >
                      {locale.get("SETTING_CHECK_INTEGRITY")}
                    </Button>
                    <Divider />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        wine.openCmdWindow({
                          gameDir: gameInstallDir(),
                        })
                      }
                    >
                      {locale.get("SETTING_OPEN_CMD")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        exec2(
                          ["open", gameInstallDir()],
                          {},
                          false,
                          "/dev/null"
                        )
                      }
                    >
                      {locale.get("SETTING_OPEN_GAME_INSTALL_DIR")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () =>
                        await exec2(
                          ["open", resolve("./")],
                          {},
                          false,
                          "/dev/null"
                        )
                      }
                    >
                      {locale.get("SETTING_OPEN_YAAGL_DIR")}
                    </Button>
                    <Divider />
                    <Show when={!isZzzDx12}>
                      <Button variant="ghost" size="sm" onClick={onCheckUpdate}>
                        {locale.get("SETTING_CHECK_UPDATE")}
                      </Button>
                    </Show>
                  </VStack>
                </HStack>
              </TabPanel>
              <TabPanel flex={1} pt={0} pb={0} h="100%">
                <VStack spacing={"$4"} w="40%" alignItems="start">
                  <ChannelClientConfig />
                </VStack>
              </TabPanel>
              <TabPanel flex={1} pt={0} pb={0} h="100%">
                <Show
                  when={isZzzDx12}
                  fallback={
                    <VStack spacing={"$4"} w="40%" alignItems="start">
                      <WD />
                    </VStack>
                  }
                >
                  <VStack spacing={"$4"} w="65%" alignItems="start">
                    <Heading>ZZZ DX12 runtime</Heading>
                    <Text>Wine: 11.0-1-crossover-signed-experimental</Text>
                    <Text>D3DMetal: 4.0b2</Text>
                    <D3DMetalMtl4Status />
                    <Text>Direct3D 12: controlled by the per-game option</Text>
                    <GPU />
                    <D3DMetalMetalFxStatus />
                    <D3DMetalDxrStatus />
                    <Text>Steam stub + timeout fix: enabled</Text>
                    <Button
                      size="sm"
                      onClick={async () => {
                        const logs = resolve("./logs");
                        await mkdirp(logs);
                        await exec2(["open", logs], {}, false, "/dev/null");
                      }}
                    >
                      Open D3DMetal logs
                    </Button>
                  </VStack>
                </Show>
              </TabPanel>
              <Show when={advanceSetting()}>
                <TabPanel flex={1} pt={0} pb={0} h="100%">
                  <VStack spacing={"$4"} w="40%" alignItems="start">
                    <Alert status="warning" variant="left-accent">
                      <AlertIcon mr="$2_5" />
                      {locale.get("SETTING_ADVANCED_ALERT")}
                    </Alert>
                    <FO />
                    <Show when={!isZzzDx12}>
                      <RS />
                    </Show>
                  </VStack>
                </TabPanel>
              </Show>
              <TabPanel flex={1} pt={0} pb={0} h="100%">
                <VStack spacing={"$4"} w="100%" alignItems="start">
                  <Heading>
                    Copyright Notice: steam.exe and lsteamclient.dll (in the
                    sidecar folder)
                  </Heading>
                  <Text>
                    Copyright (c) 2015, 2019, 2020, 2021, 2022 Valve Corporation
                  </Text>
                  <Text>All rights reserved.</Text>
                  <Text>
                    Redistribution and use in source and binary forms, with or
                    without modification, are permitted provided that the
                    following conditions are met:
                  </Text>

                  <Text>
                    1. Redistributions of source code must retain the above
                    copyright notice, this list of conditions and the following
                    disclaimer.
                  </Text>

                  <Text>
                    2. Redistributions in binary form must reproduce the above
                    copyright notice, this list of conditions and the following
                    disclaimer in the documentation and/or other materials
                    provided with the distribution.
                  </Text>

                  <Text>
                    3. Neither the name of the copyright holder nor the names of
                    its contributors may be used to endorse or promote products
                    derived from this software without specific prior written
                    permission.
                  </Text>

                  <Text>
                    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND
                    CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
                    INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
                    MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
                    DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
                    CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
                    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
                    NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
                    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
                    HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
                    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
                    OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
                    SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                  </Text>
                </VStack>
              </TabPanel>
            </Tabs>
          </ModalBody>
        </ModalContent>
      );
    },
    config: config as Config, // FIXME: better method than type assertation?
  };
}

export type { Config };

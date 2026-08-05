import { Box, Checkbox, FormControl, FormLabel, Text } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";

declare module "@config/config-def" {
  interface Config {
    forceDirect3D12: boolean;
  }
}

const CONFIG_KEY = "config_nap_force_direct3d12";

export default async function createDirect3D12Config({
  config,
}: {
  config: Partial<Config>;
}) {
  try {
    config.forceDirect3D12 = (await getKey(CONFIG_KEY)) === "true";
  } catch {
    config.forceDirect3D12 = false;
  }

  const [value, setValue] = createSignal(config.forceDirect3D12);

  async function onSave(apply: boolean) {
    assertValueDefined(config.forceDirect3D12);
    if (!apply) {
      setValue(config.forceDirect3D12);
      return NOOP;
    }
    if (config.forceDirect3D12 === value()) return NOOP;
    config.forceDirect3D12 = value();
    await setKey(CONFIG_KEY, config.forceDirect3D12 ? "true" : "false");
    return NOOP;
  }

  createEffect(() => {
    value();
    void onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl id="forceDirect3D12">
          <FormLabel>Graphics API</FormLabel>
          <Box>
            <Checkbox
              checked={value()}
              size="md"
              onChange={() => setValue(enabled => !enabled)}
            >
              Launch with Direct3D 12
            </Checkbox>
          </Box>
          <Text size="xs">
            Adds -use-d3d12 to Zenless Zone Zero only. Wine runtimes and other
            games are not modified.
          </Text>
        </FormControl>
      );
    },
  ] as const;
}

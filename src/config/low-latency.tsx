import { Box, Checkbox, FormControl, FormLabel, Text } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import type { Locale } from "@locale";
import type { Config } from "./config-def";
import type { Wine } from "@wine";
import { getKeyOrDefault, setKey } from "@utils";

declare module "@config/config-def" {
  interface Config {
    lowLatency: boolean;
  }
}

const CONFIG_KEY = "config_zzz_low_latency";

export async function createLowLatency({
  locale,
  config,
  wine,
}: {
  locale: Locale;
  config: Partial<Config>;
  wine: Wine;
}) {
  config.lowLatency = (await getKeyOrDefault(CONFIG_KEY, "false")) === "true";
  const [value, setValue] = createSignal(config.lowLatency);

  createEffect(() => {
    const requested = value();
    if (config.lowLatency === requested) return;
    config.lowLatency = requested;
    void setKey(CONFIG_KEY, String(requested));
  });

  return [
    function UI() {
      return (
        <FormControl id="low-latency">
          <FormLabel>{locale.get("SETTING_LOW_LATENCY")}</FormLabel>
          <Box>
            <Checkbox
              checked={value()}
              disabled={
                wine.attributes.renderBackend !== "d3dmetal" && !value()
              }
              onChange={() => setValue(x => !x)}
              size="md"
              aria-describedby="low-latency-description"
            >
              {locale.get("SETTING_LOW_LATENCY_ENABLE")}
            </Checkbox>
          </Box>
          <Text id="low-latency-description" fontSize="$sm" color="$neutral11">
            {locale.get("SETTING_LOW_LATENCY_DESC")}
          </Text>
        </FormControl>
      );
    },
  ] as const;
}

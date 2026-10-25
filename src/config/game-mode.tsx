import { Box, Checkbox, FormControl, FormLabel, Text } from "@hope-ui/solid";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import type { Locale } from "@locale";
import type { Config } from "./config-def";
import { getKeyOrDefault, setKey } from "@utils";
import { preflightGameMode } from "../wine/game-mode";

declare module "@config/config-def" {
  interface Config {
    gameMode: boolean;
  }
}

const CONFIG_KEY = "config_zzz_game_mode";

export async function createGameMode({
  locale,
  config,
}: {
  locale: Locale;
  config: Partial<Config>;
}) {
  config.gameMode = (await getKeyOrDefault(CONFIG_KEY, "false")) === "true";
  const [value, setValue] = createSignal(config.gameMode);
  const [available, setAvailable] = createSignal(false);

  createEffect(() => {
    const requested = value();
    if (config.gameMode === requested) return;
    config.gameMode = requested;
    void setKey(CONFIG_KEY, String(requested));
  });

  return [
    function UI() {
      onMount(async () => {
        try {
          await preflightGameMode();
          setAvailable(true);
        } catch {
          setAvailable(false);
        }
      });
      return (
        <FormControl id="game-mode">
          <FormLabel>{locale.get("SETTING_GAME_MODE")}</FormLabel>
          <Box>
            <Checkbox
              checked={value()}
              disabled={!available() && !value()}
              onChange={() => setValue(x => !x)}
              size="md"
              aria-describedby="game-mode-description game-mode-unavailable"
            >
              {locale.get("SETTING_GAME_MODE_REQUEST")}
            </Checkbox>
          </Box>
          <Text id="game-mode-description" fontSize="$sm" color="$neutral11">
            {locale.get("SETTING_GAME_MODE_DESC")}
          </Text>
          <Show when={!available()}>
            <Text id="game-mode-unavailable" fontSize="$sm" color="$neutral11">
              {locale.get("SETTING_GAME_MODE_UNAVAILABLE")}
            </Text>
          </Show>
        </FormControl>
      );
    },
  ] as const;
}

import {
  FormControl,
  FormLabel,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectPlaceholder,
  SelectTrigger,
  SelectValue,
} from "@hope-ui/solid";
import { createEffect, createSignal, For } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";
import {
  D3DMETAL_DEFAULT_ZZZ_GPU_SPOOF,
  D3DMETAL_ZZZ_GPU_SPOOFS,
  D3DMetalZzzGpuSpoof,
} from "../../../../wine/d3dmetal";

declare module "@config/config-def" {
  interface Config {
    d3dMetalGpuSpoof: D3DMetalZzzGpuSpoof;
  }
}

const CONFIG_KEY = "config_zzz_d3dmetal_gpu_spoof";

export default async function ({
  locale,
  config,
}: {
  locale: Locale;
  config: Partial<Config>;
}) {
  try {
    const stored = await getKey(CONFIG_KEY);
    config.d3dMetalGpuSpoof =
      stored in D3DMETAL_ZZZ_GPU_SPOOFS
        ? (stored as D3DMetalZzzGpuSpoof)
        : D3DMETAL_DEFAULT_ZZZ_GPU_SPOOF;
  } catch {
    config.d3dMetalGpuSpoof = D3DMETAL_DEFAULT_ZZZ_GPU_SPOOF;
  }

  const [value, setValue] = createSignal(config.d3dMetalGpuSpoof);
  async function onSave(apply: boolean) {
    assertValueDefined(config.d3dMetalGpuSpoof);
    if (!apply) {
      setValue(config.d3dMetalGpuSpoof);
      return NOOP;
    }
    if (config.d3dMetalGpuSpoof === value()) return NOOP;
    config.d3dMetalGpuSpoof = value();
    await setKey(CONFIG_KEY, config.d3dMetalGpuSpoof);
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl>
          <FormLabel>{locale.get("SETTING_D3DMETAL_GPU_SPOOF")}</FormLabel>
          <Select value={value()} onChange={setValue}>
            <SelectTrigger>
              <SelectPlaceholder>GPU</SelectPlaceholder>
              <SelectValue />
              <SelectIcon />
            </SelectTrigger>
            <SelectContent>
              <SelectListbox>
                <For
                  each={(
                    Object.entries(D3DMETAL_ZZZ_GPU_SPOOFS) as [
                      D3DMetalZzzGpuSpoof,
                      (typeof D3DMETAL_ZZZ_GPU_SPOOFS)[D3DMetalZzzGpuSpoof]
                    ][]
                  ).map(([id, gpu]) => ({
                    id,
                    label: `${gpu.description} (${gpu.deviceId
                      .replace("0x", "")
                      .toUpperCase()})`,
                  }))}
                >
                  {item => (
                    <SelectOption value={item.id}>
                      <SelectOptionText>{item.label}</SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                  )}
                </For>
              </SelectListbox>
            </SelectContent>
          </Select>
        </FormControl>
      );
    },
  ] as const;
}

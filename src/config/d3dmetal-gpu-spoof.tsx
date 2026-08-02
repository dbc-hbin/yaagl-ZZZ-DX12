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
  Text,
} from "@hope-ui/solid";
import { createEffect, createSignal, For } from "solid-js";
import { assertValueDefined, getKey, setKey } from "@utils";
import {
  DEFAULT_ZZZ_D3DMETAL_GPU_SPOOF,
  resolveZzzD3DMetalGpuSpoof,
  ZZZ_D3DMETAL_GPU_SPOOFS,
  ZzzD3DMetalGpuSpoof,
} from "../wine/d3dmetal";
import { Config, NOOP } from "./config-def";

declare module "./config-def" {
  interface Config {
    d3dMetalGpuSpoof: ZzzD3DMetalGpuSpoof;
  }
}

const CONFIG_KEY = "config_zzz_d3dmetal_gpu_spoof";

export async function createD3DMetalGpuSpoofConfig({
  config,
}: {
  config: Partial<Config>;
}) {
  try {
    config.d3dMetalGpuSpoof = resolveZzzD3DMetalGpuSpoof(
      await getKey(CONFIG_KEY)
    );
  } catch {
    config.d3dMetalGpuSpoof = DEFAULT_ZZZ_D3DMETAL_GPU_SPOOF;
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
    void onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl id="d3dmetalGpuSpoof">
          <FormLabel>ZZZ GPU profile</FormLabel>
          <Select value={value()} onChange={setValue}>
            <SelectTrigger>
              <SelectPlaceholder>Choose an NVIDIA profile</SelectPlaceholder>
              <SelectValue />
              <SelectIcon />
            </SelectTrigger>
            <SelectContent>
              <SelectListbox>
                <For each={Object.values(ZZZ_D3DMETAL_GPU_SPOOFS)}>
                  {profile => (
                    <SelectOption value={profile.id}>
                      <SelectOptionText>
                        {profile.label} ({profile.vendorId}:{profile.deviceId})
                      </SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                  )}
                </For>
              </SelectListbox>
            </SelectContent>
          </Select>
          <Text size="xs">
            Changes the DXGI identity seen by ZZZ; Metal execution stays on this
            Mac.
          </Text>
        </FormControl>
      );
    },
  ] as const;
}

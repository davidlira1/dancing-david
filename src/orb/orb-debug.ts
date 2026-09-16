import type { EnergyOrb } from "./energy-orb.ts";
import type { EnergyOrbConfig } from "./orb-config.ts";

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

export function formatOrbDebug(
  orb: EnergyOrb,
  displayRadius: number | null,
): string {
  return (
    `Orb State: ${orb.state}\n` +
    `Palm Distance: ${fmt(orb.palmDistance)}\n` +
    `Orb X ${fmt(orb.x, 3)}  Y ${fmt(orb.y, 3)}  depth ${fmt(orb.depth, 3)}\n` +
    `Radius interact ${fmt(orb.interactionRadius, 1)}  ` +
    `display ${fmt(displayRadius, 1)}\n` +
    `Charge ${fmt(orb.charge)}  fade ${fmt(orb.fade)}  ` +
    `dwell ${fmt(orb.dwellProgress)}`
  );
}

type SliderSpec = {
  key: keyof EnergyOrbConfig;
  suffix: string;
  digits: number;
};

const SLIDERS: SliderSpec[] = [
  { key: "activateDistance", suffix: "", digits: 2 },
  { key: "minRadius", suffix: " px", digits: 0 },
  { key: "maxRadius", suffix: " px", digits: 0 },
  { key: "depthStrength", suffix: "", digits: 2 },
  { key: "intensity", suffix: "", digits: 2 },
  { key: "bloomStrength", suffix: "", digits: 2 },
];

export function createOrbControls(options: {
  config: EnergyOrbConfig;
  onChange?: () => void;
}): { syncFromConfig: () => void; updateReadout: (text: string) => void } {
  const { config, onChange } = options;
  const readout = document.querySelector<HTMLElement>("#orb-debug");

  function syncFromConfig(): void {
    for (const spec of SLIDERS) {
      const input = document.querySelector<HTMLInputElement>(`#orb-${spec.key}`);
      const valueEl = document.querySelector<HTMLElement>(
        `#orb-${spec.key}-value`,
      );
      const value = config[spec.key];
      if (!input || !valueEl) {
        continue;
      }
      input.value = String(value);
      valueEl.textContent = `${value.toFixed(spec.digits)}${spec.suffix}`;
    }
  }

  for (const spec of SLIDERS) {
    const input = document.querySelector<HTMLInputElement>(`#orb-${spec.key}`);
    const valueEl = document.querySelector<HTMLElement>(
      `#orb-${spec.key}-value`,
    );
    input?.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        return;
      }
      config[spec.key] = value;
      if (valueEl) {
        valueEl.textContent = `${value.toFixed(spec.digits)}${spec.suffix}`;
      }
      onChange?.();
    });
  }

  syncFromConfig();

  return {
    syncFromConfig,
    updateReadout(text: string): void {
      if (readout) {
        readout.textContent = text;
      }
    },
  };
}

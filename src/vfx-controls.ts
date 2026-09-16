import { formatDepthDebug, type DepthSnapshot } from "./depth.ts";
import { ribbonPerspectiveFromTracked } from "./webgl/projection.ts";
import {
  applySchemeToVfx,
  assignRibbonVfxConfig,
  cloneRibbonVfxConfig,
  DEFAULT_RIBBON_VFX_CONFIG,
  RIBBON_SCHEMES,
  RIBBON_VFX_PRESETS,
  type RibbonVfxConfig,
} from "./webgl/visual.ts";

type SliderSpec = {
  key: keyof RibbonVfxConfig;
  suffix: string;
  digits: number;
};

const SLIDERS: SliderSpec[] = [
  { key: "ribbonWidth", suffix: " px", digits: 0 },
  { key: "tailWidthScale", suffix: "", digits: 2 },
  { key: "coreWidth", suffix: "", digits: 2 },
  { key: "edgeSoftness", suffix: "", digits: 2 },
  { key: "ribbonIntensity", suffix: "", digits: 2 },
  { key: "bloomRadius", suffix: "", digits: 1 },
  { key: "bloomIntensity", suffix: "", digits: 2 },
  { key: "trailDurationMs", suffix: " ms", digits: 0 },
  { key: "depthStrength", suffix: "", digits: 2 },
  { key: "perspectiveStrength", suffix: "", digits: 2 },
  { key: "minPerspectiveScale", suffix: "", digits: 2 },
  { key: "maxPerspectiveScale", suffix: "", digits: 2 },
  { key: "depthBloomStrength", suffix: "", digits: 2 },
  { key: "occlusionDepthBias", suffix: "", digits: 3 },
  { key: "occlusionSoftness", suffix: "", digits: 3 },
  { key: "segmentationThreshold", suffix: "", digits: 2 },
  { key: "bodyInfluenceRadius", suffix: "", digits: 2 },
  { key: "continuityGapMs", suffix: " ms", digits: 0 },
  { key: "continuityReacquirePx", suffix: " px", digits: 0 },
  { key: "minContinuityVisibility", suffix: "", digits: 2 },
  { key: "handCadence", suffix: "x", digits: 0 },
  { key: "handScaleDepthGain", suffix: "", digits: 2 },
  { key: "handLocalZGain", suffix: "", digits: 2 },
  { key: "minHandConfidence", suffix: "", digits: 2 },
];

const COLOR_KEYS = [
  "coreColor",
  "bodyColor",
  "edgeColor",
  "bloomColor",
] as const;

const CHECKBOX_KEYS = [
  "depthEnabled",
  "depthViz",
  "invertZ",
  "occlusionEnabled",
  "segmentationDebug",
  "bodyDepthDebug",
  "occlusionViz",
  "strokeDebug",
  "handsEnabled",
  "handNormalDebug",
  "swapHandedness",
] as const;

const DEPTH_METER_RANGE = 0.4;

function formatValue(spec: SliderSpec, value: number): string {
  return `${value.toFixed(spec.digits)}${spec.suffix}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createVfxControls(options: {
  config: RibbonVfxConfig;
  onChange: () => void;
  onRecalibrate: () => void;
}): {
  syncFromConfig: () => void;
  updateDepthMeter: (snapshot: DepthSnapshot, extra?: string) => void;
} {
  const { config, onChange, onRecalibrate } = options;
  const panel = document.querySelector<HTMLElement>("#ribbon-vfx")!;
  const toggle = document.querySelector<HTMLButtonElement>("#ribbon-vfx-toggle")!;
  const body = document.querySelector<HTMLElement>("#ribbon-vfx-body")!;
  const depthDebug = document.querySelector<HTMLElement>("#vfx-depth-debug");
  const depthMarker = document.querySelector<HTMLElement>("#vfx-depth-marker");

  function syncSchemeButtons(activeId: string | null): void {
    for (const scheme of RIBBON_SCHEMES) {
      const button = document.querySelector<HTMLButtonElement>(
        `#scheme-${scheme.id}`,
      );
      button?.setAttribute(
        "aria-pressed",
        scheme.id === activeId ? "true" : "false",
      );
    }
  }

  function emit(): void {
    onChange();
  }

  function syncFromConfig(): void {
    for (const spec of SLIDERS) {
      const input = document.querySelector<HTMLInputElement>(`#vfx-${spec.key}`);
      const readout = document.querySelector<HTMLElement>(
        `#vfx-${spec.key}-value`,
      );
      const value = config[spec.key];
      if (typeof value !== "number" || !input || !readout) {
        continue;
      }
      input.value = String(value);
      readout.textContent = formatValue(spec, value);
    }
    for (const key of COLOR_KEYS) {
      const input = document.querySelector<HTMLInputElement>(`#vfx-${key}`);
      if (input) {
        input.value = config[key].toLowerCase();
      }
    }
    for (const key of CHECKBOX_KEYS) {
      const input = document.querySelector<HTMLInputElement>(`#vfx-${key}`);
      if (input) {
        input.checked = config[key];
      }
    }
  }

  toggle.addEventListener("click", () => {
    const collapsed = body.hasAttribute("hidden");
    if (collapsed) {
      body.removeAttribute("hidden");
      toggle.textContent = "−";
      toggle.setAttribute("aria-expanded", "true");
      panel.classList.remove("collapsed");
    } else {
      body.setAttribute("hidden", "");
      toggle.textContent = "+";
      toggle.setAttribute("aria-expanded", "false");
      panel.classList.add("collapsed");
    }
  });

  for (const spec of SLIDERS) {
    const input = document.querySelector<HTMLInputElement>(`#vfx-${spec.key}`);
    const readout = document.querySelector<HTMLElement>(
      `#vfx-${spec.key}-value`,
    );
    input?.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        return;
      }
      (config[spec.key] as number) = value;
      if (readout) {
        readout.textContent = formatValue(spec, value);
      }
      emit();
    });
  }

  for (const key of COLOR_KEYS) {
    const input = document.querySelector<HTMLInputElement>(`#vfx-${key}`);
    input?.addEventListener("input", () => {
      config[key] = input.value;
      emit();
    });
  }

  for (const key of CHECKBOX_KEYS) {
    const input = document.querySelector<HTMLInputElement>(`#vfx-${key}`);
    input?.addEventListener("change", () => {
      config[key] = input.checked;
      emit();
    });
  }

  document
    .querySelector<HTMLButtonElement>("#vfx-recalibrate")
    ?.addEventListener("click", () => {
      onRecalibrate();
    });

  document
    .querySelector<HTMLButtonElement>("#vfx-reset")
    ?.addEventListener("click", () => {
      assignRibbonVfxConfig(config, DEFAULT_RIBBON_VFX_CONFIG);
      syncSchemeButtons("electric");
      syncFromConfig();
      emit();
    });

  const presetButtons: [string, keyof typeof RIBBON_VFX_PRESETS][] = [
    ["#vfx-preset-thin", "thin"],
    ["#vfx-preset-medium", "medium"],
    ["#vfx-preset-thick", "thick"],
  ];
  for (const [selector, id] of presetButtons) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener(
      "click",
      () => {
        assignRibbonVfxConfig(config, cloneRibbonVfxConfig(RIBBON_VFX_PRESETS[id]));
        syncFromConfig();
        emit();
      },
    );
  }

  for (const scheme of RIBBON_SCHEMES) {
    document
      .querySelector<HTMLButtonElement>(`#scheme-${scheme.id}`)
      ?.addEventListener("click", () => {
        applySchemeToVfx(config, scheme);
        syncSchemeButtons(scheme.id);
        syncFromConfig();
        emit();
      });
  }

  syncFromConfig();
  syncSchemeButtons("electric");

  return {
    syncFromConfig,
    updateDepthMeter(snapshot: DepthSnapshot, extra?: string): void {
      const { visualDepth, perspectiveScale } = ribbonPerspectiveFromTracked(
        snapshot.trackedDepth,
        config,
      );
      if (depthDebug) {
        depthDebug.textContent =
          formatDepthDebug({
            ...snapshot,
            visualDepth,
            perspectiveScale,
          }) + (extra ? `\n${extra}` : "");
      }
      if (depthMarker) {
        const t = snapshot.calibrating
          ? 0.5
          : clamp01(
              (snapshot.trackedDepth + DEPTH_METER_RANGE) /
                (DEPTH_METER_RANGE * 2),
            );
        depthMarker.style.left = `${t * 100}%`;
      }
    },
  };
}

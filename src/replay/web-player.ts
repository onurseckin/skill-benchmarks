import { createContentSecurityPolicyMeta } from "../shared/html-content-security.js";
import { escapeHtmlText, serializeEmbeddedJson } from "../shared/html-escape.js";
import { writeReplayExportAtomic } from "./replay-export.js";
import { webPlayerScript } from "./web-player-script.js";
import { webPlayerStyle } from "./web-player-style.js";
import { renderWebTelemetry } from "./web-player-telemetry.js";
import type { ReplaySession, WebPlayerOptions } from "./types.js";

const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const policyMarker = "<meta data-content-security-policy>";

export function generateWebReplayHtml(
  session: ReplaySession,
  options: WebPlayerOptions = {},
): string {
  if (session.frames.length === 0) throw new TypeError("Replay requires persisted frames");
  const metadata = session.metadata;
  const title = escapeHtmlText(options.title ?? `Replay: ${metadata.scenarioId}`);
  const telemetry = renderWebTelemetry(session.telemetrySeries);
  const content = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090b10">
<meta name="color-scheme" content="dark">
${policyMarker}
<title>${title}</title>
<style>${webPlayerStyle()}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to persisted replay evidence</a>
${renderHeader(session, title)}
<main class="replay-workspace" id="main-content">
<aside class="frame-navigation" aria-label="Persisted replay frames"><div class="field"><label for="frame-filter">Search persisted frames</label><input id="frame-filter" name="frame-filter" type="search" autocomplete="off" placeholder="Search frames…"></div><ol class="frame-list" id="frames"></ol></aside>
<section class="evidence-view" aria-label="Selected persisted frame"><div class="tabs" role="tablist" aria-label="Frame evidence views">${renderTabs()}</div><section class="card" id="frame-content" role="tabpanel" aria-labelledby="tab-overview"></section>${telemetry}</section>
</main>
${renderPlayback(session.frames.length)}
<script type="application/json" id="replay-data">${serializeEmbeddedJson(session)}</script>
<script>${webPlayerScript}</script>
</body>
</html>`;
  return content.replace(policyMarker, createContentSecurityPolicyMeta(content));
}

export function exportWebReplayHtml(
  session: ReplaySession,
  outputPath: string,
  options: WebPlayerOptions = {},
): void {
  writeReplayExportAtomic(outputPath, generateWebReplayHtml(session, options));
}

function renderHeader(session: ReplaySession, title: string): string {
  const metadata = session.metadata;
  const provenance = [
    metadata.providerId,
    metadata.executionMode,
    metadata.simulated === undefined
      ? undefined
      : metadata.simulated
        ? "simulated"
        : "non-simulated",
    session.provenance.benchmarkCohort,
    session.provenance.eligibilityStatus,
    session.provenance.evaluationStatus,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  const totals = [
    `Duration ${decimal.format(metadata.durationMs / 1000)} s`,
    `${integer.format(metadata.totalTurns)} turns`,
    metadata.totalTokens === undefined
      ? undefined
      : `${integer.format(metadata.totalTokens)} observed tokens`,
    `${integer.format(session.frames.length)} persisted frames`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  return `<header class="replay-header"><div><h1>${title}</h1><p>${escapeHtmlText(metadata.scenarioId)} · ${escapeHtmlText(metadata.skillIds.join(", "))} · ${escapeHtmlText(metadata.modelId)}</p>${provenance.length === 0 ? "" : `<p>${escapeHtmlText(provenance)}</p>`}<p>${escapeHtmlText(totals)}</p></div><span class="badge">${escapeHtmlText(metadata.executionStatus)}</span></header>`;
}

function renderTabs(): string {
  const tabs = [
    ["overview", "Overview"],
    ["tool", "Tool and command"],
    ["thinking", "Reasoning"],
    ["diff", "Diff"],
    ["telemetry", "Telemetry"],
  ] as const;
  return tabs
    .map(
      ([id, label], index) =>
        `<button id="tab-${id}" type="button" role="tab" aria-label="Show ${label.toLocaleLowerCase("en-US")} evidence" aria-controls="frame-content" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-tab="${id}">${label}</button>`,
    )
    .join("");
}

function renderPlayback(frameCount: number): string {
  return `<footer class="playback" aria-label="Replay playback controls"><button id="play" type="button" aria-label="Play persisted replay">Play</button><button id="previous" type="button" aria-label="Open previous persisted frame">Previous</button><div class="field seek-field"><label for="seek">Persisted frame position</label><input id="seek" name="seek" type="range" min="0" max="${frameCount - 1}" value="0"></div><button id="next" type="button" aria-label="Open next persisted frame">Next</button><span class="indicator" id="indicator" aria-live="polite"></span><div class="field speed-field"><label for="speed">Playback speed</label><select id="speed" name="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="5">5×</option></select></div></footer>`;
}

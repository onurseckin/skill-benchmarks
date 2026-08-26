import { readFileSync } from "node:fs";
import { generateHtmlDashboard } from "../../reporting/html-dashboard.js";
import type { ReportSnapshot } from "../../reporting/report-cohorts.js";
import { generateWebReplayHtml } from "../../replay/web-player.js";
import type { ReplaySession } from "../../replay/types.js";
import { requireCondition } from "./assertions.js";
import type { ServerDashboardFixture } from "./fixture.js";

interface HtmlFacts {
  mainCount: number;
  labelCount: number;
  controlCount: number;
  unlabeledControlCount: number;
  svgCount: number;
  titledSvgCount: number;
  describedSvgCount: number;
  tabCount: number;
  tabPanelCount: number;
  liveRegionCount: number;
  inlineEventCount: number;
}

export async function verifyHtmlSemantics(fixture: ServerDashboardFixture): Promise<void> {
  const report = readFileSync(fixture.reportPath, "utf8");
  const replay = readFileSync(fixture.replayPath, "utf8");
  const reportFacts = await collectFacts(report);
  const replayFacts = await collectFacts(replay);
  requireCondition(reportFacts.mainCount === 1, "report_main_invalid");
  requireCondition(
    report.includes('class="skip-link"') && report.includes('id="main-content"'),
    "report_skip_link_missing",
  );
  requireCondition(report.includes("NO ELIGIBLE BENCHMARK EVIDENCE"), "report_empty_state_missing");
  requireCondition(reportFacts.unlabeledControlCount === 0, "report_control_unlabeled");
  requireCondition(reportFacts.inlineEventCount === 0, "report_inline_event_present");
  requireCondition(replayFacts.mainCount === 1, "replay_main_invalid");
  requireCondition(replayFacts.unlabeledControlCount === 0, "replay_control_unlabeled");
  requireCondition(
    replayFacts.tabCount >= 5 && replayFacts.tabPanelCount === 1,
    "replay_tabs_invalid",
  );
  requireCondition(replayFacts.liveRegionCount >= 1, "replay_live_region_missing");
  requireCondition(replayFacts.inlineEventCount === 0, "replay_inline_event_present");
  requireCondition(
    replayFacts.svgCount === replayFacts.titledSvgCount &&
      replayFacts.svgCount === replayFacts.describedSvgCount,
    "replay_svg_semantics_invalid",
  );
  const unsafeAssignment = ["inner", "HTML"].join("");
  requireCondition(
    !report.includes(unsafeAssignment) && !replay.includes(unsafeAssignment),
    "html_assignment_present",
  );
  requireCondition(
    report.includes("Content-Security-Policy") && replay.includes("Content-Security-Policy"),
    "html_csp_missing",
  );
  requireCondition(!replay.includes("No telemetry data"), "replay_empty_telemetry_claim_present");
  requireCondition(
    report.includes("@media(max-width:560px)") && report.includes("overflow-x:auto"),
    "report_responsive_contract_missing",
  );
  requireCondition(
    replay.includes("@media(max-width:760px)") &&
      replay.includes("@media(max-width:420px)") &&
      replay.includes("100dvh"),
    "replay_responsive_contract_missing",
  );
  await verifyMaliciousTextConstruction(fixture);
}

async function verifyMaliciousTextConstruction(fixture: ServerDashboardFixture): Promise<void> {
  const bidirectionalControls =
    "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069";
  const payload = `</script><script>globalThis.reportPwned=1</script>\n"><img src=x onerror=globalThis.reportPwned=2>\n&quot; autofocus onfocus=globalThis.reportPwned=3 x="\njavascript:globalThis.reportPwned=4\n${"x".repeat(10_000)}${bidirectionalControls}`;
  const snapshot = JSON.parse(readFileSync(fixture.reportJsonPath, "utf8")) as ReportSnapshot;
  const session = JSON.parse(readFileSync(fixture.replayJsonPath, "utf8")) as ReplaySession;
  const firstFrame = session.frames[0];
  requireCondition(firstFrame !== undefined, "malicious_fixture_frame_missing");
  const maliciousSession: ReplaySession = {
    ...session,
    metadata: { ...session.metadata, scenarioId: payload },
    frames: [
      { ...firstFrame, summary: payload, payload: { value: payload } },
      ...session.frames.slice(1),
    ],
  };
  const report = generateHtmlDashboard(snapshot, { title: payload });
  const replay = generateWebReplayHtml(maliciousSession);
  await requireSafeMarkup(report, 0);
  await requireSafeMarkup(replay, 2);
  requireCondition(
    !report.includes("<img src=x") && !replay.includes("<img src=x"),
    "malicious_element_serialized",
  );
  requireCondition(
    !report.includes("</script><script>globalThis") &&
      !replay.includes("</script><script>globalThis"),
    "malicious_script_serialized",
  );
  requireCondition(
    !/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(report + replay),
    "bidi_control_active",
  );
}

async function requireSafeMarkup(html: string, expectedScripts: number): Promise<void> {
  let images = 0;
  let scripts = 0;
  let unsafeAttributes = 0;
  const rewriter = new HTMLRewriter()
    .on("img", {
      element: () => {
        images += 1;
      },
    })
    .on("script", {
      element: () => {
        scripts += 1;
      },
    })
    .on("*", {
      element: (element) => {
        for (const [name] of element.attributes) {
          const normalized = name.toLocaleLowerCase("en-US");
          if (normalized.startsWith("on") || normalized === "autofocus" || normalized === "srcdoc")
            unsafeAttributes += 1;
        }
      },
    });
  await rewriter.transform(new Response(html)).text();
  requireCondition(
    images === 0 && scripts === expectedScripts && unsafeAttributes === 0,
    "malicious_markup_escaped",
  );
}

async function collectFacts(html: string): Promise<HtmlFacts> {
  const facts: HtmlFacts = {
    mainCount: 0,
    labelCount: 0,
    controlCount: 0,
    unlabeledControlCount: 0,
    svgCount: 0,
    titledSvgCount: 0,
    describedSvgCount: 0,
    tabCount: 0,
    tabPanelCount: 0,
    liveRegionCount: 0,
    inlineEventCount: 0,
  };
  const labeledIds = new Set<string>();
  const controls: { readonly id?: string; readonly ariaLabel?: string }[] = [];
  let currentSvgHasTitle = false;
  let currentSvgHasDescription = false;
  const rewriter = new HTMLRewriter()
    .on("main", {
      element: () => {
        facts.mainCount += 1;
      },
    })
    .on("label", {
      element: (element) => {
        facts.labelCount += 1;
        const value = element.getAttribute("for");
        if (value) labeledIds.add(value);
      },
    })
    .on("input, select, button", {
      element: (element) => {
        facts.controlCount += 1;
        controls.push({
          id: element.getAttribute("id") ?? undefined,
          ariaLabel: element.getAttribute("aria-label") ?? undefined,
        });
        for (const attribute of element.attributes)
          if (attribute[0].toLowerCase().startsWith("on")) facts.inlineEventCount += 1;
      },
    })
    .on('[role="tab"]', {
      element: () => {
        facts.tabCount += 1;
      },
    })
    .on('[role="tabpanel"]', {
      element: () => {
        facts.tabPanelCount += 1;
      },
    })
    .on('[aria-live="polite"]', {
      element: () => {
        facts.liveRegionCount += 1;
      },
    })
    .on("svg", {
      element: () => {
        facts.svgCount += 1;
        currentSvgHasTitle = false;
        currentSvgHasDescription = false;
      },
    })
    .on("svg title", {
      element: () => {
        if (!currentSvgHasTitle) {
          facts.titledSvgCount += 1;
          currentSvgHasTitle = true;
        }
      },
    })
    .on("svg desc", {
      element: () => {
        if (!currentSvgHasDescription) {
          facts.describedSvgCount += 1;
          currentSvgHasDescription = true;
        }
      },
    });
  await rewriter.transform(new Response(html)).text();
  facts.unlabeledControlCount = controls.filter(
    (control) =>
      control.ariaLabel === undefined && (control.id === undefined || !labeledIds.has(control.id)),
  ).length;
  return facts;
}

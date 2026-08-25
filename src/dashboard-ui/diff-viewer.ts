import type {
  DiffLineModel,
  DiffViewModel,
  DiffViewMode,
  SideBySideDiffRow,
  ThemeTokens,
} from "./types.js";
import { escapeHtml } from "./components.js";

export function parseRawDiffToSideBySide(path: string, rawDiff: string, changeType = "modified"): DiffViewModel {
  const lines: DiffLineModel[] = [];
  const rows: SideBySideDiffRow[] = [];
  let insertions = 0;
  let deletions = 0;
  let oldLine = 1;
  let newLine = 1;

  const rawLines = rawDiff.split("\n");
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i] ?? "";
    if (line.startsWith("@@")) {
      const headerLine: DiffLineModel = { type: "header", content: line };
      lines.push(headerLine);
      rows.push({ type: "header", left: headerLine, right: headerLine });
      i += 1;
      continue;
    }

    if (line.startsWith("+")) {
      insertions += 1;
      const addModel: DiffLineModel = { type: "add", content: line.slice(1), newLineNumber: newLine++ };
      lines.push(addModel);
      rows.push({ type: "added", right: addModel });
      i += 1;
      continue;
    }

    if (line.startsWith("-")) {
      deletions += 1;
      const delModel: DiffLineModel = { type: "del", content: line.slice(1), oldLineNumber: oldLine++ };
      lines.push(delModel);

      const nextLine = rawLines[i + 1];
      if (nextLine && nextLine.startsWith("+")) {
        insertions += 1;
        const nextAdd: DiffLineModel = { type: "add", content: nextLine.slice(1), newLineNumber: newLine++ };
        lines.push(nextAdd);
        rows.push({ type: "modified", left: delModel, right: nextAdd });
        i += 2;
        continue;
      }

      rows.push({ type: "deleted", left: delModel });
      i += 1;
      continue;
    }

    const content = line.startsWith(" ") ? line.slice(1) : line;
    const ctxModel: DiffLineModel = { type: "ctx", content, oldLineNumber: oldLine++, newLineNumber: newLine++ };
    lines.push(ctxModel);
    rows.push({ type: "unchanged", left: ctxModel, right: ctxModel });
    i += 1;
  }

  return { path, changeType, insertions, deletions, lines, rows };
}

export function renderSideBySideDiffTable(diff: DiffViewModel, theme: ThemeTokens): string {
  const rows = diff.rows ?? [];
  const rowsHtml = rows
    .map((r) => {
      if (r.type === "header") {
        return `<tr style="background:#111111;color:#ffffff;border-bottom:1px solid #333333"><td colspan="4" style="padding:4px 10px;font-family:${theme.fontMono};font-size:11px;font-weight:700;letter-spacing:0.5px">${escapeHtml(r.left?.content ?? "")}</td></tr>`;
      }

      const left = r.left;
      const right = r.right;

      let leftBg = "#000000";
      let leftColor = "#888888";
      if (r.type === "deleted" || r.type === "modified") {
        leftBg = "#1a0808";
        leftColor = "#ff8888";
      }

      let rightBg = "#000000";
      let rightColor = "#ffffff";
      if (r.type === "added" || r.type === "modified") {
        rightBg = "#081a08";
        rightColor = "#88ff88";
      }

      const leftNum = left?.oldLineNumber !== undefined ? String(left.oldLineNumber) : "";
      const rightNum = right?.newLineNumber !== undefined ? String(right.newLineNumber) : "";
      const leftContent = left ? escapeHtml(left.content) : "";
      const rightContent = right ? escapeHtml(right.content) : "";

      return `<tr style="border-bottom:1px solid #1a1a1a"><td style="width:36px;text-align:right;padding:2px 6px;color:#555555;user-select:none;font-family:${theme.fontMono};font-size:11px;background:#050505;border-right:1px solid #222222">${leftNum}</td><td style="width:48%;padding:2px 8px;font-family:${theme.fontMono};font-size:11px;line-height:1.4;background:${leftBg};color:${leftColor};white-space:pre-wrap;word-break:break-all;border-right:2px solid #333333">${leftContent}</td><td style="width:36px;text-align:right;padding:2px 6px;color:#555555;user-select:none;font-family:${theme.fontMono};font-size:11px;background:#050505;border-right:1px solid #222222">${rightNum}</td><td style="width:48%;padding:2px 8px;font-family:${theme.fontMono};font-size:11px;line-height:1.4;background:${rightBg};color:${rightColor};white-space:pre-wrap;word-break:break-all">${rightContent}</td></tr>`;
    })
    .join("");

  return `<div style="display:flex;background:#0a0a0a;border-bottom:2px solid #ffffff;font-family:${theme.fontMono};font-size:11px;font-weight:900"><div style="flex:1;padding:6px 12px;border-right:2px solid #ffffff;color:#aaaaaa">BEFORE / BASELINE</div><div style="flex:1;padding:6px 12px;color:#ffffff">AFTER / AGENT MUTATION</div></div><div style="max-height:420px;overflow-y:auto;overflow-x:hidden"><table style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody>${rowsHtml.length > 0 ? rowsHtml : `<tr><td colspan="4" style="padding:24px;text-align:center;color:#666666">No changes recorded</td></tr>`}</tbody></table></div>`;
}

export function renderInteractiveDiffViewer(
  diff: DiffViewModel,
  mode: DiffViewMode,
  theme: ThemeTokens
): string {
  const isSplit = mode === "split";
  const bodyContent = isSplit
    ? renderSideBySideDiffTable(diff, theme)
    : renderUnifiedDiffList(diff, theme);

  return `<div class="diff-viewer-container" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff;overflow:hidden"><div style="background:#000000;padding:10px 16px;border-bottom:2px solid #ffffff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div style="display:flex;align-items:center;gap:12px"><span style="font-family:${theme.fontMono};font-weight:900;font-size:13px;color:#ffffff;text-transform:uppercase">FILE: ${escapeHtml(diff.path)}</span><span style="font-family:${theme.fontMono};font-size:11px;font-weight:700;border:1px solid #ffffff;padding:2px 6px;text-transform:uppercase">${escapeHtml(diff.changeType)}</span></div><div style="display:flex;align-items:center;gap:12px"><span style="font-family:${theme.fontMono};font-size:12px;font-weight:700"><span style="color:#88ff88">+${diff.insertions}</span> <span style="color:#ff8888">-${diff.deletions}</span></span><div style="display:inline-flex;border:1px solid #ffffff"><button onclick="appSetDiffMode('unified')" style="background:${!isSplit ? "#ffffff" : "#000000"};color:${!isSplit ? "#000000" : "#ffffff"};border:none;padding:4px 10px;font-family:${theme.fontMono};font-size:11px;font-weight:800;cursor:pointer">UNIFIED</button><button onclick="appSetDiffMode('split')" style="background:${isSplit ? "#ffffff" : "#000000"};color:${isSplit ? "#000000" : "#ffffff"};border:none;padding:4px 10px;font-family:${theme.fontMono};font-size:11px;font-weight:800;cursor:pointer">SIDE-BY-SIDE</button></div></div></div>${bodyContent}</div>`;
}

function renderUnifiedDiffList(diff: DiffViewModel, theme: ThemeTokens): string {
  const lineHtmls = diff.lines
    .map((l) => {
      let bg = "#000000";
      let color = "#ffffff";
      let sign = " ";
      if (l.type === "add") {
        bg = "#081a08";
        color = "#88ff88";
        sign = "+";
      } else if (l.type === "del") {
        bg = "#1a0808";
        color = "#ff8888";
        sign = "-";
      } else if (l.type === "header") {
        bg = "#111111";
        color = "#ffffff";
        sign = "@";
      }

      return `<div style="background:${bg};color:${color};display:flex;padding:2px 8px;font-family:${theme.fontMono};font-size:11px;line-height:1.4;border-bottom:1px solid #1a1a1a"><span style="width:36px;color:#555555;user-select:none;text-align:right;padding-right:8px;font-weight:700">${l.oldLineNumber ?? ""}</span><span style="width:36px;color:#555555;user-select:none;text-align:right;padding-right:8px;font-weight:700">${l.newLineNumber ?? ""}</span><span style="width:16px;user-select:none;font-weight:900">${sign}</span><span style="flex:1;white-space:pre-wrap;word-break:break-all">${escapeHtml(l.content)}</span></div>`;
    })
    .join("");

  return `<div style="max-height:420px;overflow-y:auto">${lineHtmls}</div>`;
}

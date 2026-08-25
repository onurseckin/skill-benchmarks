import { auditDashboardPalette, normalizeHex } from "./quality-gate.js";

const failures: string[] = [];
let passCount = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passCount += 1;
  } else {
    failures.push(name);
  }
}

const single38bdf8 = auditDashboardPalette("color:#38bdf8;");
check("single-chromatic-38bdf8-count", single38bdf8.length === 1);
check("single-chromatic-38bdf8-color", single38bdf8[0]?.color === "#38bdf8");

const single94a3b8 = auditDashboardPalette("color:#94a3b8;");
check("single-chromatic-94a3b8-count", single94a3b8.length === 1);
check("single-chromatic-94a3b8-color", single94a3b8[0]?.color === "#94a3b8");

const admittedGreys = ["#ffffff", "#000000", "#aaaaaa", "#888888", "#222222", "#555555", "#333333", "#111111"];
for (const grey of admittedGreys) {
  const result = auditDashboardPalette(`background:${grey};`);
  check(`grey-admitted-${grey}`, result.length === 0);
}

const threeDigitGrey = auditDashboardPalette("border:#fff;");
check("three-digit-grey-admitted", threeDigitGrey.length === 0);

const threeDigitChromatic = auditDashboardPalette("border:#38b;");
check("three-digit-chromatic-rejected-count", threeDigitChromatic.length === 1);

const eightDigitChromatic = auditDashboardPalette("fill:#38bdf8ff;");
check("eight-digit-chromatic-rejected-count", eightDigitChromatic.length === 1);
check("eight-digit-chromatic-rejected-key", eightDigitChromatic[0]?.color === "#38bdf8");

const eightDigitGrey = auditDashboardPalette("fill:#ffffffff;");
check("eight-digit-grey-admitted", eightDigitGrey.length === 0);

const twoLineInput = "color:#38bdf8;\ncolor:#38bdf8;";
const twoLineResult = auditDashboardPalette(twoLineInput);
check("line-accumulation-count", twoLineResult.length === 1);
check("line-accumulation-lines-length", twoLineResult[0]?.lines.length === 2);
check(
  "line-accumulation-lines-values",
  twoLineResult[0]?.lines[0] === 1 && twoLineResult[0]?.lines[1] === 2
);

check("normalize-hex-fff", normalizeHex("#fff") === "ffffff");
check("normalize-hex-two-digit-null", normalizeHex("#ab") === null);
check("normalize-hex-five-digit-null", normalizeHex("#abcde") === null);

const hrefLike = auditDashboardPalette('<a href="#dashboard">link</a>');
check("href-guard-zero-entries", hrefLike.length === 0);

if (failures.length > 0) {
  process.stderr.write(`Failed assertions: ${failures.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write(`${passCount} assertion(s) passed.\n`);
process.exit(0);

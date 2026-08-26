import { extname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  readBoundedReplayFile,
  readCanonicalRunArtifacts,
  RunArtifactReadError,
} from "../infrastructure/workspace/run-artifact-reader.js";
import { parseCanonicalEventLines, validateCanonicalEvents } from "./event-envelope-validator.js";
import { projectReplaySession } from "./event-session-projector.js";
import { ReplayEvidenceInvalidError, ReplayEvidenceUnavailableError } from "./errors.js";
import { parseReplayArtifactIdentity } from "./replay-artifact-identity.js";
import {
  replaySessionSchemaVersion,
  type ReplayEvidenceIdentity,
  type ReplayEvidenceSource,
  type ReplaySession,
} from "./types.js";

export function loadReplaySession(source: ReplayEvidenceSource): ReplaySession {
  try {
    const extension = extname(source.eventsPath).toLowerCase();
    if (extension === ".json") {
      if (source.manifestPath !== undefined || source.resultPath !== undefined)
        throw new ReplayEvidenceInvalidError();
      const session = parseReplaySessionJson(readBoundedReplayFile(source.eventsPath));
      if (source.expectedRunId !== undefined && session.metadata.runId !== source.expectedRunId) {
        throw new ReplayEvidenceInvalidError();
      }
      return session;
    }
    if (extension !== ".jsonl") throw new ReplayEvidenceInvalidError();
    if ((source.manifestPath === undefined) !== (source.resultPath === undefined)) {
      throw new ReplayEvidenceUnavailableError();
    }
    if (source.manifestPath !== undefined && source.resultPath !== undefined) {
      const expectedRunId = requireExpectedRunId(source);
      const contents = readCanonicalRunArtifacts(
        source.eventsPath,
        source.manifestPath,
        source.resultPath,
        expectedRunId,
      );
      const identity = parseReplayArtifactIdentity(contents.manifest, contents.result, {
        ...source.expectedIdentity,
        runId: expectedRunId,
      });
      return projectReplaySession(parseCanonicalEventLines(contents.events), identity);
    }
    const identity = {
      ...source.expectedIdentity,
      sourceKind: source.expectedIdentity?.sourceKind ?? "direct",
      ...(source.expectedRunId === undefined ? {} : { runId: source.expectedRunId }),
    } as ReplayEvidenceIdentity;
    return parseReplayJsonl(readBoundedReplayFile(source.eventsPath), identity);
  } catch (error) {
    if (
      error instanceof ReplayEvidenceInvalidError ||
      error instanceof ReplayEvidenceUnavailableError
    )
      throw error;
    if (error instanceof RunArtifactReadError) {
      if (error.failure === "unavailable") throw new ReplayEvidenceUnavailableError();
      throw new ReplayEvidenceInvalidError();
    }
    throw error;
  }
}

export function parseReplayJsonl(
  content: string,
  identity?: ReplayEvidenceIdentity,
): ReplaySession {
  const events = parseCanonicalEventLines(content);
  return projectReplaySession(events, requireDirectReplayExpectation(identity));
}

export function parseReplaySessionJson(content: string): ReplaySession {
  let candidate: Readonly<Record<string, unknown>>;
  try {
    candidate = requireRecord(JSON.parse(content) as unknown);
  } catch (error) {
    if (error instanceof ReplayEvidenceInvalidError) throw error;
    throw new ReplayEvidenceInvalidError();
  }
  if (candidate.schemaVersion !== replaySessionSchemaVersion)
    throw new ReplayEvidenceInvalidError();
  const provenance = requireRecord(candidate.provenance);
  const metadata = requireRecord(candidate.metadata);
  const sourceEvents = validateCanonicalEvents(requireArray(candidate.sourceEvents));
  const identity = readExportedIdentity(provenance, metadata);
  const rebuilt = projectReplaySession(sourceEvents, identity);
  if (!isDeepStrictEqual(candidate, rebuilt)) throw new ReplayEvidenceInvalidError();
  return rebuilt;
}

function readExportedIdentity(
  provenance: Readonly<Record<string, unknown>>,
  metadata: Readonly<Record<string, unknown>>,
): ReplayEvidenceIdentity {
  if (provenance.source !== "persisted-events") throw new ReplayEvidenceInvalidError();
  if (provenance.sourceKind !== "direct" && provenance.sourceKind !== "canonical-run") {
    throw new ReplayEvidenceInvalidError();
  }
  const sourceKind = provenance.sourceKind;
  const identity: Record<string, unknown> = { sourceKind };
  copyOptionalString(provenance, identity, "sweepId");
  copyOptionalString(provenance, identity, "cellId");
  copyOptionalString(provenance, identity, "planFingerprint");
  copyOptionalEnum(provenance, identity, "benchmarkCohort", [
    "eligible",
    "validation",
    "operational",
  ]);
  copyOptionalEnum(provenance, identity, "eligibilityStatus", [
    "eligible",
    "ineligible",
    "unknown",
  ]);
  copyOptionalStringArray(provenance, identity, "eligibilityReasons");
  copyOptionalEnum(provenance, identity, "evaluationStatus", [
    "not_requested",
    "not_evaluated",
    "evaluated",
    "invalid",
  ]);
  if (sourceKind === "canonical-run") {
    const skillIds = requireStringArray(metadata.skillIds, true);
    if (skillIds.length !== 1) throw new ReplayEvidenceInvalidError();
    requireNonemptyString(metadata.runId);
    requireNonemptyString(metadata.scenarioId);
    requireNonemptyString(skillIds[0]);
    requireNonemptyString(metadata.modelId);
    identity.providerId = requireNonemptyString(metadata.providerId);
    if (metadata.executionMode !== "fake" && metadata.executionMode !== "live")
      throw new ReplayEvidenceInvalidError();
    identity.executionMode = metadata.executionMode;
    if (typeof metadata.simulated !== "boolean") throw new ReplayEvidenceInvalidError();
    identity.simulated = metadata.simulated;
    identity.startedAt = requireNonemptyString(metadata.startedAt);
    identity.completedAt = requireNonemptyString(metadata.completedAt);
    requireEnum(metadata.executionStatus, ["completed", "failed", "timed_out", "aborted"]);
    requireNonemptyString(metadata.terminationReason);
    requireNonnegativeNumber(metadata.durationMs);
    requireNonnegativeInteger(metadata.totalTurns);
    identity.totalTokens = requireNonnegativeInteger(metadata.totalTokens);
    requireNonnegativeNumber(metadata.totalCostUSD);
  } else {
    rejectDirectIdentityClaims(provenance, metadata);
  }
  return identity as ReplayEvidenceIdentity;
}

function rejectDirectIdentityClaims(
  provenance: Readonly<Record<string, unknown>>,
  metadata: Readonly<Record<string, unknown>>,
): void {
  const provenanceClaims = [
    "sweepId",
    "cellId",
    "planFingerprint",
    "benchmarkCohort",
    "eligibilityStatus",
    "eligibilityReasons",
    "evaluationStatus",
  ];
  const metadataClaims = [
    "providerId",
    "executionMode",
    "simulated",
    "startedAt",
    "completedAt",
    "totalTokens",
  ];
  if (
    provenanceClaims.some((key) => key in provenance) ||
    metadataClaims.some((key) => key in metadata)
  ) {
    throw new ReplayEvidenceInvalidError();
  }
}

function requireExpectedRunId(source: ReplayEvidenceSource): string {
  if (source.expectedRunId === undefined || source.expectedRunId.trim().length === 0) {
    throw new ReplayEvidenceInvalidError();
  }
  return source.expectedRunId;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ReplayEvidenceInvalidError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new ReplayEvidenceInvalidError();
  return value;
}

function requireNonemptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ReplayEvidenceInvalidError();
  return value;
}

function requireStringArray(value: unknown, nonempty: boolean): readonly string[] {
  if (
    !Array.isArray(value) ||
    (nonempty && value.length === 0) ||
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new ReplayEvidenceInvalidError();
  }
  return value;
}

function requireNonnegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new ReplayEvidenceInvalidError();
  return value;
}

function requireNonnegativeInteger(value: unknown): number {
  const number = requireNonnegativeNumber(value);
  if (!Number.isSafeInteger(number)) throw new ReplayEvidenceInvalidError();
  return number;
}

function copyOptionalString(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (source[key] !== undefined) target[key] = requireNonemptyString(source[key]);
}

function copyOptionalStringArray(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (source[key] !== undefined) target[key] = requireStringArray(source[key], false);
}

function copyOptionalEnum(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): void {
  if (source[key] !== undefined) target[key] = requireEnum(source[key], allowed);
}

function requireEnum(value: unknown, allowed: readonly string[]): string {
  const text = requireNonemptyString(value);
  if (!allowed.includes(text)) throw new ReplayEvidenceInvalidError();
  return text;
}

function requireDirectReplayExpectation(
  identity: ReplayEvidenceIdentity | undefined,
): ReplayEvidenceIdentity {
  if (identity === undefined) return { sourceKind: "direct" };
  if (Object.getPrototypeOf(identity) !== Object.prototype) throw new ReplayEvidenceInvalidError();
  const allowed = new Set([
    "sourceKind",
    "runId",
    "scenarioId",
    "skillId",
    "modelId",
    "status",
    "terminationReason",
    "durationMs",
    "totalCostUSD",
    "totalTurns",
  ]);
  if (Object.keys(identity).some((key) => !allowed.has(key)))
    throw new ReplayEvidenceInvalidError();
  if (identity.sourceKind !== undefined && identity.sourceKind !== "direct")
    throw new ReplayEvidenceInvalidError();
  return { ...identity, sourceKind: "direct" };
}

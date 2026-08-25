export class ReplayEvidenceUnavailableError extends Error {
  public constructor() {
    super("Replay evidence is unavailable");
    this.name = "ReplayEvidenceUnavailableError";
  }
}

export class ReplayEvidenceInvalidError extends TypeError {
  public constructor() {
    super("Replay evidence is invalid");
    this.name = "ReplayEvidenceInvalidError";
  }
}

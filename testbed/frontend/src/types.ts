export interface MetricEntry {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly timestamp: number;
}

export interface UserAccount {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: "admin" | "member" | "guest";
  readonly active: boolean;
}

export interface EventStreamPayload {
  readonly topic: string;
  readonly message: string;
  readonly receivedAt: number;
}

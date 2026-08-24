import type { AgentMessage, ToolCallRequest, ToolDefinition } from "./types.js";
import {
  SkillRegistry,
  defaultSkillRegistry,
  formatSkillsForAgentContext,
  formatSkillPrompt,
} from "../skills/registry.js";
import type { SkillManifest } from "../skills/types.js";

export const DEFAULT_BASE_SYSTEM_PROMPT =
  "You are an autonomous AI software engineering agent. Follow all system instructions, project guidelines, and active skill rules precisely.";

export interface ContextManagerOptions {
  readonly baseSystemPrompt?: string;
  readonly skillRegistry?: SkillRegistry;
  readonly maxContextTokens?: number;
  readonly maxTurnsHistory?: number;
  readonly systemPromptTemplate?: string;
  readonly tools?: ReadonlyArray<ToolDefinition>;
}

export function buildSystemPrompt(
  baseSystemPrompt?: string,
  skillContent?: string,
  template?: string
): string {
  const effectiveBase =
    baseSystemPrompt !== undefined && baseSystemPrompt.trim().length > 0
      ? baseSystemPrompt.trim()
      : DEFAULT_BASE_SYSTEM_PROMPT;
  const trimmedSkills = skillContent !== undefined ? skillContent.trim() : "";

  if (template !== undefined && template.trim().length > 0) {
    let rendered = template;
    if (rendered.includes("{{baseSystemPrompt}}")) {
      rendered = rendered.replaceAll("{{baseSystemPrompt}}", effectiveBase);
    } else if (rendered.includes("{{systemPrompt}}")) {
      rendered = rendered.replaceAll("{{systemPrompt}}", effectiveBase);
    }
    if (rendered.includes("{{skillContent}}")) {
      rendered = rendered.replaceAll("{{skillContent}}", trimmedSkills);
    } else if (rendered.includes("{{skills}}")) {
      rendered = rendered.replaceAll("{{skills}}", trimmedSkills);
    }
    if (rendered !== template) {
      return rendered.trim();
    }
  }

  if (trimmedSkills.length === 0) {
    return effectiveBase;
  }
  return `${effectiveBase}\n\n${trimmedSkills}`;
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 1;
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0).length;
  const charTokens = text.length / 4;
  const wordBonus = words * 0.25;
  return Math.max(1, Math.ceil(charTokens + wordBonus));
}

export function estimateMessageTokens(message: AgentMessage): number {
  switch (message.role) {
    case "system":
    case "user":
      return estimateTokens(message.content) + 4;
    case "assistant": {
      let count = estimateTokens(message.content) + 4;
      if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
        for (const tc of message.toolCalls) {
          const argsStr = tc.rawArguments.length > 0 ? tc.rawArguments : JSON.stringify(tc.arguments);
          count += estimateTokens(tc.name) + estimateTokens(argsStr) + estimateTokens(tc.id) + 8;
        }
      }
      return count;
    }
    case "tool":
      return (
        estimateTokens(message.content) +
        estimateTokens(message.name) +
        estimateTokens(message.toolCallId) +
        6
      );
  }
}

export function estimateMessagesTokens(messages: ReadonlyArray<AgentMessage>): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

export class AgentContextManager {
  private readonly messages: AgentMessage[] = [];
  private readonly options: ContextManagerOptions;
  private readonly registry: SkillRegistry;
  private readonly baseSystemPrompt: string;
  private readonly systemPromptTemplate?: string;
  private readonly maxContextTokens?: number;
  private readonly maxTurnsHistory?: number;
  private activeSkillsContent: string = "";
  private activeSkillManifests: SkillManifest[] = [];
  private registeredTools: ToolDefinition[] = [];

  constructor(options?: ContextManagerOptions) {
    this.options = options ?? {};
    this.registry = options?.skillRegistry ?? defaultSkillRegistry;
    this.baseSystemPrompt = options?.baseSystemPrompt ?? DEFAULT_BASE_SYSTEM_PROMPT;
    this.systemPromptTemplate = options?.systemPromptTemplate;
    this.maxContextTokens = options?.maxContextTokens;
    this.maxTurnsHistory = options?.maxTurnsHistory;
    if (options?.tools !== undefined) {
      this.registeredTools = [...options.tools];
    }
  }

  initialize(
    scenarioPrompt: string,
    skillIds?: ReadonlyArray<string | SkillManifest>,
    baseSystemPrompt?: string
  ): ReadonlyArray<AgentMessage> {
    this.messages.length = 0;
    this.activeSkillManifests = [];
    const effectiveBasePrompt =
      baseSystemPrompt !== undefined && baseSystemPrompt.trim().length > 0
        ? baseSystemPrompt.trim()
        : this.baseSystemPrompt;

    if (skillIds !== undefined && skillIds.length > 0) {
      this.activeSkillsContent = formatSkillsForAgentContext(skillIds, undefined, this.registry);
      for (const item of skillIds) {
        if (typeof item === "string") {
          const manifest = this.registry.getSkill(item);
          if (manifest !== undefined) this.activeSkillManifests.push(manifest);
        } else {
          this.activeSkillManifests.push(item);
        }
      }
    } else {
      this.activeSkillsContent = "";
    }

    const systemContent = buildSystemPrompt(effectiveBasePrompt, this.activeSkillsContent, this.systemPromptTemplate);
    this.messages.push({ role: "system", content: systemContent });
    this.messages.push({ role: "user", content: scenarioPrompt });
    return this.getMessages();
  }

  addMessage(message: AgentMessage): void {
    this.messages.push(message);
  }

  addAssistantTurn(content: string, toolCalls?: ReadonlyArray<ToolCallRequest>): void {
    if (toolCalls !== undefined && toolCalls.length > 0) {
      this.messages.push({ role: "assistant", content, toolCalls: [...toolCalls] });
    } else {
      this.messages.push({ role: "assistant", content });
    }
  }

  addToolResult(toolCallId: string, toolName: string, output: string, isError?: boolean): void {
    this.messages.push({
      role: "tool",
      toolCallId,
      name: toolName,
      content: output,
      isError: isError ?? false,
    });
  }

  getMessages(): ReadonlyArray<AgentMessage> {
    return [...this.messages];
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getEstimatedTokenCount(): number {
    return estimateMessagesTokens(this.messages);
  }

  getActiveSkillsContent(): string {
    return this.activeSkillsContent;
  }

  getActiveSkills(): ReadonlyArray<SkillManifest> {
    return [...this.activeSkillManifests];
  }

  getRegisteredTools(): ReadonlyArray<ToolDefinition> {
    return [...this.registeredTools];
  }

  registerTools(tools: ReadonlyArray<ToolDefinition>): void {
    this.registeredTools.push(...tools);
  }

  formatSkill(manifestOrId: string | SkillManifest): string {
    return formatSkillPrompt(manifestOrId, undefined, this.registry);
  }

  getLastMessage(): AgentMessage | undefined {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : undefined;
  }

  clear(): void {
    this.messages.length = 0;
    this.activeSkillsContent = "";
    this.activeSkillManifests.length = 0;
  }

  getOptions(): ContextManagerOptions {
    return { ...this.options };
  }

  pruneHistory(maxTurns?: number, maxTokens?: number): ReadonlyArray<AgentMessage> {
    if (this.messages.length <= 2) {
      return this.getMessages();
    }
    const systemMsg = this.messages[0];
    const initialUserMsg = this.messages[1];
    if (systemMsg === undefined || initialUserMsg === undefined) {
      return this.getMessages();
    }

    const effectiveMaxTurns = maxTurns ?? this.maxTurnsHistory;
    const effectiveMaxTokens = maxTokens ?? this.maxContextTokens;

    const blocks: AgentMessage[][] = [];
    let currentBlock: AgentMessage[] = [];

    for (let i = 2; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg === undefined) continue;
      if (msg.role === "assistant" || msg.role === "user") {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
      }
      currentBlock.push(msg);
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    if (effectiveMaxTurns !== undefined && effectiveMaxTurns > 0) {
      while (blocks.length > effectiveMaxTurns) {
        blocks.shift();
      }
    }

    if (effectiveMaxTokens !== undefined && effectiveMaxTokens > 0) {
      const baseTokens = estimateMessageTokens(systemMsg) + estimateMessageTokens(initialUserMsg);
      while (blocks.length > 0) {
        let totalTokens = baseTokens;
        for (const block of blocks) {
          for (const msg of block) {
            totalTokens += estimateMessageTokens(msg);
          }
        }
        if (totalTokens > effectiveMaxTokens && blocks.length > 1) {
          blocks.shift();
        } else {
          break;
        }
      }
    }

    const result: AgentMessage[] = [systemMsg, initialUserMsg];
    for (const block of blocks) {
      for (const msg of block) {
        result.push(msg);
      }
    }

    this.messages.length = 0;
    this.messages.push(...result);
    return this.getMessages();
  }

  clone(): AgentContextManager {
    const copy = new AgentContextManager(this.options);
    for (const msg of this.messages) {
      if (msg.role === "assistant" && msg.toolCalls !== undefined) {
        copy.addMessage({
          role: "assistant",
          content: msg.content,
          toolCalls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: { ...tc.arguments },
            rawArguments: tc.rawArguments,
          })),
        });
      } else if (msg.role === "tool") {
        copy.addMessage({
          role: "tool",
          toolCallId: msg.toolCallId,
          name: msg.name,
          content: msg.content,
          isError: msg.isError,
        });
      } else {
        copy.addMessage({
          role: msg.role,
          content: msg.content,
        });
      }
    }
    copy.activeSkillsContent = this.activeSkillsContent;
    copy.activeSkillManifests = [...this.activeSkillManifests];
    copy.registeredTools = [...this.registeredTools];
    return copy;
  }
}

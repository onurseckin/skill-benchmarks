import type {
  ClarificationAssertion,
  ClarificationTopic,
  DialogMessage,
  DialogTranscript,
  DialogTurnResponse,
  InterviewScript,
  PersonaConfig,
  PersonaTone,
  ScriptTrigger,
  ScriptTriggerResponse,
  StakeholderSimulatorConfig,
} from "./types.js";

export class StakeholderSimulator {
  private readonly script: InterviewScript;
  private readonly conversationId: string;
  private readonly strictMode: boolean;
  private currentTurn = 0;
  private readonly messages: DialogMessage[] = [];
  private readonly revealedTopicIds = new Set<string>();
  private readonly revealedConstraintIndices = new Set<number>();
  private readonly clarificationAssertions = new Map<string, ClarificationAssertion>();
  private readonly startTime: number;
  private completed = false;

  constructor(config: StakeholderSimulatorConfig) {
    this.script = config.script;
    this.conversationId = config.conversationId ?? `dialog-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.strictMode = config.strictMode ?? true;
    this.startTime = Date.now();

    for (const topic of this.script.clarificationTopics) {
      this.clarificationAssertions.set(topic.id, {
        topicId: topic.id,
        status: "missed",
        scoreImpact: topic.requiredToAsk ? -topic.penaltyIfNotAsked : 0,
        details: `Topic ${topic.id} has not yet been addressed.`,
      });
    }
  }

  public startConversation(): DialogMessage {
    if (this.messages.length > 0) {
      return this.messages[0]!;
    }

    const initialContent = this.formatPersonaResponse(
      this.script.initialPrompt,
      this.script.persona.tone
    );

    const initialMessage: DialogMessage = {
      id: `msg-${this.conversationId}-turn-0`,
      role: "stakeholder",
      content: initialContent,
      timestamp: Date.now(),
      turn: 0,
      metadata: {
        personaId: this.script.persona.id,
        personaName: this.script.persona.name,
        personaRole: this.script.persona.role,
        isInitial: true,
      },
    };

    this.messages.push(initialMessage);
    return initialMessage;
  }

  public processTurn(agentMessageText: string): DialogTurnResponse {
    this.currentTurn += 1;

    const agentMessage: DialogMessage = {
      id: `msg-${this.conversationId}-agent-${this.currentTurn}`,
      role: "agent",
      content: agentMessageText,
      timestamp: Date.now(),
      turn: this.currentTurn,
    };
    this.messages.push(agentMessage);

    const isQuestion = this.detectQuestion(agentMessageText);
    const triggeredTopics = this.evaluateClarificationTopics(agentMessageText, this.currentTurn);
    const turnConfig = this.script.turns.find((t) => t.turnNumber === this.currentTurn);

    let matchedResponse: ScriptTriggerResponse | undefined;
    let pushbackTriggered = false;

    if (turnConfig) {
      matchedResponse = this.findMatchingTrigger(agentMessageText, turnConfig.triggerResponses);

      if (!matchedResponse && turnConfig.injectPushbackIfNoQuestion && !isQuestion && triggeredTopics.length === 0) {
        pushbackTriggered = true;
      }
    }

    const newlyRevealedTopics: string[] = [];
    const newlyRevealedConstraints: string[] = [];

    if (matchedResponse) {
      if (matchedResponse.revealTopicIds) {
        for (const topicId of matchedResponse.revealTopicIds) {
          if (!this.revealedTopicIds.has(topicId)) {
            this.revealedTopicIds.add(topicId);
            newlyRevealedTopics.push(topicId);
          }
        }
      }
      if (matchedResponse.revealConstraintIndices) {
        for (const idx of matchedResponse.revealConstraintIndices) {
          if (!this.revealedConstraintIndices.has(idx) && this.script.persona.hiddenConstraints[idx]) {
            this.revealedConstraintIndices.add(idx);
            newlyRevealedConstraints.push(this.script.persona.hiddenConstraints[idx]!);
          }
        }
      }
    }

    for (const topic of triggeredTopics) {
      if (!this.revealedTopicIds.has(topic.id)) {
        this.revealedTopicIds.add(topic.id);
        newlyRevealedTopics.push(topic.id);
      }
    }

    let responseText = "";
    if (pushbackTriggered && turnConfig?.pushbackMessage) {
      responseText = this.formatPersonaResponse(turnConfig.pushbackMessage, this.script.persona.tone);
    } else if (matchedResponse) {
      responseText = this.formatPersonaResponse(matchedResponse.responseText, matchedResponse.tone ?? this.script.persona.tone);
    } else if (turnConfig) {
      responseText = this.formatPersonaResponse(turnConfig.defaultResponse, this.script.persona.tone);
    } else {
      responseText = this.formatPersonaResponse(
        this.generateFallbackResponse(triggeredTopics, isQuestion),
        this.script.persona.tone
      );
    }

    if (newlyRevealedTopics.length > 0) {
      const topicDetails = newlyRevealedTopics
        .map((id) => this.script.clarificationTopics.find((t) => t.id === id)?.revealedDetails)
        .filter((detail): detail is string => Boolean(detail));

      if (topicDetails.length > 0) {
        responseText += `\n\n${topicDetails.join("\n")}`;
      }
    }

    if (this.currentTurn >= this.script.maxTurns) {
      this.completed = true;
    }

    const stakeholderMessage: DialogMessage = {
      id: `msg-${this.conversationId}-stakeholder-${this.currentTurn}`,
      role: "stakeholder",
      content: responseText,
      timestamp: Date.now(),
      turn: this.currentTurn,
      metadata: {
        matchedTriggerId: matchedResponse?.trigger.id ?? "none",
        revealedTopicCount: newlyRevealedTopics.length,
        pushback: pushbackTriggered,
      },
    };
    this.messages.push(stakeholderMessage);

    return {
      message: stakeholderMessage,
      matchedTriggerId: matchedResponse?.trigger.id,
      revealedTopics: newlyRevealedTopics,
      revealedConstraints: newlyRevealedConstraints,
      pushbackTriggered,
      isCompleted: this.completed,
    };
  }

  public getTranscript(): DialogTranscript {
    return {
      conversationId: this.conversationId,
      scriptId: this.script.id,
      personaId: this.script.persona.id,
      messages: [...this.messages],
      turnCount: this.currentTurn,
      startTime: this.startTime,
      endTime: Date.now(),
      metadata: {
        completed: this.completed,
        revealedTopicCount: this.revealedTopicIds.size,
        revealedConstraintCount: this.revealedConstraintIndices.size,
      },
    };
  }

  public getClarificationAssertions(): readonly ClarificationAssertion[] {
    return Array.from(this.clarificationAssertions.values());
  }

  public getRevealedTopics(): readonly string[] {
    return Array.from(this.revealedTopicIds);
  }

  public getRevealedConstraints(): readonly string[] {
    return Array.from(this.revealedConstraintIndices).map(
      (idx) => this.script.persona.hiddenConstraints[idx] ?? ""
    ).filter(Boolean);
  }

  public isCompleted(): boolean {
    return this.completed;
  }

  private detectQuestion(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.includes("?")) {
      return true;
    }
    const questionStarters = [
      "could you",
      "can you",
      "would you",
      "what is",
      "what are",
      "how should",
      "why is",
      "is there",
      "do we have",
      "please clarify",
      "to confirm",
    ];
    const lower = trimmed.toLowerCase();
    return questionStarters.some((starter) => lower.includes(starter));
  }

  private evaluateClarificationTopics(text: string, currentTurn: number): readonly ClarificationTopic[] {
    const lower = text.toLowerCase();
    const triggered: ClarificationTopic[] = [];

    for (const topic of this.script.clarificationTopics) {
      const matched = topic.triggerKeywords.some((keyword) => lower.includes(keyword.toLowerCase()));

      if (matched) {
        triggered.push(topic);
        const existing = this.clarificationAssertions.get(topic.id);
        if (!existing || existing.status === "missed") {
          const isEarly = currentTurn <= Math.ceil(this.script.maxTurns / 2);
          const bonus = isEarly ? topic.bonusIfAskedEarly : 0;
          const status = isEarly ? "clarified" : "clarified_late";

          this.clarificationAssertions.set(topic.id, {
            topicId: topic.id,
            status,
            turnAsked: currentTurn,
            questionSnippet: text.substring(0, 160),
            scoreImpact: bonus,
            details: `Topic "${topic.id}" clarified on turn ${currentTurn} (${status}).`,
          });
        }
      }
    }

    return triggered;
  }

  private findMatchingTrigger(
    text: string,
    triggerResponses: readonly ScriptTriggerResponse[]
  ): ScriptTriggerResponse | undefined {
    const lower = text.toLowerCase();

    for (const item of triggerResponses) {
      const { trigger } = item;

      if (trigger.minTurn !== undefined && this.currentTurn < trigger.minTurn) {
        continue;
      }
      if (trigger.maxTurn !== undefined && this.currentTurn > trigger.maxTurn) {
        continue;
      }

      if (trigger.type === "keyword_match" && trigger.keywords) {
        const hasKeyword = trigger.keywords.some((k) => lower.includes(k.toLowerCase()));
        if (hasKeyword) {
          return item;
        }
      }

      if (trigger.type === "regex_match" && trigger.pattern) {
        try {
          const reg = new RegExp(trigger.pattern, "i");
          if (reg.test(text)) {
            return item;
          }
        } catch {
          continue;
        }
      }

      if (trigger.type === "topic_reference" && trigger.targetTopicId) {
        if (this.revealedTopicIds.has(trigger.targetTopicId)) {
          return item;
        }
      }
    }

    return undefined;
  }

  private formatPersonaResponse(content: string, tone: PersonaTone): string {
    switch (tone) {
      case "skeptical":
        return `I'm not entirely convinced yet. ${content}`;
      case "pedantic":
        return `To be precise about the specifications: ${content}`;
      case "impatient":
        return `Quick update: ${content}`;
      case "vague":
        return `Well, roughly speaking, ${content}`;
      case "supportive":
        return `Great point! ${content}`;
      case "demanding":
        return `We need to be certain about this: ${content}`;
      case "technical":
        return `Architecturally speaking: ${content}`;
      case "cooperative":
      default:
        return content;
    }
  }

  private generateFallbackResponse(
    triggeredTopics: readonly ClarificationTopic[],
    isQuestion: boolean
  ): string {
    if (triggeredTopics.length > 0) {
      return "Thanks for asking about that specific constraint. Let me clarify the domain details.";
    }
    if (isQuestion) {
      return "That is a valid consideration. Proceed based on our primary reliability and latency goals.";
    }
    return "I see what you are proposing. Ensure you verify all edge cases before final delivery.";
  }
}

export function createStakeholderSimulator(config: StakeholderSimulatorConfig): StakeholderSimulator {
  return new StakeholderSimulator(config);
}


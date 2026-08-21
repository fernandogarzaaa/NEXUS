import type { OperationalException, RecoveryOption, Shipment } from "../domain/types";

// ---------------------------------------------------------------------------
// Optional LLM narration. NEXUS's decision logic (lib/agents/reasoner.ts) is
// fully deterministic and never depends on this module — this exists only
// to turn the deterministic decision into a natural-language rationale when
// an API key is configured, demonstrating the "AI-first" narrative layer
// without making the POC depend on network access. If ANTHROPIC_API_KEY is
// unset, absent, or the call fails/times out for any reason, we fall back
// to a templated explanation so the demo stays fully offline-capable and
// deterministic.
// ---------------------------------------------------------------------------

export interface NarrationInput {
  shipment: Shipment;
  exception: OperationalException;
  selected: RecoveryOption;
  alternatives: RecoveryOption[];
}

export interface NarrationResult {
  text: string;
  source: "DETERMINISTIC_REASONER" | "LLM_REASONER";
}

function templateRationale(input: NarrationInput): string {
  const { shipment, exception, selected, alternatives } = input;
  const runnerUp = alternatives[0];
  const parts = [
    `${exception.type.replace(/_/g, " ").toLowerCase()} on ${shipment.id} adds ${exception.etaImpactMin} min, ` +
      `violating the ${shipment.priority.toLowerCase()}-priority delivery window.`,
    `Selected "${selected.description}" — score ${selected.score.toFixed(2)}, ` +
      `${Math.round(selected.feasibility * 100)}% feasible, $${selected.estimatedCostUsd} estimated cost, ` +
      `recovers ${selected.etaImprovementMin} min.`,
  ];
  if (runnerUp) {
    parts.push(
      `Next-best option ("${runnerUp.description}") scored ${runnerUp.score.toFixed(2)} — ` +
        `rejected for lower recovery-to-cost efficiency.`
    );
  }
  return parts.join(" ");
}

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 8000;

export async function narrateRecoveryPlan(input: NarrationInput): Promise<NarrationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fallback: NarrationResult = { text: templateRationale(input), source: "DETERMINISTIC_REASONER" };
  if (!apiKey) return fallback;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const { shipment, exception, selected, alternatives } = input;
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
        max_tokens: 220,
        system:
          "You are the explanation layer for a logistics exception-recovery agent. " +
          "A deterministic engine has already selected the recovery option — you only explain " +
          "the decision in 2-3 concise operational sentences for a dispatcher. Never invent facts " +
          "beyond the JSON provided. Do not mention chain-of-thought or reasoning steps.",
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              shipmentId: shipment.id,
              customer: shipment.customerName,
              priority: shipment.priority,
              exceptionType: exception.type,
              etaImpactMin: exception.etaImpactMin,
              selectedOption: selected,
              rejectedAlternatives: alternatives.slice(0, 2),
            }),
          },
        ],
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return fallback;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!text) return fallback;
    return { text, source: "LLM_REASONER" };
  } catch {
    return fallback;
  }
}

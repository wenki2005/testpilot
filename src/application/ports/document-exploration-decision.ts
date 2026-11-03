/** Bounded evidence supplied to the model for one read-only navigation choice. */
export type ExplorationPageSnapshot = {
  evidenceId: string;
  route: string;
  title: string;
  visibleText: string[];
  links: Array<{ label: string; href: string }>;
};

export type DocumentExplorationDecisionInput = {
  requirements: string;
  visitedPages: ExplorationPageSnapshot[];
};

export type DocumentExplorationDecision =
  | { decision: "follow-link"; index: number }
  | { decision: "stop"; reason: string };

export interface DocumentExplorationDecisionPort {
  decide(input: DocumentExplorationDecisionInput, signal?: AbortSignal): Promise<DocumentExplorationDecision>;
}

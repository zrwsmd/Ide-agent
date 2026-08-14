import type { BusinessChainContextDiagnostics } from "./BusinessChainContextAnalyzer";
import { BUSINESS_RULES_CONFIG } from "./BusinessRulesConfig";
import type { LocalSuggestionDraft } from "./LocalSuggestionModels";

export function applyBusinessChainSuggestionScores(
  suggestions: LocalSuggestionDraft[],
  context: BusinessChainContextDiagnostics | undefined,
): LocalSuggestionDraft[] {
  if (!context || context.resolution === "insufficientEvidence") {
    return suggestions;
  }

  const config = BUSINESS_RULES_CONFIG.businessChainEnhancement;
  const selectedHasHighConfidenceRole = context.nodes
    .filter((node) => node.selected)
    .some((node) =>
      [...node.roles, ...node.ports.flatMap((port) => port.roles)].some(
        (role) => role.strength === "high",
      ),
    );

  return suggestions.map((suggestion) => {
    const hasPresentation = Boolean(suggestion.businessPresentation);
    const hasEvidence = Boolean(suggestion.businessEvidence);
    if (!hasPresentation && !hasEvidence) {
      return suggestion;
    }

    const score =
      context.resolution === "resolved"
        ? hasPresentation
          ? config.resolvedPresentationScore
          : config.resolvedEvidenceScore
        : hasPresentation
          ? config.partialPresentationScore
          : config.partialEvidenceScore;
    const businessChainScore =
      score +
      (selectedHasHighConfidenceRole
        ? config.highConfidenceRoleBonus
        : 0);
    return businessChainScore > 0
      ? { ...suggestion, businessChainScore }
      : suggestion;
  });
}

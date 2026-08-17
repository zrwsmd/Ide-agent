import type { BusinessSuggestionContext } from "./BusinessContextTypes";
import {
  BUSINESS_RULES_CONFIG,
} from "./BusinessRulesConfig";
import type { BusinessTerm } from "./BusinessRulesConfig";
import {
  includesCaseInsensitive,
  isCounterBlockType,
  isLatchBlockType,
  isMotionBlockType,
  isTimerBlockType,
  normalizeBlockType,
} from "./BusinessEvidence";
import {
  inferPosition,
} from "./LocalSuggestionModels";
import type {
  LocalSuggestionDraft,
  LocalSuggestionScoreBreakdown,
  SegmentGraphState,
} from "./LocalSuggestionModels";

const RELIABLE_BUSINESS_CONFIDENCE = 0.8;
const RELIABLE_BUSINESS_EVIDENCE_TIER = 1;
const COMPLETE_BUSINESS_INTENT_TIER = 2;

export function rankTopologySuggestions(
  suggestions: LocalSuggestionDraft[],
): LocalSuggestionDraft[] {
  return suggestions
    .map((suggestion, index) => {
      const topology = scoreTopologySuggestion(suggestion);
      return {
        suggestion: {
          ...suggestion,
          scoreBreakdown: {
            total: topology,
            topology,
            rankingRules: 0,
            businessEvidence: 0,
            businessChain: 0,
          },
        },
        index,
        score: topology,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.suggestion);
}

function scoreTopologySuggestion(suggestion: LocalSuggestionDraft): number {
  const position = suggestion.position ?? inferPosition(suggestion);
  if (
    position === "outsideBehind" &&
    isContactNodeType(suggestion.addElement.nodeType)
  ) {
    return 3;
  }

  return 0;
}

export function rankBusinessSuggestionScores(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
  graphState: SegmentGraphState,
): LocalSuggestionDraft[] {
  const ranked = suggestions.map((suggestion, index) => {
    const score = scoreBusinessSuggestion(suggestion, context, graphState);
    return {
      suggestion: { ...suggestion, scoreBreakdown: score },
      index,
      score: score.total,
      businessTier: businessRankingTier(suggestion),
    };
  });

  if (
    !ranked.some((item) => item.score > 0) &&
    !ranked.some((item) => item.businessTier > 0)
  ) {
    return ranked.map((item) => item.suggestion);
  }

  return ranked
    .sort(
      (left, right) =>
        right.businessTier - left.businessTier ||
        right.score - left.score ||
        left.index - right.index,
    )
    .map((item) => item.suggestion);
}

function businessRankingTier(suggestion: LocalSuggestionDraft): number {
  const presentationConfidence = normalizeBusinessConfidence(
    suggestion.businessPresentation?.confidence,
  );
  const evidenceConfidence = normalizeBusinessConfidence(
    suggestion.businessEvidence?.confidence,
  );
  if (
    presentationConfidence >= RELIABLE_BUSINESS_CONFIDENCE ||
    (evidenceConfidence >= RELIABLE_BUSINESS_CONFIDENCE &&
      hasConcreteBusinessCandidate(suggestion))
  ) {
    return COMPLETE_BUSINESS_INTENT_TIER;
  }
  if (evidenceConfidence >= RELIABLE_BUSINESS_CONFIDENCE) {
    return RELIABLE_BUSINESS_EVIDENCE_TIER;
  }
  return 0;
}

function hasConcreteBusinessCandidate(
  suggestion: LocalSuggestionDraft,
): boolean {
  if (
    suggestion.addElement.nodeType === "functionBlock" &&
    suggestion.addElement.blockType.trim()
  ) {
    return true;
  }

  const variableName = suggestion.addElement.variableName.trim();
  return (
    suggestion.addElement.variableSource === "existingVariable" &&
    Boolean(variableName) &&
    variableName !== "???"
  );
}

function normalizeBusinessConfidence(confidence: number | undefined): number {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return 0;
  }
  return confidence > 1 ? confidence / 100 : confidence;
}

function scoreBusinessSuggestion(
  suggestion: LocalSuggestionDraft,
  context: BusinessSuggestionContext,
  graphState: SegmentGraphState,
): LocalSuggestionScoreBreakdown {
  const addType = suggestion.addElement.nodeType;
  const addBlockType = normalizeBlockType(suggestion.addElement.blockType);
  const position = suggestion.position ?? inferPosition(suggestion);
  const isBefore = position === "front" || position === "outsideFront";
  const isAfter = position === "behind" || position === "outsideBehind";
  const isParallel = position === "parallel";
  const isContact = isContactNodeType(addType);
  const isFunctionBlock = addType === "functionBlock";
  const isCoil = isCoilNodeType(addType);
  const topology = scoreTopologySuggestion(suggestion);
  const rankingRules = scoreConfiguredRankingRules(suggestion, context);
  const businessChain = suggestion.businessChainScore ?? 0;
  let businessEvidence = 0;

  const startSignals = businessTermWeight(
    context,
    "start",
    "run",
    "enable",
    "ready",
  );
  const inhibitSignals = businessTermWeight(
    context,
    "stop",
    "fault",
    "alarm",
    "interlock",
  );
  const stopSignals =
    inhibitSignals + businessTermWeight(context, "reset");
  const timerSignals = businessTermWeight(context, "timer");
  const counterSignals = businessTermWeight(context, "counter");
  const doneSignals = businessTermWeight(context, "done");

  if (isContact) {
    businessEvidence += startSignals * (isBefore ? 3 : isParallel ? 2 : 1);
    businessEvidence += stopSignals * (isBefore ? 2 : isParallel ? 1 : 0);
    businessEvidence += doneSignals * (isAfter ? 1 : 0);
  }

  if (addType === "negatedContact") {
    businessEvidence += inhibitSignals * 3;
    businessEvidence += businessTermWeight(context, "fault") * 2;
  }

  if (addType === "risingContact" || addType === "fallingContact") {
    businessEvidence += startSignals * 2;
    businessEvidence += businessTermWeight(context, "enable") * 2;
  }

  if (addType === "setCoil") {
    businessEvidence += startSignals * 2;
    businessEvidence += businessTermWeight(context, "done") * 2;
    businessEvidence += businessTermWeight(context, "alarm") * 2;
    businessEvidence -= stopSignals;
  }

  if (addType === "resetCoil") {
    const resetSignals = businessTermWeight(context, "reset");
    if (resetSignals > 0) {
      businessEvidence += resetSignals * 3;
      businessEvidence += businessTermWeight(context, "fault", "alarm", "latch") * 2;
    }
  }

  if (isCoil) {
    businessEvidence += doneSignals;
    businessEvidence += graphState.isPartialGraph ? 3 : 1;
    if (isAfter) {
      businessEvidence += 2;
    }
  }

  if (isFunctionBlock) {
    businessEvidence += scoreRelatedFunctionBlockEvidence(addBlockType, context);

    if (isTimerBlockType(addBlockType)) {
      businessEvidence += timerSignals * 3;
      businessEvidence += isTimerBlockType(context.focusBlockType) ? 4 : 0;
      businessEvidence += hasSegmentBlockType(context, isTimerBlockType) ? 1 : 0;
    }

    if (isCounterBlockType(addBlockType)) {
      businessEvidence += counterSignals * 3;
      businessEvidence += isCounterBlockType(context.focusBlockType) ? 4 : 0;
      businessEvidence += hasSegmentBlockType(context, isCounterBlockType) ? 1 : 0;
    }

    if (isLatchBlockType(addBlockType)) {
      businessEvidence += startSignals + stopSignals;
    }

    if (isMotionBlockType(context.focusBlockType)) {
      businessEvidence += startSignals * 2;
      businessEvidence += businessTermWeight(context, "fault", "stop", "reset");
      if (isBefore) {
        businessEvidence += 4;
      }
      if (isAfter) {
        businessEvidence -= 2;
      }
    }

    if (isTimerBlockType(context.focusBlockType) && isTimerBlockType(addBlockType)) {
      businessEvidence += 2;
    }

    if (isCounterBlockType(context.focusBlockType) && isCounterBlockType(addBlockType)) {
      businessEvidence += 2;
    }
  }

  if (isBefore) {
    businessEvidence += isContact ? 2 : 0;
    businessEvidence += isFunctionBlock ? 1 : 0;
  } else if (isAfter) {
    businessEvidence += isCoil ? 2 : 0;
  } else if (isParallel) {
    businessEvidence += isContact ? 2 : 1;
  }

  if (context.focusBlockType === "MC_RESET" && isBefore && isContact) {
    businessEvidence += 4;
  }

  if (context.focusBlockType.startsWith("MC_") && isFunctionBlock && isAfter) {
    businessEvidence -= 3;
  }

  if (graphState.hasOutputNode && isCoil && isAfter) {
    businessEvidence -= 1;
  }

  if (graphState.isPartialGraph && isCoil) {
    businessEvidence += 1;
  }

  return {
    total: topology + rankingRules + businessEvidence + businessChain,
    topology,
    rankingRules,
    businessEvidence,
    businessChain,
  };
}

export function businessTermWeight(
  context: BusinessSuggestionContext,
  ...terms: BusinessTerm[]
): number {
  let score = 0;
  for (const term of terms) {
    const localScore = localBusinessTermWeight(context, term);
    score += localScore;

    if (localScore > 0 && context.pouTerms.has(term)) {
      score += 1;
    }
  }
  return score;
}

function scoreRelatedFunctionBlockEvidence(
  blockType: string,
  context: BusinessSuggestionContext,
): number {
  let score = context.relatedBlockTypes.has(blockType) ? 1 : 0;

  if (isTimerBlockType(blockType) && context.relatedTerms.has("timer")) {
    score += 1;
  } else if (
    isCounterBlockType(blockType) &&
    context.relatedTerms.has("counter")
  ) {
    score += 1;
  } else if (
    isLatchBlockType(blockType) &&
    context.relatedTerms.has("latch")
  ) {
    score += 1;
  } else if (
    isMotionBlockType(blockType) &&
    context.relatedTerms.has("motion") &&
    context.relatedTerms.has("axis")
  ) {
    score += 1;
  }

  return Math.min(score, 2);
}

function scoreConfiguredRankingRules(
  suggestion: LocalSuggestionDraft,
  context: BusinessSuggestionContext,
): number {
  const nodeType = suggestion.addElement.nodeType;
  const blockType = normalizeBlockType(suggestion.addElement.blockType);
  const position = suggestion.position ?? inferPosition(suggestion);

  const matchedRules = BUSINESS_RULES_CONFIG.rankingRules.filter((rule) => {
    if (
      rule.candidateNodeTypes?.length &&
      !includesCaseInsensitive(rule.candidateNodeTypes, nodeType)
    ) {
      return false;
    }
    if (
      rule.candidateBlockTypes?.length &&
      !includesCaseInsensitive(rule.candidateBlockTypes, blockType)
    ) {
      return false;
    }
    if (rule.modes?.length && !rule.modes.includes(suggestion.mode)) {
      return false;
    }
    if (rule.positions?.length && !rule.positions.includes(position)) {
      return false;
    }
    if (
      rule.termsAny?.length &&
      !rule.termsAny.some((term) => localBusinessTermWeight(context, term) > 0)
    ) {
      return false;
    }
    if (
      rule.termsAll?.length &&
      !rule.termsAll.every((term) => localBusinessTermWeight(context, term) > 0)
    ) {
      return false;
    }
    if (
      rule.excludedTerms?.some(
        (term) => localBusinessTermWeight(context, term) > 0,
      )
    ) {
      return false;
    }
    return true;
  });

  if (!matchedRules.length) {
    return 0;
  }

  const highestPriority = Math.max(
    ...matchedRules.map((rule) => rule.priority),
  );
  return matchedRules
    .filter((rule) => rule.priority === highestPriority)
    .reduce((score, rule) => {
      const evidenceTerms = [
        ...(rule.termsAny ?? []),
        ...(rule.termsAll ?? []),
      ];
      return (
        score +
        rule.baseScore +
        businessTermWeight(context, ...evidenceTerms) * rule.termMultiplier
      );
    }, 0);
}

export function localBusinessTermWeight(
  context: BusinessSuggestionContext,
  term: BusinessTerm,
): number {
  let score = 0;
  if (context.focusTerms.has(term)) {
    score += 4;
  }
  if (context.nearbyTerms.has(term)) {
    score += 3;
  }
  if (context.segmentTerms.has(term)) {
    score += 2;
  }
  return score;
}

function hasSegmentBlockType(
  context: BusinessSuggestionContext,
  predicate: (blockType: string) => boolean,
): boolean {
  return [...context.segmentBlockTypes].some(predicate);
}

function isContactNodeType(nodeType: string): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
  ].includes(nodeType);
}

function isCoilNodeType(nodeType: string): boolean {
  return ["coil", "setCoil", "resetCoil"].includes(nodeType);
}

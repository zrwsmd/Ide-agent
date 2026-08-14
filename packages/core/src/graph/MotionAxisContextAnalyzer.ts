import {
  DiagramNodeSummary,
  DiagramSegmentSummary,
  DiagramSummary,
} from "../diagram/DiagramSummary";
import {
  BUSINESS_RULES_CONFIG,
  BusinessMotionCommandProfileConfig,
} from "./BusinessRulesConfig";
import {
  FocusContext,
  MotionAxisCommandInstance,
  MotionAxisContext,
} from "./BusinessContextTypes";
import {
  hasTypeCapability,
  normalizeBlockType,
  normalizeDataType,
  normalizeReference,
  uniqueDisplayNames,
} from "./BusinessEvidence";

export function analyzeMotionAxisContext(
  summary: DiagramSummary,
  focus: FocusContext,
): MotionAxisContext | undefined {
  const resolvedAxis = resolveMotionAxisReference(focus);
  if (!resolvedAxis) {
    return undefined;
  }

  const pouName = (focus.segment.pouName || summary.pouName).trim();
  const samePouSegments = summary.segments.filter(
    (segment) => (segment.pouName || summary.pouName).trim() === pouName,
  );
  const normalizedAxisReference = normalizeReference(
    resolvedAxis.axisReference,
  );
  const commands = samePouSegments.flatMap((segment) =>
    segment.nodes.flatMap((node): MotionAxisCommandInstance[] => {
      const blockType = normalizeBlockType(node.blockType);
      const profile = motionCommandProfileForBlockType(blockType);
      if (!profile) {
        return [];
      }

      const axisReference = motionAxisReferenceForNode(node);
      if (normalizeReference(axisReference) !== normalizedAxisReference) {
        return [];
      }

      const triggerReference =
        motionPortReferencesForNode(
          node,
          [profile.triggerPort],
          "input",
        )[0] ?? "";
      return [{
          nodeId: node.id,
          segmentId: segment.segmentId,
          blockType: node.blockType?.trim() || blockType,
          instance: node.instance?.trim() || "",
          axisReference,
          executeReference:
            profile.triggerPort.trim().toUpperCase() === "EXECUTE"
              ? triggerReference
              : "",
          triggerModel: profile.triggerModel,
          triggerPort: profile.triggerPort,
          triggerReference,
          completionReferences: motionPortReferencesForNode(
            node,
            profile.completionPorts,
            "output",
          ),
          activeReferences: motionPortReferencesForNode(
            node,
            profile.activePorts,
            "output",
          ),
          busyReferences: motionPortReferencesForNode(
            node,
            profile.busyPorts,
            "output",
          ),
          faultReferences: motionPortReferencesForNode(
            node,
            profile.faultPorts,
            "output",
          ),
          abortedReferences: motionPortReferencesForNode(
            node,
            profile.abortedPorts,
            "output",
          ),
          locksAxisWhileTriggerTrue: profile.locksAxisWhileTriggerTrue,
      }];
    }),
  );

  return {
    axisReference: resolvedAxis.axisReference,
    resolution: resolvedAxis.resolution,
    commands,
    lockingStops: commands.filter(
      (command) => command.locksAxisWhileTriggerTrue,
    ),
  };
}

export function motionCommandProfileForBlockType(
  blockType: string,
): BusinessMotionCommandProfileConfig | undefined {
  const normalizedBlockType = normalizeBlockType(blockType);
  return BUSINESS_RULES_CONFIG.motionCommandProfiles.find((profile) =>
    profile.blockTypes.some(
      (configuredBlockType) =>
        normalizeBlockType(configuredBlockType) === normalizedBlockType,
    ),
  );
}

function resolveMotionAxisReference(
  focus: FocusContext,
): Pick<MotionAxisContext, "axisReference" | "resolution"> | undefined {
  const focusAxisReferences = uniqueMotionAxisReferences(
    focus.node ? [focus.node] : [],
  );
  if (focusAxisReferences.length === 1) {
    return {
      axisReference: focusAxisReferences[0],
      resolution: "focusPort",
    };
  }
  if (focusAxisReferences.length > 1) {
    return undefined;
  }

  const boundaryIds = focus.node
    ? [...focus.node.from, ...focus.node.to]
    : focus.insertionPoint
      ? [...focus.insertionPoint.from, ...focus.insertionPoint.to]
      : [];
  const boundaryNodes = boundaryIds
    .map((nodeId) => findNode(focus.segment, nodeId))
    .filter((node): node is DiagramNodeSummary => Boolean(node));
  const neighborAxisReferences = uniqueMotionAxisReferences(boundaryNodes);
  if (neighborAxisReferences.length === 1) {
    return {
      axisReference: neighborAxisReferences[0],
      resolution: "neighborPort",
    };
  }
  if (neighborAxisReferences.length > 1) {
    return undefined;
  }

  const segmentAxisReferences = uniqueMotionAxisReferences(
    focus.segment.nodes,
  );
  return segmentAxisReferences.length === 1
    ? {
        axisReference: segmentAxisReferences[0],
        resolution: "segmentUniquePort",
      }
    : undefined;
}

function uniqueMotionAxisReferences(nodes: DiagramNodeSummary[]): string[] {
  const references = new Map<string, string>();
  for (const node of nodes) {
    const axisReference = motionAxisReferenceForNode(node);
    const normalized = normalizeReference(axisReference);
    if (normalized && !references.has(normalized)) {
      references.set(normalized, axisReference.trim());
    }
  }
  return [...references.values()];
}

function motionAxisReferenceForNode(node: DiagramNodeSummary): string {
  const axisPort = [...(node.inputPorts ?? []), ...(node.outputPorts ?? [])].find(
    (port) =>
      port.name.trim().toUpperCase() === "AXIS" &&
      hasTypeCapability(
        new Set([normalizeDataType(port.type)]),
        "MOTION_AXIS_REFERENCE",
      ),
  );
  return normalizeReference(axisPort?.value) ? axisPort?.value.trim() ?? "" : "";
}

function motionPortReferencesForNode(
  node: DiagramNodeSummary,
  portNames: string[],
  direction: "input" | "output",
): string[] {
  const normalizedPortNames = new Set(
    portNames.map((portName) => portName.trim().toUpperCase()),
  );
  return uniqueDisplayNames(
    (direction === "input" ? node.inputPorts ?? [] : node.outputPorts ?? [])
      .filter((port) => normalizedPortNames.has(port.name.trim().toUpperCase()))
      .map((port) => port.value)
      .filter((reference) => normalizeReference(reference)),
  );
}

function findNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
): DiagramNodeSummary | undefined {
  return segment.nodes.find((node) => node.id === nodeId);
}

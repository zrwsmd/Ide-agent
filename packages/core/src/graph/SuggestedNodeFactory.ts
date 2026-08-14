import { getLibraryElement } from "./LibraryElementCatalog";
import type { LibraryElementInfo } from "./LibraryElementCatalog";
import type {
  LocalSuggestionAddElement,
  SuggestedGraphNode,
  SuggestedPort,
} from "./LocalSuggestionModels";

export interface LibraryPorts {
  portInputs: SuggestedPort[];
  portOutputs: SuggestedPort[];
}

export function createSuggestedNodeId(
  addElement: LocalSuggestionAddElement,
  suggestionId: string,
): string {
  if (addElement.nodeType === "functionBlock") {
    const prefix = addElement.isFunction ? "FUN" : "FBD";
    return `${prefix}-compartment-${addElement.blockType || "FB"}-${suggestionId}`;
  }

  return `${addElement.nodeType}-${suggestionId}`;
}

export function createSuggestedNode(
  nodeId: string,
  addElement: LocalSuggestionAddElement,
): SuggestedGraphNode {
  if (addElement.nodeType === "functionBlock") {
    const blockType = addElement.blockType.trim();
    const libraryElement = getLibraryElement(blockType);
    const libraryPorts = buildLibraryPorts(libraryElement);
    return {
      id: nodeId,
      type: "FBDCompartment",
      childrenNode: {
        type: blockType,
        isFunction: Boolean(addElement.isFunction),
        varName: {
          name: "",
          value:
            addElement.instanceName || addElement.variableName || "???",
          type: blockType,
          scope: "VAR",
        },
        portInputs:
          Array.isArray(addElement.portInputs) &&
          addElement.portInputs.length > 0
            ? addElement.portInputs
            : libraryPorts.portInputs,
        portOutputs:
          Array.isArray(addElement.portOutputs) &&
          addElement.portOutputs.length > 0
            ? addElement.portOutputs
            : libraryPorts.portOutputs,
      },
    };
  }

  return {
    id: nodeId,
    type: addElement.nodeType,
    varName: {
      name: "",
      value: addElement.variableName || "???",
      type: addElement.dataType || "BOOL",
      scope: addElement.variableScope || "VAR",
    },
  };
}

export function buildLibraryPorts(
  libraryElement: LibraryElementInfo | undefined,
): LibraryPorts {
  if (!libraryElement) {
    return { portInputs: [], portOutputs: [] };
  }

  const inputs = libraryElement.inputs ?? [];
  const outputs = libraryElement.outputs ?? [];

  const portInputs = inputs
    .filter((port) => !isSystemEnablePort(port, "EN"))
    .map((port) => {
      const suggestedPort = toLibraryPort(port, "VAR_INPUT");
      return hasMatchingLibraryPort(outputs, port)
        ? { ...suggestedPort, scope: "VAR_IN_OUT" }
        : suggestedPort;
    });
  const portOutputs = outputs
    .filter((port) => !isSystemEnablePort(port, "ENO"))
    .filter((port) => !hasMatchingLibraryPort(inputs, port))
    .map((port) => toLibraryPort(port, "VAR_OUTPUT"));

  return {
    portInputs: [createSystemEnablePort("EN"), ...portInputs],
    portOutputs: [createSystemEnablePort("ENO"), ...portOutputs],
  };
}

function isSystemEnablePort(
  [name]: [string, string, string],
  expectedName: "EN" | "ENO",
): boolean {
  return name.trim().toUpperCase() === expectedName;
}

function createSystemEnablePort(name: "EN" | "ENO"): SuggestedPort {
  return { name, value: "", type: "", scope: "" };
}

function hasMatchingLibraryPort(
  ports: Array<[string, string, string]>,
  candidate: [string, string, string],
): boolean {
  const [candidateName, candidateType] = candidate;
  return ports.some(
    ([name, type]) => name === candidateName && type === candidateType,
  );
}

function toLibraryPort(
  [name, type, scope]: [string, string, string],
  defaultScope: string,
): SuggestedPort {
  return {
    name,
    value: name === "EN" || name === "ENO" ? "" : "???",
    type,
    scope: scope && scope !== "none" ? scope : defaultScope,
  };
}

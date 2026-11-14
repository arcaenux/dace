import { RelationType } from "./types";

export interface RelationTypeMeta {
  value: RelationType;
  label: string;
  outgoingLabel: string;
  incomingLabel: string;
  description: string;
}

export const RELATION_TYPES: RelationTypeMeta[] = [
  {
    value: "related_to",
    label: "Related to",
    outgoingLabel: "Related to",
    incomingLabel: "Related to",
    description: "General conceptual association or shared context",
  },
  {
    value: "builds_on",
    label: "Builds on",
    outgoingLabel: "Builds on",
    incomingLabel: "Extended by",
    description: "Extends, deepens, or elaborates this concept",
  },
  {
    value: "depends_on",
    label: "Depends on",
    outgoingLabel: "Depends on",
    incomingLabel: "Prerequisite for",
    description: "Requires this foundation or logical prerequisite",
  },
  {
    value: "explains",
    label: "Explains",
    outgoingLabel: "Explains",
    incomingLabel: "Explained by",
    description: "Clarifies or details the mechanics of this concept",
  },
  {
    value: "example_of",
    label: "Example of",
    outgoingLabel: "Example of",
    incomingLabel: "Instantiated by",
    description: "Concrete instantiation, case study, or demonstration",
  },
  {
    value: "part_of",
    label: "Part of",
    outgoingLabel: "Part of",
    incomingLabel: "Contains part",
    description: "Constituent element, component, or sub-topic",
  },
  {
    value: "contrasts_with",
    label: "Contrasts with",
    outgoingLabel: "Contrasts with",
    incomingLabel: "Contrasts with",
    description: "Alternative perspective, distinction, or counter-argument",
  },
  {
    value: "applies_to",
    label: "Applies to",
    outgoingLabel: "Applies to",
    incomingLabel: "Applied from",
    description: "Direct practical, domain, or experimental application",
  },
];

export function getRelationMeta(typeString: string): RelationTypeMeta {
  const found = RELATION_TYPES.find((r) => r.value === typeString);
  if (found) return found;

  const pretty = typeString.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    value: typeString as RelationType,
    label: pretty,
    outgoingLabel: pretty,
    incomingLabel: pretty,
    description: "",
  };
}

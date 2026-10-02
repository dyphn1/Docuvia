import {
  SYSTEM1_AMBIGUITY_CLASSES,
  SYSTEM1_AMBIGUITY_CLASS_ORDER,
  SYSTEM1_DI_LOOKUP_METHODS,
  SYSTEM1_DI_RECEIVER_NAMES,
  SYSTEM1_EVIDENCE_STATUSES,
  SYSTEM1_FACTORY_NAME_PREFIXES,
  SYSTEM1_FACTORY_NAME_SUFFIXES,
  SYSTEM1_UNRESOLVED_RECEIVER_MAX_CANDIDATES,
  SYSTEM1_UNRESOLVED_RECEIVER_MIN_CANDIDATES,
} from "./system1-constants.js";
import type {
  System1AmbiguityClass,
  System1AmbiguityEvidence,
} from "./system1-types.js";

type DetectionStatus = "detected" | "not-detected" | "unknown";
interface Detection {
  readonly ambiguityClass: System1AmbiguityClass;
  readonly status: DetectionStatus;
}
type Detector = (evidence: System1AmbiguityEvidence) => Detection | null;

function result(
  ambiguityClass: System1AmbiguityClass,
  status: DetectionStatus,
): Detection {
  return { ambiguityClass, status };
}

function includesFolded(values: readonly string[], value: string): boolean {
  const folded = value.toLowerCase();
  return values.some((candidate) => candidate.toLowerCase() === folded);
}

function factoryLike(name: string): boolean {
  const folded = name.toLowerCase();
  return (
    SYSTEM1_FACTORY_NAME_PREFIXES.some((prefix) => folded.startsWith(prefix)) ||
    SYSTEM1_FACTORY_NAME_SUFFIXES.some((suffix) => folded.endsWith(suffix))
  );
}

function isRegistryLookup(evidence: System1AmbiguityEvidence): boolean {
  const { calleeName, receiverName } = evidence.call;
  return (
    receiverName !== null &&
    includesFolded(SYSTEM1_DI_RECEIVER_NAMES, receiverName) &&
    includesFolded(SYSTEM1_DI_LOOKUP_METHODS, calleeName)
  );
}

function detectRenamedImport(
  evidence: System1AmbiguityEvidence,
): Detection | null {
  const binding = evidence.importBinding;
  if (!binding || binding.kind !== "named") return null;
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.ALIAS_RENAMED_IMPORT,
    binding.local === binding.imported ? "not-detected" : "detected",
  );
}

function detectBarrel(evidence: System1AmbiguityEvidence): Detection | null {
  const binding = evidence.importBinding;
  if (!binding) return null;
  if (binding.barrelStatus === "unresolved")
    return result(SYSTEM1_AMBIGUITY_CLASSES.BARREL_REEXPORT, "unknown");
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.BARREL_REEXPORT,
    binding.barrelStatus === "yes" ? "detected" : "not-detected",
  );
}

function detectPathAlias(evidence: System1AmbiguityEvidence): Detection | null {
  const binding = evidence.importBinding;
  if (!binding) return null;
  if (binding.pathAlias === null)
    return result(SYSTEM1_AMBIGUITY_CLASSES.PATH_ALIAS, "unknown");
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.PATH_ALIAS,
    binding.pathAlias ? "detected" : "not-detected",
  );
}

function detectGenericFactory(
  evidence: System1AmbiguityEvidence,
): Detection | null {
  const { calleeName, genericTypeArguments } = evidence.call;
  if (!factoryLike(calleeName)) return null;
  if (genericTypeArguments === null)
    return result(SYSTEM1_AMBIGUITY_CLASSES.GENERIC_FACTORY, "unknown");
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.GENERIC_FACTORY,
    genericTypeArguments.length > 0 ? "detected" : "not-detected",
  );
}

function detectOverloads(evidence: System1AmbiguityEvidence): Detection | null {
  if (
    evidence.candidates.some(
      (candidate) =>
        candidate.overloadCount !== null && candidate.overloadCount > 1,
    )
  )
    return result(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS, "detected");
  if (
    evidence.candidates.some(
      (candidate) =>
        candidate.evidenceStatus === SYSTEM1_EVIDENCE_STATUSES.PRESENT &&
        candidate.overloadCount === null,
    )
  )
    return result(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS, "unknown");
  return evidence.candidates.length > 0
    ? result(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS, "not-detected")
    : null;
}

function detectFluentCall(
  evidence: System1AmbiguityEvidence,
): Detection | null {
  if (evidence.call.fluentChain === null)
    return result(SYSTEM1_AMBIGUITY_CLASSES.FLUENT_CHAINED_CALL, "unknown");
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.FLUENT_CHAINED_CALL,
    evidence.call.fluentChain ? "detected" : "not-detected",
  );
}

function detectRegistryLookup(
  evidence: System1AmbiguityEvidence,
): Detection | null {
  const receiverCouldBeRegistry =
    evidence.call.receiverName !== null &&
    includesFolded(SYSTEM1_DI_RECEIVER_NAMES, evidence.call.receiverName);
  if (!receiverCouldBeRegistry) return null;
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.DI_REGISTRY_LOOKUP,
    isRegistryLookup(evidence) ? "detected" : "not-detected",
  );
}

function detectRuntimeToken(
  evidence: System1AmbiguityEvidence,
): Detection | null {
  if (!isRegistryLookup(evidence)) return null;
  const args = evidence.call.stringLiteralArguments;
  if (args === null)
    return result(SYSTEM1_AMBIGUITY_CLASSES.RUNTIME_STRING_TOKEN, "unknown");
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.RUNTIME_STRING_TOKEN,
    args.length > 0 ? "detected" : "not-detected",
  );
}

function detectComputedImport(evidence: System1AmbiguityEvidence): Detection {
  const value = evidence.call.boundedComputedImport;
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.COMPUTED_BOUNDED_IMPORT,
    value === null ? "unknown" : value ? "detected" : "not-detected",
  );
}

function detectFrameworkConvention(
  evidence: System1AmbiguityEvidence,
): Detection {
  const value = evidence.call.frameworkConvention;
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.FRAMEWORK_CONVENTION,
    value === null ? "unknown" : value ? "detected" : "not-detected",
  );
}

function mayHaveUnresolvedReceiver(
  evidence: System1AmbiguityEvidence,
): boolean {
  const { call, candidates } = evidence;
  const memberCall =
    call.kind === "member" || call.kind === "this" || call.kind === "arg-chain";
  const smallSet =
    candidates.length >= SYSTEM1_UNRESOLVED_RECEIVER_MIN_CANDIDATES &&
    candidates.length <= SYSTEM1_UNRESOLVED_RECEIVER_MAX_CANDIDATES;
  return memberCall && smallSet && !isRegistryLookup(evidence);
}

function receiverBindingUnknown(evidence: System1AmbiguityEvidence): boolean {
  return evidence.call.receiverTypeKnown === null;
}

function detectUnresolvedReceiver(
  evidence: System1AmbiguityEvidence,
): Detection | null {
  if (!mayHaveUnresolvedReceiver(evidence)) return null;
  if (receiverBindingUnknown(evidence))
    return result(
      SYSTEM1_AMBIGUITY_CLASSES.UNRESOLVED_RECEIVER_SMALL_SET,
      "unknown",
    );
  const { receiverTypeKnown, receiverImported } = evidence.call;
  const unresolved = !receiverTypeKnown && !receiverImported;
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.UNRESOLVED_RECEIVER_SMALL_SET,
    unresolved ? "detected" : "not-detected",
  );
}

function detectGeneratedWrapper(
  evidence: System1AmbiguityEvidence,
): Detection | null {
  if (evidence.candidates.length === 0) return null;
  if (
    evidence.candidates.some(
      (candidate) =>
        candidate.generatedMarker === true ||
        candidate.forwardingWrapper === true,
    )
  )
    return result(
      SYSTEM1_AMBIGUITY_CLASSES.GENERATED_WRAPPER_FACADE,
      "detected",
    );
  if (
    evidence.candidates.some(
      (candidate) =>
        candidate.evidenceStatus === SYSTEM1_EVIDENCE_STATUSES.PRESENT &&
        (candidate.generatedMarker === null ||
          candidate.forwardingWrapper === null),
    )
  )
    return result(
      SYSTEM1_AMBIGUITY_CLASSES.GENERATED_WRAPPER_FACADE,
      "unknown",
    );
  return result(
    SYSTEM1_AMBIGUITY_CLASSES.GENERATED_WRAPPER_FACADE,
    "not-detected",
  );
}

const DETECTORS: readonly Detector[] = [
  detectRenamedImport,
  detectBarrel,
  detectPathAlias,
  detectGenericFactory,
  detectOverloads,
  detectFluentCall,
  detectRegistryLookup,
  detectFrameworkConvention,
  detectComputedImport,
  detectRuntimeToken,
  detectUnresolvedReceiver,
  detectGeneratedWrapper,
];

/** Detector gaps stay explicit; only fully observed negative evidence is tagged other/plain. */
export function classifySystem1Ambiguities(
  evidence: System1AmbiguityEvidence,
): {
  readonly tags: readonly System1AmbiguityClass[];
  readonly notDetected: readonly System1AmbiguityClass[];
} {
  const detected = new Set<System1AmbiguityClass>();
  const unknown = new Set<System1AmbiguityClass>();
  for (const detector of DETECTORS) {
    const detection = detector(evidence);
    if (!detection) continue;
    if (detection.status === "detected") detected.add(detection.ambiguityClass);
    if (detection.status === "unknown") unknown.add(detection.ambiguityClass);
  }
  if (detected.size === 0 && unknown.size === 0)
    detected.add(SYSTEM1_AMBIGUITY_CLASSES.OTHER_PLAIN);
  return {
    tags: SYSTEM1_AMBIGUITY_CLASS_ORDER.filter((value) => detected.has(value)),
    notDetected: SYSTEM1_AMBIGUITY_CLASS_ORDER.filter((value) =>
      unknown.has(value),
    ),
  };
}

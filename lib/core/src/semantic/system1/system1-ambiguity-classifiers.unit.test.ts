import { describe, expect, it } from "vitest";
import { SYSTEM1_AMBIGUITY_CLASSES } from "./system1-constants.js";
import { classifySystem1Ambiguities } from "./system1-ambiguity-classifiers.js";
import type {
  System1AmbiguityEvidence,
  System1CandidateInput,
} from "./system1-types.js";

const candidate: System1CandidateInput = {
  id: "tierA:aaaaaaaaaaaaaaaa",
  targetId: "src/target.ts#run",
  tierARank: 1,
  tierAEvidence: "tier-a-imports-file",
  evidenceStatus: "present",
  declarationKind: "function",
  signatureSnippet: "function run(): void",
  overloadCount: 1,
  generatedMarker: false,
  forwardingWrapper: false,
};

const evidence: System1AmbiguityEvidence = {
  call: {
    calleeName: "run",
    kind: "bare",
    receiverName: null,
    receiverLocallyBound: false,
    receiverImported: false,
    receiverTypeKnown: false,
    fluentChain: false,
    genericTypeArguments: [],
    stringLiteralArguments: [],
    namespaceCall: false,
    boundedComputedImport: false,
    frameworkConvention: false,
  },
  importBinding: null,
  candidates: [candidate],
};

describe("System-1 ambiguity class detectors", () => {
  it("[happy] detects renamed imports, re-export barrels and configured path aliases", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      importBinding: {
        kind: "named",
        local: "localRun",
        imported: "run",
        sourceSpecifier: "@app/index",
        barrelStatus: "yes",
        pathAlias: true,
      },
    });

    expect(result.tags).toEqual(
      expect.arrayContaining([
        SYSTEM1_AMBIGUITY_CLASSES.ALIAS_RENAMED_IMPORT,
        SYSTEM1_AMBIGUITY_CLASSES.BARREL_REEXPORT,
        SYSTEM1_AMBIGUITY_CLASSES.PATH_ALIAS,
      ]),
    );
  });

  it("[happy] detects generic factories, overloads and fluent calls from syntax evidence", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      call: {
        ...evidence.call,
        calleeName: "createClient",
        kind: "member",
        fluentChain: true,
        genericTypeArguments: ["ClientOptions"],
      },
      candidates: [{ ...candidate, overloadCount: 2 }],
    });

    expect(result.tags).toEqual(
      expect.arrayContaining([
        SYSTEM1_AMBIGUITY_CLASSES.GENERIC_FACTORY,
        SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS,
        SYSTEM1_AMBIGUITY_CLASSES.FLUENT_CHAINED_CALL,
      ]),
    );
  });

  it("[happy] detects registry tokens, bounded imports and unresolved receivers conservatively", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      call: {
        ...evidence.call,
        calleeName: "get",
        kind: "member",
        receiverName: "container",
        stringLiteralArguments: ["UserService"],
        boundedComputedImport: true,
      },
    });

    expect(result.tags).toEqual(
      expect.arrayContaining([
        SYSTEM1_AMBIGUITY_CLASSES.DI_REGISTRY_LOOKUP,
        SYSTEM1_AMBIGUITY_CLASSES.RUNTIME_STRING_TOKEN,
        SYSTEM1_AMBIGUITY_CLASSES.COMPUTED_BOUNDED_IMPORT,
      ]),
    );
  });

  it("[happy] detects an unbound member receiver when its Tier A set is small", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      call: {
        ...evidence.call,
        kind: "member",
        receiverName: "remoteHandler",
      },
      candidates: [candidate, { ...candidate, id: "tierA:bbbbbbbbbbbbbbbb" }],
    });

    expect(result.tags).toContain(
      SYSTEM1_AMBIGUITY_CLASSES.UNRESOLVED_RECEIVER_SMALL_SET,
    );
  });

  it("[boundary] does not mark a single-candidate receiver unresolved", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      call: { ...evidence.call, kind: "member", receiverName: "remoteHandler" },
    });
    expect(result.tags).not.toContain(
      SYSTEM1_AMBIGUITY_CLASSES.UNRESOLVED_RECEIVER_SMALL_SET,
    );
  });

  it("[happy] detects framework conventions and generated forwarding wrappers", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      call: { ...evidence.call, frameworkConvention: true },
      candidates: [
        { ...candidate, generatedMarker: true, forwardingWrapper: true },
      ],
    });

    expect(result.tags).toEqual(
      expect.arrayContaining([
        SYSTEM1_AMBIGUITY_CLASSES.FRAMEWORK_CONVENTION,
        SYSTEM1_AMBIGUITY_CLASSES.GENERATED_WRAPPER_FACADE,
      ]),
    );
  });

  it("[negative] assigns other/plain only when no supported detector fires", () => {
    const result = classifySystem1Ambiguities(evidence);

    expect(result.tags).toEqual([SYSTEM1_AMBIGUITY_CLASSES.OTHER_PLAIN]);
    expect(result.notDetected).toEqual([]);
  });

  it("[error-handling] [boundary] reports unresolved barrel evidence as not-detected, not as a guessed class", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      importBinding: {
        kind: "named",
        local: "run",
        imported: "run",
        sourceSpecifier: "@app/run",
        barrelStatus: "unresolved",
        pathAlias: false,
      },
    });

    expect(result.tags).toEqual([]);
    expect(result.notDetected).toEqual([
      SYSTEM1_AMBIGUITY_CLASSES.BARREL_REEXPORT,
    ]);
  });

  it("[invalid-input] keeps a class unknown instead of tagging other/plain when its evidence is missing", () => {
    const result = classifySystem1Ambiguities({
      ...evidence,
      call: { ...evidence.call, fluentChain: null },
    });

    expect(result).toEqual({
      tags: [],
      notDetected: [SYSTEM1_AMBIGUITY_CLASSES.FLUENT_CHAINED_CALL],
    });
  });
});

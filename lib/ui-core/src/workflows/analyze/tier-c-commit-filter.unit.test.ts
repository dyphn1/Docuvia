import { describe, it, expect } from "vitest";
import { shouldEnqueueCommitMessage } from "./tier-c-commit-filter.js";

describe("shouldEnqueueCommitMessage() (§9e, E4)", () => {
  describe("denylisted conventional-commit types -- drop", () => {
    for (const type of ["chore", "style", "ci", "build", "docs", "test"]) {
      it(`drops a "${type}:" subject`, () => {
        expect(
          shouldEnqueueCommitMessage(`${type}: update something long enough`),
        ).toBe(false);
      });
    }

    it("drops a denylisted type with a scope", () => {
      expect(
        shouldEnqueueCommitMessage("chore(deps): bump a dependency version"),
      ).toBe(false);
    });
  });

  describe("junk-subject regex -- drop", () => {
    for (const subject of [
      "wip on the new feature",
      "fixup! previous commit",
      "squash! previous commit",
      "typo in readme file",
      "lint fixes across the repo",
      "format the whole codebase",
      "merge branch 'main' into feature",
    ]) {
      it(`drops "${subject}"`, () => {
        expect(shouldEnqueueCommitMessage(subject)).toBe(false);
      });
    }

    it("is case-insensitive", () => {
      expect(shouldEnqueueCommitMessage("WIP: still working on this")).toBe(
        false,
      );
    });
  });

  describe("length floor -- drop", () => {
    it("drops a subject under the length floor after stripping the type prefix", () => {
      expect(shouldEnqueueCommitMessage("fix: too short")).toBe(false);
    });

    it("drops a short subject with no conventional-commit prefix at all", () => {
      expect(shouldEnqueueCommitMessage("small fix")).toBe(false);
    });
  });

  describe("keep cases", () => {
    it("keeps a substantive conventional-commit subject not in the denylist", () => {
      expect(
        shouldEnqueueCommitMessage(
          "feat: add budgeted Tier C decision-extraction queue",
        ),
      ).toBe(true);
    });

    it("keeps a substantive subject with no conventional-commit prefix", () => {
      expect(
        shouldEnqueueCommitMessage(
          "Switch the escalation batch to drain both queues",
        ),
      ).toBe(true);
    });

    it("only inspects the first line (subject), ignoring the body", () => {
      expect(
        shouldEnqueueCommitMessage(
          "feat: add the tiered decision queue\n\nBody with more detail here.",
        ),
      ).toBe(true);
    });

    it("honors a config-overridden denylist", () => {
      expect(
        shouldEnqueueCommitMessage("feat: add a substantive feature here", {
          denylistTypes: new Set(["feat"]),
        }),
      ).toBe(false);
    });

    it("honors a config-overridden minimum subject length", () => {
      expect(
        shouldEnqueueCommitMessage("fix: ok", { minSubjectLength: 2 }),
      ).toBe(true);
    });
  });
});

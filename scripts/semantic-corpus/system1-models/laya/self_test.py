"""Dataset-free unit tests for the Laya System-1 adapter contracts."""

from __future__ import annotations

import json
import unittest

from adapter import build_event_targets, encode_example
from laya_constants import (
    CONTROL_UNKNOWN_ID,
    CONTROL_VERIFY_ID,
    DEFAULT_OUTPUT_DIRECTORY,
    MAX_PROCESS_RSS_BYTES,
)
from resource_budget import check_resource_budget
from score import success_response
from train import (
    DEFAULT_SMOKE_REPORT,
    _fit_projection,
    assert_fold_isolation,
    fold_training_plan,
    independent_event_loss,
)


def make_state() -> dict:
    return {
        "request": {
            "requestId": "system1:test-request",
            "evidence": {"repoId": "github.com/acme/widget"},
            "context": {
                "text": json.dumps(
                    {
                        "importBinding": {"kind": "named", "sourceSpecifier": "./worker"},
                        "caller": {"filePath": "src/caller.ts", "symbol": "run"},
                        "call": {"kind": "member", "expression": "worker.run()"},
                    }
                )
            },
            "options": [
                {
                    "id": "tierA:one",
                    "kind": "candidate",
                    "text": "run(): void",
                    "attributes": {"targetId": "src/worker.ts#run", "tierARank": 0},
                },
                {
                    "id": "tierA:two",
                    "kind": "candidate",
                    "text": "runAsync(): Promise<void>",
                    "attributes": {"targetId": "src/worker.ts#runAsync", "tierARank": 1},
                },
                {
                    "id": "tierA:three",
                    "kind": "candidate",
                    "text": "dispatch(): void",
                    "attributes": {"targetId": "src/worker.ts#dispatch", "tierARank": 2},
                },
                {"id": CONTROL_UNKNOWN_ID, "kind": "unknown", "text": "unknown"},
                {"id": CONTROL_VERIFY_ID, "kind": "verify", "text": "verify"},
            ],
        }
    }


def make_labels(**overrides) -> dict:
    labels = {
        "requestId": "system1:test-request",
        "positiveTargetIds": ["src/worker.ts#run"],
        "negativeTargetIds": ["src/worker.ts#runAsync"],
        "candidateMiss": False,
        "reviewStatus": "confirmed",
        "oracleStatus": "resolved",
    }
    labels.update(overrides)
    return labels


class AdapterContractTest(unittest.TestCase):
    def test_reuses_state_only_cua_encoding_and_rejects_label_fields(self) -> None:
        state = make_state()

        encoded = encode_example(state)

        self.assertEqual(
            encoded.option_ids,
            ("tierA:one", "tierA:two", "tierA:three", CONTROL_UNKNOWN_ID, CONTROL_VERIFY_ID),
        )
        self.assertIn("./worker", encoded.context)
        with self.assertRaisesRegex(ValueError, "label-only field is forbidden"):
            encode_example({**state, "labels": {"positiveTargetIds": []}})

    def test_candidate_targets_mask_nonpositives_and_controls_use_v1_labels(self) -> None:
        targets = build_event_targets(make_state()["request"], make_labels())

        self.assertEqual(targets.candidate_mask, (True, True, True, False, False))
        self.assertEqual(targets.candidate_targets, (1.0, 0.0, 0.0, 0.0, 0.0))
        self.assertEqual(targets.candidate_weights, (1.0, 1.0, 0.0, 0.0, 0.0))
        self.assertEqual(targets.control_targets, (0.0, 0.0, 0.0, 0.0, 0.0))
        self.assertEqual(targets.control_weights, (0.0, 0.0, 0.0, 1.0, 1.0))

    def test_candidate_miss_keeps_known_negative_and_sets_both_controls(self) -> None:
        labels = make_labels(
            positiveTargetIds=["src/missing.ts#call"],
            candidateMiss=True,
        )

        targets = build_event_targets(make_state()["request"], labels)

        self.assertEqual(targets.candidate_targets, (0.0, 0.0, 0.0, 0.0, 0.0))
        self.assertEqual(targets.candidate_weights, (0.0, 1.0, 0.0, 0.0, 0.0))
        self.assertEqual(targets.control_targets, (0.0, 0.0, 0.0, 1.0, 1.0))
        self.assertEqual(targets.control_weights, (0.0, 0.0, 0.0, 1.0, 1.0))

    def test_untrusted_rows_have_zero_candidate_and_control_weight(self) -> None:
        targets = build_event_targets(
            make_state()["request"], make_labels(reviewStatus="needs-review")
        )

        self.assertFalse(any(targets.candidate_weights))
        self.assertFalse(any(targets.control_weights))


class FoldIsolationTest(unittest.TestCase):
    def test_each_fold_excludes_its_family_and_full_model_uses_all_families(self) -> None:
        families = ["a/one", "b/two", "c/three"]

        plan = fold_training_plan(families)
        assert_fold_isolation(plan, families)

        self.assertEqual(plan["foldTrainingFamilies"]["b/two"], ["a/one", "c/three"])
        self.assertEqual(plan["heldOutTrainingFamilies"], sorted(families))

    def test_fold_isolation_rejects_a_self_trained_fold(self) -> None:
        invalid = {
            "foldTrainingFamilies": {
                "a/one": ["a/one", "b/two"],
                "b/two": ["a/one"],
            },
            "heldOutTrainingFamilies": ["a/one", "b/two"],
        }

        with self.assertRaisesRegex(ValueError, "includes its held-out family"):
            assert_fold_isolation(invalid, ["a/one", "b/two"])

    def test_masked_candidate_logits_have_zero_loss_contribution(self) -> None:
        import torch

        candidate_targets = torch.tensor([1.0, 0.0, 0.0, 0.0])
        candidate_weights = torch.tensor([1.0, 1.0, 0.0, 0.0])
        no_control_targets = torch.zeros(4)
        no_control_weights = torch.zeros(4)
        first = independent_event_loss(
            torch.tensor([0.2, -0.3, 12.0, 0.0]),
            candidate_targets,
            candidate_weights,
            no_control_targets,
            no_control_weights,
        )
        second = independent_event_loss(
            torch.tensor([0.2, -0.3, -12.0, 0.0]),
            candidate_targets,
            candidate_weights,
            no_control_targets,
            no_control_weights,
        )

        self.assertAlmostEqual(float(first), float(second), places=7)


class ProtocolResponseTest(unittest.TestCase):
    def test_response_keeps_raw_independent_option_scores_and_fold_provenance(self) -> None:
        encoded = encode_example(make_state())

        response = success_response(
            "system1:test-request", encoded, (0.91, 0.22, 0.08, 0.75, 0.95), "acme/widget"
        )

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["scoreKind"], "raw")
        self.assertEqual(response["foldFamily"], "acme/widget")
        self.assertEqual(response["scores"]["tierA:one"], 0.91)
        self.assertEqual(response["scores"][CONTROL_UNKNOWN_ID], 0.75)
        self.assertEqual(response["scores"][CONTROL_VERIFY_ID], 0.95)
        self.assertEqual(set(response), {"requestId", "status", "scoreKind", "scores", "foldFamily"})


class ResourceGuardTest(unittest.TestCase):
    def test_rss_limit_is_hard_and_free_memory_floor_is_hard(self) -> None:
        with self.assertRaisesRegex(MemoryError, "RSS exceeded"):
            check_resource_budget("unit-test", rss_bytes=MAX_PROCESS_RSS_BYTES + 1, free_percent=80)
        with self.assertRaisesRegex(MemoryError, "fell below 25%"):
            check_resource_budget("unit-test", rss_bytes=1, free_percent=24)


class TrainingProjectionPathTest(unittest.TestCase):
    def test_default_smoke_projection_matches_default_training_output(self) -> None:
        self.assertEqual(DEFAULT_SMOKE_REPORT, DEFAULT_OUTPUT_DIRECTORY / "training-projection.json")

    def test_smoke_projection_selects_frozen_encoder_when_full_finetune_hits_rss_cap(self) -> None:
        smoke = {
            "featureExtraction": {
                "eventCount": 1024,
                "elapsedSeconds": 31.0,
                "peakRssBytes": 2_784_034_816,
            },
            "headTraining": {"weightedEvents": 500, "elapsedSeconds": 0.04},
            "modelLoadSeconds": 3.0,
            "modelParameterCount": 306_939_648,
            "modelLayerCount": 22,
        }
        counts = {
            "candidateOptions": 100,
            "protocolControls": 50,
            "families": {
                "a/one": {"trainableEvents": 40},
                "b/two": {"trainableEvents": 20},
            },
        }

        projection = _fit_projection(smoke, counts, ["a/one", "b/two"])

        self.assertTrue(projection["fullFineTuneRejectedByRssCap"])
        self.assertGreater(
            projection["fullFineTuneConservativeProcessFloorBytes"],
            projection["processRssCapBytes"],
        )
        self.assertLess(projection["estimatedFullNestedHours"], 10)


if __name__ == "__main__":
    unittest.main()

"""Small dataset-free contract tests for the CUA-S1 adapter."""

from __future__ import annotations

import unittest

import torch
from cua_s1.model import ChoiceExample, make_system

from adapter import EncodedExample, encode_example, is_trusted_label, training_targets
from audit_encoding import validate_audit_gate
from constants import (
    AUDIT_FILES_READ_FIELD,
    AUDIT_FILES_SHA256_FIELD,
    AUDIT_GATE_FIELD,
    AUDIT_GATE_PASSED_FIELD,
    AUDIT_OVERALL_FIELD,
    AUDIT_SCHEMA_FIELD,
    AUDIT_SPLITS_FIELD,
    AUDIT_TRAINING_STARTED_FIELD,
    DEFAULT_DATASET_DIRECTORY,
    ENCODING_AUDIT_SCHEMA,
    ENCODING_AUDIT_SPLITS,
    LABEL_FILE_SUFFIX,
    MAX_CONTEXT_BYTES,
    MAX_OPTION_BYTES,
    MODEL_CONFIG,
    STATE_FILE_SUFFIX,
    TORCH_THREADS,
    VERIFY_OPTION_ID,
    UNKNOWN_OPTION_ID,
)
from routed_model import RoutedModel
from score import success_response
from diagnostics import binary_auc
from router_feasibility import clopper_pearson_lower_bound, prefix_report
from train import (
    fold_training_plan,
    independent_event_losses,
    masked_top_option_indices,
    optional_mean,
)

torch.set_num_threads(TORCH_THREADS)
torch.set_num_interop_threads(1)
torch.use_deterministic_algorithms(True)


class AdapterContractTest(unittest.TestCase):
    def test_default_dataset_directory_uses_system1_state_v2(self) -> None:
        self.assertEqual(DEFAULT_DATASET_DIRECTORY.name, "system1-dataset-v2")

    def test_state_context_and_ordered_options_are_encoded(self) -> None:
        state = {
            "request": {
                "requestId": "system1:test",
                "evidence": {"repoId": "github.com/acme/widget"},
                "context": {
                    "text": (
                        '{"caller":{"filePath":"src/a.ts","symbol":"run"},'
                        '"call":{"expression":"worker.run()","kind":"member",'
                        '"receiverHint":"Worker","genericHints":[]},'
                        '"importBinding":{"kind":"named","local":"run",'
                        '"imported":"run","sourceSpecifier":"./worker",'
                        '"barrelStatus":"no","pathAlias":false}}'
                    )
                },
                "options": [
                    {
                        "id": "tierA:1",
                        "kind": "candidate",
                        "text": "run(): void",
                        "attributes": {
                            "targetId": "src/worker.ts#run",
                            "tierARank": 0,
                            "tierAEvidence": "tier-a-calls-edge",
                            "evidenceStatus": "present",
                            "declarationKind": "method",
                        },
                    },
                    {"id": UNKNOWN_OPTION_ID, "kind": "unknown", "text": "unknown"},
                    {"id": VERIFY_OPTION_ID, "kind": "verify", "text": "verify"},
                ],
            },
            "ambiguityClasses": ["other/plain"],
            "notDetectedClasses": [],
        }

        example = encode_example(state)

        self.assertIn("src/a.ts", example.context)
        self.assertIn("worker.run()", example.context)
        self.assertIn("./worker", example.context)
        self.assertLess(example.context.index("./worker"), example.context.index("caller=run"))
        self.assertLess(example.context.index("caller=run"), example.context.index("receiver=Worker"))
        self.assertLess(example.context.index("receiver=Worker"), example.context.index("call member"))
        self.assertLess(example.context.index("call member"), example.context.index("window="))
        self.assertLessEqual(len(example.context.encode("utf-8")), MAX_CONTEXT_BYTES)
        self.assertEqual(len(example.options), 3)
        self.assertTrue(example.options[0].startswith("r0 call m p "))
        self.assertLessEqual(len(example.options[0].encode("utf-8")), MAX_OPTION_BYTES)
        self.assertEqual(example.option_ids, ("tierA:1", UNKNOWN_OPTION_ID, VERIFY_OPTION_ID))

    def test_long_target_preserves_symbol_and_container_before_signature(self) -> None:
        state = {
            "request": {
                "requestId": "system1:long-target",
                "context": {
                    "text": (
                        '{"caller":{"filePath":"src/a.ts","symbol":"run"},'
                        '"call":{"expression":"run()","kind":"bare"},'
                        '"importBinding":{"kind":"named","local":"run","imported":"run",'
                        '"sourceSpecifier":"./run","barrelStatus":"no","pathAlias":false}}'
                    )
                },
                "options": [
                    {
                        "id": "tierA:long",
                        "kind": "candidate",
                        "text": "export function getStringifiedOpaqueToken(token: Token): string",
                        "attributes": {
                            "targetId": (
                                "packages/core/injector/opaque-key-factory/"
                                "deep-hashed-module-opaque-key-factory.ts#"
                                "DeepHashedModuleOpaqueKeyFactory.getStringifiedOpaqueToken"
                            ),
                            "tierARank": 0,
                            "tierAEvidence": "tier-a-calls-edge",
                            "evidenceStatus": "present",
                            "declarationKind": "method",
                        },
                    },
                    {"id": UNKNOWN_OPTION_ID, "kind": "unknown", "text": "unknown"},
                    {"id": VERIFY_OPTION_ID, "kind": "verify", "text": "verify"},
                ],
            }
        }

        encoded = encode_example(state)
        candidate = encoded.options[0]

        self.assertIn("#DeepHashedModuleOpaqueKeyFactory.getStringifiedOpaqueToken", candidate)
        self.assertIn("…", candidate)
        self.assertLessEqual(len(candidate.encode("utf-8")), MAX_OPTION_BYTES)

    def test_long_signature_uses_only_budget_after_complete_target_id(self) -> None:
        state = {
            "request": {
                "requestId": "system1:long-signature",
                "context": {
                    "text": (
                        '{"caller":{"filePath":"src/a.ts","symbol":"run"},'
                        '"call":{"expression":"run()","kind":"bare"}}'
                    )
                },
                "options": [
                    {
                        "id": "tierA:signature",
                        "kind": "candidate",
                        "text": "export function namedCall(argument: " + ("LongTypeName" * 40),
                        "attributes": {
                            "targetId": "src/very-short-file.ts#namedCall",
                            "tierARank": 1,
                            "tierAEvidence": "tier-a-same-name",
                            "evidenceStatus": "present",
                            "declarationKind": "function",
                        },
                    },
                    {"id": UNKNOWN_OPTION_ID, "kind": "unknown", "text": "unknown"},
                    {"id": VERIFY_OPTION_ID, "kind": "verify", "text": "verify"},
                ],
            }
        }

        candidate = encode_example(state).options[0]

        self.assertTrue(candidate.startswith("r1 name f p "))
        self.assertIn("src/very-short-file.ts#namedCall ", candidate)
        self.assertIn("export function namedCall", candidate)
        self.assertLessEqual(len(candidate.encode("utf-8")), MAX_OPTION_BYTES)

    def test_training_targets_mask_unconfirmed_negatives(self) -> None:
        request = {
            "options": [
                {"id": "tierA:1", "kind": "candidate", "attributes": {"targetId": "a#f"}},
                {"id": "tierA:2", "kind": "candidate", "attributes": {"targetId": "b#f"}},
                {"id": "tierA:3", "kind": "candidate", "attributes": {"targetId": "c#f"}},
                {"id": UNKNOWN_OPTION_ID, "kind": "unknown"},
                {"id": VERIFY_OPTION_ID, "kind": "verify"},
            ]
        }
        labels = {
            "positiveTargetIds": ["a#f"],
            "negativeTargetIds": ["c#f"],
            "reviewStatus": "confirmed",
            "oracleStatus": "resolved",
            "candidateMiss": False,
        }

        targets = training_targets(request, labels)
        self.assertEqual(targets.option_targets, (1.0, 0.0, 0.0, 0.0, 0.0))
        self.assertEqual(targets.option_weights, (1.0, 0.0, 1.0, 0.0, 0.0))
        self.assertEqual(targets.candidate_mask, (True, True, True, False, False))
        self.assertEqual(targets.routing_target, 1.0)

    def test_routing_target_requires_confirmed_nonempty_gold_fully_in_candidates(self) -> None:
        request = {
            "options": [
                {"id": "tierA:1", "kind": "candidate", "attributes": {"targetId": "a#f"}},
                {"id": UNKNOWN_OPTION_ID, "kind": "unknown"},
                {"id": VERIFY_OPTION_ID, "kind": "verify"},
            ]
        }
        labels = {
            "positiveTargetIds": ["a#f", "missing#target"],
            "negativeTargetIds": [],
            "reviewStatus": "confirmed",
            "oracleStatus": "resolved",
            "candidateMiss": True,
        }

        self.assertEqual(training_targets(request, labels).routing_target, 0.0)

        complete_labels = {
            **labels,
            "positiveTargetIds": ["a#f"],
            "candidateMiss": False,
        }
        self.assertEqual(training_targets(request, complete_labels).routing_target, 1.0)

        unconfirmed_labels = {**complete_labels, "reviewStatus": "unreviewed"}
        self.assertEqual(training_targets(request, unconfirmed_labels).routing_target, 0.0)

        empty_gold_labels = {
            **complete_labels,
            "positiveTargetIds": [],
            "negativeTargetIds": [],
        }
        empty_gold_targets = training_targets(request, empty_gold_labels)
        self.assertEqual(empty_gold_targets.routing_target, 0.0)
        self.assertTrue(is_trusted_label(empty_gold_labels))

    def test_routed_cua_heads_score_options_and_request_context(self) -> None:
        option_model, collator = make_system(MODEL_CONFIG, "cpu")
        model = RoutedModel(option_model, MODEL_CONFIG["width"])
        model.eval()
        examples = [
            ChoiceExample("call context", ("candidate evidence", "unknown", "verify"), 0),
            ChoiceExample("empty candidate context", ("unknown", "verify"), 0),
        ]

        with torch.inference_mode():
            option_logits, routing_logits = model(collator(examples))

        self.assertEqual(tuple(option_logits.shape), (2, 3))
        self.assertEqual(tuple(routing_logits.shape), (2,))
        self.assertTrue(torch.isfinite(option_logits[0, :3]).all())
        self.assertTrue(torch.isfinite(option_logits[1, :2]).all())
        self.assertTrue(torch.isfinite(routing_logits).all())

    def test_protocol_response_shape_composes_candidate_and_routing_probabilities(self) -> None:
        response = success_response(
            "system1:score-shape",
            EncodedExample(
                "context",
                ("candidate", "unknown", "verify"),
                ("tierA:1", UNKNOWN_OPTION_ID, VERIFY_OPTION_ID),
            ),
            (0.8, 0.3, 0.2),
            routing_probability=0.75,
            fold_family="acme/widget",
        )

        self.assertEqual(
            set(response),
            {"requestId", "status", "scoreKind", "scores", "foldFamily"},
        )
        self.assertEqual(response["requestId"], "system1:score-shape")
        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["scoreKind"], "raw")
        self.assertEqual(response["foldFamily"], "acme/widget")
        self.assertEqual(set(response["scores"]), {"tierA:1", UNKNOWN_OPTION_ID, VERIFY_OPTION_ID})
        self.assertEqual(response["scores"]["tierA:1"], 0.6)
        self.assertEqual(response["scores"][UNKNOWN_OPTION_ID], 0.3)
        self.assertEqual(response["scores"][VERIFY_OPTION_ID], 0.25)

    def test_fold_training_plan_excludes_each_held_out_family(self) -> None:
        families = ["acme/a", "acme/b", "acme/c"]
        plan = fold_training_plan(families)

        self.assertEqual(set(plan), set(families))
        for held_out, training_families in plan.items():
            self.assertNotIn(held_out, training_families)
            self.assertEqual(set(training_families), set(families) - {held_out})

    def test_routing_auc_handles_perfect_ranking_and_ties(self) -> None:
        self.assertEqual(binary_auc([(0.1, 0), (0.9, 1)]), 1.0)
        self.assertEqual(binary_auc([(0.5, 0), (0.5, 1)]), 0.5)
        self.assertIsNone(binary_auc([(0.1, 0), (0.2, 0)]))

    def test_empty_training_split_diagnostics_have_no_mean(self) -> None:
        self.assertIsNone(optional_mean(0.0, 0))
        self.assertEqual(optional_mean(1.5, 2), 0.75)

    def test_training_top1_diagnostic_ignores_batch_padding(self) -> None:
        logits = torch.tensor([[-2.0, -3.0, 0.0], [-1.0, 100.0, 100.0]])
        option_mask = torch.tensor([[True, True, False], [True, False, False]])

        selected = masked_top_option_indices(logits, option_mask)

        self.assertEqual(selected.tolist(), [0, 0])

    def test_candidate_loss_ignores_masked_options_while_routing_has_own_bce(self) -> None:
        targets = torch.tensor([[1.0, 0.0, 0.0]])
        weights = torch.tensor([[1.0, 0.0, 1.0]])
        option_mask = torch.tensor([[True, True, True]])
        routing_targets = torch.tensor([1.0])
        first_candidate_loss, routing_loss, *_ = independent_event_losses(
            torch.tensor([[0.0, 100.0, 0.0]]),
            torch.tensor([0.0]),
            targets,
            weights,
            option_mask,
            routing_targets,
        )
        second_candidate_loss, _, *_ = independent_event_losses(
            torch.tensor([[0.0, -100.0, 0.0]]),
            torch.tensor([0.0]),
            targets,
            weights,
            option_mask,
            routing_targets,
        )

        self.assertAlmostEqual(first_candidate_loss.item(), 0.693147, places=5)
        self.assertAlmostEqual(second_candidate_loss.item(), first_candidate_loss.item(), places=7)
        self.assertAlmostEqual(routing_loss.item(), 0.693147, places=5)

    def test_feasibility_bound_matches_p2_zero_error_rule(self) -> None:
        self.assertGreaterEqual(clopper_pearson_lower_bound(299, 299), 0.99)
        self.assertLess(clopper_pearson_lower_bound(298, 298), 0.99)
        self.assertAlmostEqual(clopper_pearson_lower_bound(95, 100), 0.8977, places=3)

    def test_feasibility_prefix_counts_rows_in_router_score_order(self) -> None:
        exact = [False] + [True] * 299
        scores = torch.tensor([0.0] + [1.0 - index / 1000 for index in range(299)], dtype=torch.float64)
        report = prefix_report(scores, exact, ["a"] * len(exact))
        self.assertEqual(report["largestCertifiablePrefixRows"]["0.99"], 299)
        self.assertEqual(report["prefixes"][0], {"rows": 50, "exactRows": 50, "lowerBound": round(0.05 ** (1 / 50), 6), "byFamily": {"a": "50/50"}})

    def test_scorer_state_rejects_label_fields(self) -> None:
        with self.assertRaisesRegex(ValueError, "label-only field"):
            encode_example({"request": {}, "labels": {"positiveTargetIds": ["x#f"]}})

    def test_training_gate_requires_passing_pool_audit_for_exact_input_files(self) -> None:
        files = [
            f"{split}{suffix}"
            for split in ENCODING_AUDIT_SPLITS
            for suffix in (STATE_FILE_SUFFIX, LABEL_FILE_SUFFIX)
        ]
        file_hashes = {name: f"hash-{index}" for index, name in enumerate(files)}
        passed_gate = {AUDIT_GATE_PASSED_FIELD: True}
        report = {
            AUDIT_SCHEMA_FIELD: ENCODING_AUDIT_SCHEMA,
            AUDIT_FILES_READ_FIELD: files,
            AUDIT_FILES_SHA256_FIELD: file_hashes,
            AUDIT_TRAINING_STARTED_FIELD: False,
            AUDIT_GATE_FIELD: passed_gate,
            AUDIT_OVERALL_FIELD: {AUDIT_GATE_FIELD: passed_gate},
            AUDIT_SPLITS_FIELD: {
                split: {AUDIT_GATE_FIELD: passed_gate}
                for split in ENCODING_AUDIT_SPLITS
            },
        }

        validate_audit_gate(report, file_hashes)
        with self.assertRaisesRegex(ValueError, "hashes do not match"):
            validate_audit_gate(report, {**file_hashes, files[0]: "stale"})


if __name__ == "__main__":
    unittest.main()

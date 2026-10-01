"""Small dataset-free contract tests for the CUA-S1 adapter."""

from __future__ import annotations

import unittest

import torch
from cua_s1.model import ChoiceExample, make_system

from adapter import encode_example, training_targets
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
from train import masked_top_option_indices

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

    def test_binary_targets_respect_candidate_misses(self) -> None:
        request = {
            "options": [
                {"id": "tierA:1", "kind": "candidate", "attributes": {"targetId": "a#f"}},
                {"id": UNKNOWN_OPTION_ID, "kind": "unknown"},
                {"id": VERIFY_OPTION_ID, "kind": "verify"},
            ]
        }
        labels = {
            "positiveTargetIds": ["a#f", "b#g"],
            "negativeTargetIds": [],
            "candidateMiss": True,
        }

        self.assertEqual(training_targets(request, labels), [1.0, 0.0, 1.0])

    def test_unknown_and_verify_are_positive_when_no_candidate_is_gold(self) -> None:
        request = {
            "options": [
                {"id": UNKNOWN_OPTION_ID, "kind": "unknown"},
                {"id": VERIFY_OPTION_ID, "kind": "verify"},
            ]
        }
        labels = {
            "positiveTargetIds": ["missing#target"],
            "negativeTargetIds": [],
            "candidateMiss": True,
        }

        self.assertEqual(training_targets(request, labels), [1.0, 1.0])

    def test_cua_model_scores_variable_options_as_independent_logits(self) -> None:
        model, collator = make_system(MODEL_CONFIG, "cpu")
        model.eval()
        examples = [
            ChoiceExample("call context", ("candidate evidence", "unknown", "verify"), 0),
            ChoiceExample("empty candidate context", ("unknown", "verify"), 0),
        ]

        with torch.inference_mode():
            scores = model(collator(examples))

        self.assertEqual(tuple(scores.shape), (2, 3))
        self.assertTrue(torch.isfinite(scores[0, :3]).all())
        self.assertTrue(torch.isfinite(scores[1, :2]).all())

    def test_training_top1_diagnostic_ignores_batch_padding(self) -> None:
        logits = torch.tensor([[-2.0, -3.0, 0.0], [-1.0, 100.0, 100.0]])
        option_mask = torch.tensor([[True, True, False], [True, False, False]])

        selected = masked_top_option_indices(logits, option_mask)

        self.assertEqual(selected.tolist(), [0, 0])

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

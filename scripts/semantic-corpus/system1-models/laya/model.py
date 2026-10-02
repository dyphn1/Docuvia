"""Frozen Laya/mmBERT encoder and independently trained option-scoring head."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import torch
from torch import nn

from laya_constants import HEAD_HIDDEN_SIZE, HIDDEN_SIZE, MAX_SEQUENCE_LENGTH
from resource_budget import check_resource_budget


@dataclass(frozen=True)
class EncoderSession:
    agent: object
    encoder: nn.Module
    tokenizer: object
    base_model_directory: Path
    device: torch.device


class OptionScoringHead(nn.Module):
    """A binary logit head applied independently to one context-option embedding."""

    def __init__(
        self,
        input_size: int = HIDDEN_SIZE,
        hidden_size: int = HEAD_HIDDEN_SIZE,
    ) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.LayerNorm(input_size),
            nn.Linear(input_size, hidden_size),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_size, 1),
        )

    def forward(self, embeddings: torch.Tensor) -> torch.Tensor:
        return self.layers(embeddings).squeeze(-1)


def load_encoder(base_model_directory: Path) -> EncoderSession:
    """Load the local Laya checkpoint and retain only its frozen text encoder for P4."""
    resolved = base_model_directory.expanduser().resolve()
    required_files = (
        resolved / "model.json",
        resolved / "rl_agent_config.json",
        resolved / "model.safetensors",
        resolved / "encoder" / "config.json",
        resolved / "tokenizer" / "tokenizer.json",
        resolved / "tokenizer" / "tokenizer_config.json",
    )
    missing = [str(path) for path in required_files if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Laya checkpoint is incomplete: {', '.join(missing)}")

    check_resource_budget("before loading Laya encoder")
    from laya.agent import Agent

    agent = Agent(str(resolved), device="cpu", compile=False, fast=False)
    agent.model.eval()
    encoder = agent.model.encoder.to(device="cpu", dtype=torch.float32)
    encoder.eval()
    for parameter in encoder.parameters():
        parameter.requires_grad_(False)
    check_resource_budget("after loading Laya encoder")
    return EncoderSession(
        agent=agent,
        encoder=encoder,
        tokenizer=agent.tok,
        base_model_directory=resolved,
        device=torch.device("cpu"),
    )


def mean_pool_hidden_states(
    hidden_states: torch.Tensor, attention_mask: torch.Tensor
) -> torch.Tensor:
    """Mean-pool non-padding encoder states, matching the Laya checkpoint pooling config."""
    weights = attention_mask.unsqueeze(-1).to(hidden_states.dtype)
    summed = (hidden_states * weights).sum(dim=1)
    denominator = weights.sum(dim=1).clamp_min(1.0)
    return summed / denominator


def encode_text_pairs(
    session: EncoderSession,
    contexts: Sequence[str],
    options: Sequence[str],
    *,
    max_length: int = MAX_SEQUENCE_LENGTH,
) -> torch.Tensor:
    """Return frozen mean-pooled features for state/option pairs without reading labels."""
    if len(contexts) != len(options):
        raise ValueError("context and option batches must have equal lengths")
    if not contexts:
        return torch.empty((0, HIDDEN_SIZE), dtype=torch.float32)
    if max_length < 8:
        raise ValueError("max_length must retain room for a context-option pair")
    encoded = session.tokenizer(
        list(contexts),
        list(options),
        padding=True,
        truncation="only_first",
        max_length=max_length,
        return_tensors="pt",
    )
    input_ids = encoded["input_ids"].to(session.device)
    attention_mask = encoded["attention_mask"].to(session.device)
    with torch.inference_mode():
        outputs = session.encoder(input_ids=input_ids, attention_mask=attention_mask)
        pooled = mean_pool_hidden_states(outputs.last_hidden_state, attention_mask)
    return pooled.to(device="cpu", dtype=torch.float32)

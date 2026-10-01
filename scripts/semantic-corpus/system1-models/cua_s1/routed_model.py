"""A small request-routing head wrapped around the pinned CUA-S1 option model."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file, save_file
from torch import nn


ROUTING_HEAD_SCHEMA = "cua-s1-routing-head/v1"


def pooled_context_representation(
    option_model: nn.Module,
    batch: dict[str, torch.Tensor],
) -> torch.Tensor:
    """Mean-pool the pinned tinyx context encoder output, excluding padding."""
    context_ids = batch["context_ids"]
    context_mask = batch["context_mask"]
    positions = torch.arange(context_ids.shape[1], device=context_ids.device)
    embedded = option_model.embedding(context_ids) + option_model.position(positions)
    safe_mask = context_mask.clone()
    safe_mask[:, 0] = True
    encoded = option_model.encoder(embedded, src_key_padding_mask=~safe_mask)
    weights = context_mask.unsqueeze(-1).to(encoded.dtype)
    return (encoded * weights).sum(dim=1) / weights.sum(dim=1).clamp_min(1.0)


class RoutedModel(nn.Module):
    """Wrap CUA-S1 option logits with an independent context-only route logit."""

    def __init__(self, option_model: nn.Module, width: int) -> None:
        super().__init__()
        self.option_model = option_model
        self.routing_head = nn.Linear(width, 1)

    def forward(self, batch: dict[str, torch.Tensor]) -> tuple[torch.Tensor, torch.Tensor]:
        option_logits = self.option_model(batch)
        pooled_context = pooled_context_representation(self.option_model, batch)
        routing_logits = self.routing_head(pooled_context).squeeze(-1)
        return option_logits, routing_logits


def save_routing_head(
    path: Path,
    routing_head: nn.Linear,
    width: int,
) -> tuple[Path, Path]:
    """Store routing weights as safetensors beside a JSON architecture record."""
    path.parent.mkdir(parents=True, exist_ok=True)
    config_path = path.with_suffix(".json")
    save_file(
        {
            name: tensor.detach().cpu().contiguous()
            for name, tensor in routing_head.state_dict().items()
        },
        str(path),
        metadata={"schema": ROUTING_HEAD_SCHEMA},
    )
    config_path.write_text(
        json.dumps(
            {
                "schema": ROUTING_HEAD_SCHEMA,
                "width": width,
                "outputCount": 1,
                "scoreComposition": "sigmoid(candidate_logit)*sigmoid(routing_logit)",
            },
            sort_keys=True,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path, config_path


def load_routing_head(
    path: Path,
    width: int,
    device: torch.device | str,
) -> nn.Linear:
    """Load a shape-checked routing head without executable serialization."""
    config_path = path.with_suffix(".json")
    config: Any = json.loads(config_path.read_text(encoding="utf-8"))
    if (
        not isinstance(config, dict)
        or config.get("schema") != ROUTING_HEAD_SCHEMA
        or config.get("width") != width
        or config.get("outputCount") != 1
    ):
        raise ValueError("routing-head config does not match the expected architecture")
    head = nn.Linear(width, 1)
    head.load_state_dict(load_file(str(path), device=str(device)), strict=True)
    return head.to(device).eval()

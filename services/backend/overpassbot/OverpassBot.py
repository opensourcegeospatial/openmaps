# The copy of OverpassBot that ships with the backend image (build context =
# services/backend), imported by the /overpass ML path. The standalone service
# in services/overpassbot/ mirrors this file: change both together.
import os

import torch
from transformers import AutoTokenizer, T5ForConditionalGeneration


class OverpassBot:
    def __init__(self, model_dir=None):
        if model_dir is None:
            model_dir = os.getenv('MODEL_DIR')
            if model_dir is None:
                project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../"))
                model_dir = os.path.join(project_root, "models", "byt5-base_com08")

        self.model_dir = model_dir
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_dir, local_files_only=True)
        self.model = T5ForConditionalGeneration.from_pretrained(
            self.model_dir, local_files_only=True
        ).to(self.device)

    # Wall-clock cap for one generation (seconds); set by the caller. None = unbounded.
    generation_max_time = None
    # byt5 is byte-level: input length is bytes, and attention is quadratic.
    max_input_tokens = 512

    def generate_query(self, text: str) -> str:
        with torch.inference_mode():
            outputs = self.model.generate(
                self.tokenize(text),
                max_new_tokens=600,
                max_time=self.generation_max_time,
            )
        return self.decode(outputs)

    def decode(self, outputs: torch.Tensor) -> str:
        return self.tokenizer.decode(outputs[0], skip_special_tokens=True)

    def tokenize(self, text: str) -> torch.Tensor:
        return self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=self.max_input_tokens,
        ).input_ids.to(self.device)

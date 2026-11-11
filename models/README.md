# models/

Lokalni modeli se smeštaju ovde. Folder se ne commituje i ne ulazi u build.

Očekivana struktura za podrazumevani prevodilački model:

```
models/Helsinki-NLP/opus-mt-tc-base-en-sh/
  config.json, generation_config.json, tokenizer.json, tokenizer_config.json
  onnx/encoder_model_quantized.onnx
  onnx/decoder_model_merged_quantized.onnx
```

Uputstvo za konverziju: `docs/MODELS.md`. Licenca modela: CC-BY-4.0 (Helsinki-NLP / OPUS-MT). Navođenje autora je obavezno.

# Benchmark data is NOT committed

The three datasets (MMLU 159 MB, GSM8K, TruthfulQA) are downloaded, not vendored:

```sh
mkdir -p data && cd data
curl -sSL -o gsm8k_test.jsonl https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl
curl -sSL -o truthfulqa.csv https://raw.githubusercontent.com/sylinrl/TruthfulQA/main/TruthfulQA.csv
curl -sSL -o mmlu.tar https://people.eecs.berkeley.edu/~hendrycks/data.tar && tar xf mmlu.tar && rm mmlu.tar
```

Then `node run-bench.mjs all`. Results of the s336 run are in `results-s336.jsonl`, and what
they mean -- including the contamination probe and its limits -- is in `docs/BENCHMARKS_PHI4_S336.md`.

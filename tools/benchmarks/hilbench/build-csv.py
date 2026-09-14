#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Rebuilds the public CSV that HiL-Bench's SQL generator requires and their repository does not carry.

Their generator reads research_evals/hil_bench/utils/sql_delivered_tasks_and_attempts_PUBLIC.csv for
the order of the 100 public SQL tasks; that file is not in their repository. Nothing here is
invented: every row comes from the task.toml files their repository does carry
(harbor_sql/sql_N/ask_human/task.toml, where task_attempt_id = "<task_id>_<uid>"), and the order is
PROVED against their dataset before anything is written: sql_N must be the dataset's public_sql_N,
for all 100. One mismatch and nothing is written.

The dataset is read at the revision the NOESAR runs used. A dataset that has moved on is said, not
followed: their generator reads the newest revision, so the tasks might no longer be the ones the
numbers come from. And the CSV must hash to the one those runs were generated from.

usage (inside python:3.12-slim with pandas pyarrow datasets huggingface_hub; setup.sh does this):
  python build-csv.py <hil-bench repository> <out.csv>
"""
import hashlib
import re
import sys
from pathlib import Path

from datasets import load_dataset
from huggingface_hub import HfApi

DATASET = 'ScaleAI/hil-bench'
REVISION = '045419da0f51f10efc621efdb481a6502df810d5'
# The CSV the 14/09/2026 NOESAR runs were generated from.
EXPECTED_SHA256 = 'dc7118f9878e12770ee9b048d61f86329dc8d10574ea62698d85ec998ebcfd1e'


def main(clone: Path, out: Path) -> None:
    head = HfApi().dataset_info(DATASET).sha
    if head != REVISION:
        sys.exit(f'{DATASET} is at {head}; the runs used {REVISION}, and their generator reads the newest. Stopping.')
    by_uid = {
        str(row['uid']): row
        for row in load_dataset(DATASET, split='train', revision=REVISION)
        if row.get('task_type') == 'sql'
    }
    rows, mismatches = [], []
    for index in range(100):
        toml = (clone / 'harbor_sql' / f'sql_{index}' / 'ask_human' / 'task.toml').read_text()
        attempt = re.search(r'task_attempt_id\s*=\s*"([^"]+)"', toml)
        database = re.search(r'database_name\s*=\s*"([^"]+)"', toml)
        if not attempt:
            sys.exit(f'no task_attempt_id in sql_{index}')
        task_id, uid = attempt.group(1).split('_')
        row = by_uid.get(uid)
        if row is None:
            sys.exit(f'uid {uid} (sql_{index}) is not in the dataset')
        # The oracle: the folder's index must be the index the dataset declares.
        if row['task_id'] != f'public_sql_{index}':
            mismatches.append(f"sql_{index} -> {row['task_id']}")
        # The database comes from their task.toml, not the dataset: it is what their compose reads.
        rows.append(f"{task_id},{uid},{database.group(1) if database else row.get('repo_or_db_name', '')}")
    if mismatches:
        sys.exit(f'order does not match on {len(mismatches)} indices, nothing written: {mismatches[:10]}')
    text = 'task_id,attempt_id,repo_or_db_name\n' + '\n'.join(rows) + '\n'
    digest = hashlib.sha256(text.encode()).hexdigest()
    if digest != EXPECTED_SHA256:
        sys.exit(f'the CSV hashes to {digest}; the runs used {EXPECTED_SHA256}: not the same task set. Nothing written.')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(f'order proved on all 100 indices (sql_N == public_sql_N); {out} sha256 {digest}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: build-csv.py <hil-bench repository> <out.csv>')
    main(Path(sys.argv[1]), Path(sys.argv[2]))

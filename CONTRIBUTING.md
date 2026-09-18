# Contributing

This project accepts contributions. It also has opinions about what a contribution is, and they
are written down here rather than discovered in a review.

## The most useful thing you can send is not a patch

It is a report from a machine that is not ours. `0.1.0` is a pre-release and the whole reason it
exists in public is that the product has been installed on very few machines. If you installed it
and something went wrong, **that report is worth more than a fix**, because the defect is almost
always in the part nobody here could see.

- something is broken → [report a defect](https://github.com/komandante78/noesar-evolution-core/issues/new?template=bug_report.yml)
- something should be different → [say so](https://github.com/komandante78/noesar-evolution-core/issues/new?template=idea.yml)
- a security vulnerability → **never in a public issue while it is unfixed**. [`SECURITY.md`](SECURITY.md) says where it goes.

## If you do want to send code

**You need Node.js 22 or newer, and Docker for the linter. You do not need `npm install`:** this
product has zero runtime dependencies, and `package.json` declares none.

Enable the gate once per clone, and it will stop you before a reviewer has to:

```bash
git config core.hooksPath .githooks
```

That hook runs, on every commit: the unit suite, the migration manifest check, the product
manifest check, and ESLint. It refuses archives, binaries, databases, keys and `.env` files by
name. If Docker is missing it **blocks** rather than passing quietly — a gate that cannot run says
so.

### The cycle that will not waste your time

1. Make the change.
2. **`git add` any NEW file.** The manifest lists tracked files only, so a file you never added is
   a file the manifest cannot see.
3. `node tools/generate-manifest.mjs`
4. `npm test`
5. Commit.

Step 3 is not cosmetic. A test named *"the real repository manifest is complete and correct"*
compares every file's hash against `MANIFEST.sha256`. Skip it and the suite goes red in a way that
looks like you broke the product, while all you did was edit a file. The test itself tells you the
repair.

### What will fail your change, every time

- **A number nobody can reproduce.** This repository's own rule: *a number in the README that a
  reader cannot reproduce is a defect*. If you state one, name the command beside it.
- **A claim that was not measured.** "It should work on X" is not evidence that it works on X.
  Saying *"not verified on X"* is always accepted; saying it works when it was never run is not.
- **A missing SPDX header.** Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- **A second copy of a fact.** If a value already lives in a file, point at that file instead of
  copying the value. Two copies of a number are one number and one future defect — this project
  has paid for that more than once, and there are tests whose only job is to catch it.

### Comments here explain *why*, not *what*

Read a few files before writing one. The code records the reason a thing exists, and often the
defect that made it exist, because the next person to touch it needs that and cannot get it from
`git blame`. A comment that restates the line below it will be asked to say something else.

### Commit messages

One line that says what changed and why it mattered, then the detail, then the numbers you
measured. Look at `git log` for the shape. Authorship in this repository is
`NOESAR CI <ci@noesar.local>`.

## Licence

Contributions are accepted under the same licence as the project, **AGPL-3.0-or-later**. By
opening a pull request you are stating that you have the right to submit the code under it. There
is no separate contributor agreement, and there will not be one.

## What happens next

This is a small project with one maintainer. A report will be read; a pull request may take longer
to review than to write, and may be turned down for a reason that is written out rather than
implied. If a decision here looks wrong, `docs/DECISION_LOG.md` usually explains why it was taken,
and arguing with what is written there is a legitimate contribution too.

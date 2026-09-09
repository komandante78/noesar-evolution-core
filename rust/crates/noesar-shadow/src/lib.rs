// SPDX-License-Identifier: AGPL-3.0-or-later
//! Shadow execution: a contained copy of what a plan touches, and the comparison between
//! what was expected and what actually happened.
//!
//! Step 4 of phase 1 (`09_PIANO.md`). The contract already forces a plan to declare what
//! must become true ([`noesar_reasoning::Expectation`]); this is the half that makes the
//! declaration worth having, by observing the difference.
//!
//! # What "shadow" means here, precisely
//!
//! Copy-on-write **where the filesystem provides it**, decided by an attempt on the real
//! directory rather than by an assumption. A reflink clone (`FICLONE`) needs no privileges
//! and no mount of our own; it needs a filesystem that supports it, so the answer is
//! measured per installation and reported through [`ShadowWorkspace::mechanism`]. Where it
//! is absent the same tree is copied in full: slower, identical in behaviour.
//!
//! [`ShadowWorkspace::materialise`] holds the **whole workspace**;
//! [`ShadowWorkspace::create`] holds only the paths a plan names. The difference is not
//! cost, it is what can be observed — see below — and each says which it is through
//! [`ShadowWorkspace::coverage`].
//!
//! # The comparison is two-sided, and the second side is the dangerous one
//!
//! *Expected and did not happen* is a failure. *Happened and was not expected* is a
//! surprise, and it is the one worth catching: a plan that also touched a file nobody
//! authorised is the exact shape of the accident this whole phase exists to prevent. Both
//! are reported, and [`Surprise::is_clean`] is false if either is non-empty.
//!
//! That second side can only be observed in a shadow that **contains files nobody
//! declared**. A shadow built from exactly the declared paths makes `unexpected`
//! structurally empty — not because nothing else happened, but because there was nothing
//! else there to see — which hands the guarantee to whoever built the shadow.
//!
//! **A run that observed nothing is not a clean run.** An observation with no paths and no
//! test results is refused rather than compared, because "no differences found" and
//! "nothing was looked at" produce the same empty set.

use noesar_reasoning::Expectation;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShadowError {
    /// A path left the root it was supposed to stay inside.
    Containment { path: String, reason: String },
    Io { path: String, reason: String },
    Invalid { field: String, reason: String },
    /// The workspace is larger than the declared limits. Refused, never truncated: a partial
    /// shadow would be compared as if it were the whole workspace.
    Limit { path: String, reason: String },
}

impl std::fmt::Display for ShadowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Containment { path, reason } => write!(f, "containment `{path}`: {reason}"),
            Self::Io { path, reason } => write!(f, "io `{path}`: {reason}"),
            Self::Invalid { field, reason } => write!(f, "invalid `{field}`: {reason}"),
            Self::Limit { path, reason } => write!(f, "limit `{path}`: {reason}"),
        }
    }
}

impl std::error::Error for ShadowError {}

pub type Outcome<T> = Result<T, ShadowError>;

/// How the shadow was made. Recorded on the workspace so a reader is never left to assume.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShadowStrategy {
    /// Only the paths the plan names are copied. Not copy-on-write.
    TargetedCopy,
    /// The whole tree, cloned through `FICLONE`: copy-on-write, blocks shared until written.
    ReflinkClone,
    /// The whole tree, copied byte for byte because the filesystem refused to clone it.
    FullCopy,
}

/// What the shadow is able to observe — not how much it cost to make.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShadowCoverage {
    /// Everything in the workspace, so a write nobody declared is visible.
    WholeWorkspace,
    /// Only what a plan named: `unexpected` cannot be populated from this shadow.
    DeclaredPathsOnly,
}

/// The answer to "does this mount support reflinks", together with the fact that it was
/// obtained by trying rather than by assuming.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CopyOnWriteProbe {
    pub measured: bool,
    pub supported: bool,
    pub mechanism: ShadowStrategy,
}

/// Refused rather than truncated: see [`ShadowWorkspace::materialise`].
pub const DEFAULT_MAX_FILES: usize = 20_000;
pub const DEFAULT_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct ShadowLimits {
    pub max_files: usize,
    pub max_bytes: u64,
}

impl Default for ShadowLimits {
    fn default() -> Self {
        Self { max_files: DEFAULT_MAX_FILES, max_bytes: DEFAULT_MAX_BYTES }
    }
}

/// `_IOW(0x94, 9, int)` — the asm-generic encoding, which is what every architecture this
/// product targets uses. Architectures with a different ioctl encoding are excluded by the
/// `cfg` below rather than sent an ioctl number that means something else there.
#[cfg(all(
    unix,
    any(
        target_arch = "x86",
        target_arch = "x86_64",
        target_arch = "arm",
        target_arch = "aarch64",
        target_arch = "riscv64",
        target_arch = "loongarch64",
        target_arch = "s390x",
    )
))]
const FICLONE: libc::c_ulong = 0x4004_9409;

/// Clones `from` onto `to` sharing blocks. `Ok(false)` means the filesystem said no and the
/// caller should copy; an error is a real failure to create the destination.
#[cfg(all(
    unix,
    any(
        target_arch = "x86",
        target_arch = "x86_64",
        target_arch = "arm",
        target_arch = "aarch64",
        target_arch = "riscv64",
        target_arch = "loongarch64",
        target_arch = "s390x",
    )
))]
fn try_reflink(from: &Path, to: &Path) -> std::io::Result<bool> {
    use std::os::unix::io::AsRawFd;
    let source = fs::File::open(from)?;
    let destination = fs::File::create(to)?;
    // SAFETY: both descriptors are open and owned for the duration of the call, and FICLONE
    // reads only the descriptor number passed as the argument.
    let result = unsafe { libc::ioctl(destination.as_raw_fd(), FICLONE, source.as_raw_fd()) };
    Ok(result == 0)
}

#[cfg(not(all(
    unix,
    any(
        target_arch = "x86",
        target_arch = "x86_64",
        target_arch = "arm",
        target_arch = "aarch64",
        target_arch = "riscv64",
        target_arch = "loongarch64",
        target_arch = "s390x",
    )
)))]
fn try_reflink(_from: &Path, _to: &Path) -> std::io::Result<bool> {
    Ok(false)
}

/// Does this directory support reflinks? Answered by trying one **in that directory**:
/// support is a property of the mount, so asking anywhere else answers a different question.
pub fn probe_copy_on_write(directory: &Path) -> CopyOnWriteProbe {
    let stamp = std::process::id();
    let from = directory.join(format!(".noesar-cow-probe-{stamp}"));
    let to = directory.join(format!(".noesar-cow-probe-{stamp}.clone"));
    let mut supported = false;
    if fs::create_dir_all(directory).is_ok()
        && fs::write(&from, b"noesar copy-on-write probe").is_ok()
    {
        supported = matches!(try_reflink(&from, &to), Ok(true));
    }
    let _ = fs::remove_file(&from);
    let _ = fs::remove_file(&to);
    CopyOnWriteProbe {
        measured: true,
        supported,
        mechanism: if supported { ShadowStrategy::ReflinkClone } else { ShadowStrategy::FullCopy },
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Change {
    Created,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
}

/// What actually happened. Produced by observing the shadow, never supplied by whoever
/// wanted the run to succeed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub changed: BTreeMap<String, Change>,
    pub tests: Vec<TestResult>,
}

impl Observation {
    pub fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.tests.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Surprise {
    /// Declared in the expectation, absent from the observation.
    pub expected_and_absent: Vec<String>,
    /// Present in the observation, never declared. The dangerous side.
    pub unexpected: Vec<String>,
    /// Expected to pass and did not.
    pub tests_expected_to_pass_that_failed: Vec<String>,
    /// Expected to fail on purpose and passed — the fail-first evidence that did not hold.
    pub tests_expected_to_fail_that_passed: Vec<String>,
    /// Named in the expectation and never run at all: neither a pass nor a failure, and
    /// silently dropping it would make an untested plan look verified.
    pub tests_never_run: Vec<String>,
    /// Ran and failed while the expectation never claimed it either way. Measured on the live
    /// installation on 2026-09-09: a plan declaring `/bin/false` ran it, the observation
    /// recorded `passed: false`, and the run came back clean and was promoted — the reference
    /// `expect` only lists a command under `tests_expected_to_pass` when the literal word
    /// `test` occurs in it, and that installation routes `expect` to an external provider that
    /// lists none. The rule lives in the comparison because that is the one place every
    /// provider's expectation passes through. Defaulted so an expectation serialised before
    /// this field existed still deserialises.
    #[serde(default)]
    pub declared_commands_that_failed: Vec<String>,
}

impl Surprise {
    pub fn is_clean(&self) -> bool {
        self.expected_and_absent.is_empty()
            && self.unexpected.is_empty()
            && self.tests_expected_to_pass_that_failed.is_empty()
            && self.tests_expected_to_fail_that_passed.is_empty()
            && self.tests_never_run.is_empty()
            && self.declared_commands_that_failed.is_empty()
    }
}

/// Compares what was declared with what happened.
pub fn compare(expectation: &Expectation, observation: &Observation) -> Outcome<Surprise> {
    // "No differences found" and "nothing was looked at" are the same empty set, and only
    // one of them is a result.
    if observation.is_empty() {
        return Err(ShadowError::Invalid {
            field: "Observation".into(),
            reason: "an observation of nothing cannot be compared: it is indistinguishable \
                     from a clean run".into(),
        });
    }

    let touched: Vec<&String> = observation.changed.keys().collect();
    let expected_and_absent: Vec<String> = expectation
        .paths_the_diff_must_touch
        .iter()
        // Mirror of shadow.mjs: `.` is the working directory a declared command runs in, not
        // a diff target, and an observation keys its changes by file path — so requiring it
        // is a criterion nothing could ever satisfy.
        .filter(|path| path.as_str() != ".")
        .filter(|path| !touched.contains(path))
        .cloned()
        .collect();
    let unexpected: Vec<String> = touched
        .iter()
        .filter(|path| !expectation.paths_the_diff_must_touch.contains(**path))
        .map(|path| (*path).clone())
        .collect();

    let outcome_of = |name: &String| observation.tests.iter().find(|test| &test.name == name);

    let mut tests_never_run = Vec::new();
    let mut tests_expected_to_pass_that_failed = Vec::new();
    for name in &expectation.tests_expected_to_pass {
        match outcome_of(name) {
            None => tests_never_run.push(name.clone()),
            Some(result) if !result.passed => tests_expected_to_pass_that_failed.push(name.clone()),
            Some(_) => {}
        }
    }
    let mut tests_expected_to_fail_that_passed = Vec::new();
    for name in &expectation.tests_expected_to_fail {
        match outcome_of(name) {
            None => tests_never_run.push(name.clone()),
            Some(result) if result.passed => tests_expected_to_fail_that_passed.push(name.clone()),
            Some(_) => {}
        }
    }

    // A command the plan declared, which ran and failed, is a surprise on its own — the
    // expectation naming it is not what makes a failure count. Excluded: the ones already
    // reported above, and the ones the expectation declares as expected-to-fail, where the
    // failure is the claim rather than a surprise.
    let declared_commands_that_failed: Vec<String> = observation
        .tests
        .iter()
        .filter(|test| {
            !test.passed
                && !expectation.tests_expected_to_fail.contains(&test.name)
                && !tests_expected_to_pass_that_failed.contains(&test.name)
        })
        .map(|test| test.name.clone())
        .collect();

    Ok(Surprise {
        expected_and_absent,
        unexpected,
        tests_expected_to_pass_that_failed,
        tests_expected_to_fail_that_passed,
        tests_never_run,
        declared_commands_that_failed,
    })
}

fn digest_of(path: &Path) -> Outcome<String> {
    let bytes = fs::read(path).map_err(|error| ShadowError::Io {
        path: path.display().to_string(),
        reason: error.to_string(),
    })?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

/// Rejects anything that could leave the root: absolute paths, parent components, and — on
/// the resolved result — anything that does not still start at the root. Symlinks are not
/// followed for containment purposes; a link out of the shadow is treated as leaving.
fn contained(root: &Path, relative: &str) -> Outcome<PathBuf> {
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return Err(ShadowError::Containment {
            path: relative.into(),
            reason: "an absolute path is not inside the shadow".into(),
        });
    }
    for component in candidate.components() {
        match component {
            Component::ParentDir => {
                return Err(ShadowError::Containment {
                    path: relative.into(),
                    reason: "a parent component leaves the shadow".into(),
                })
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(ShadowError::Containment {
                    path: relative.into(),
                    reason: "a rooted path is not inside the shadow".into(),
                })
            }
            _ => {}
        }
    }
    let joined = root.join(candidate);
    if !joined.starts_with(root) {
        return Err(ShadowError::Containment {
            path: relative.into(),
            reason: "the resolved path is outside the shadow".into(),
        });
    }
    Ok(joined)
}

#[derive(Debug)]
pub struct ShadowWorkspace {
    root: PathBuf,
    baseline: BTreeMap<String, Option<String>>,
    strategy: ShadowStrategy,
    coverage: ShadowCoverage,
    excluded: Vec<String>,
    degraded_clones: usize,
}

/// A symlink is digested by where it points, not by what it points at: retargeting a link is
/// a change to the workspace, and following it would read outside the shadow.
fn digest_of_link(path: &Path) -> Outcome<String> {
    let target = fs::read_link(path).map_err(|error| ShadowError::Io {
        path: path.display().to_string(),
        reason: error.to_string(),
    })?;
    let mut hasher = Sha256::new();
    hasher.update(format!("symlink:{}", target.display()).as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

#[derive(Debug, Default)]
struct SourceWalk {
    files: Vec<String>,
    directories: Vec<String>,
    links: Vec<String>,
    excluded: Vec<String>,
}

/// Walks the source tree once. Anything that is neither file, directory nor symlink — a
/// socket, a fifo, a device — cannot be cloned and is EXCLUDED AND COUNTED rather than
/// silently passed over: the live workspace holds PostgreSQL sockets, so refusing outright
/// would make the mechanism unusable on the real installation, and skipping in silence would
/// overstate what the shadow covers.
fn walk_source(source_root: &Path, limits: ShadowLimits) -> Outcome<SourceWalk> {
    let mut walk = SourceWalk::default();
    let mut bytes: u64 = 0;
    let mut stack = vec![source_root.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current).map_err(|error| ShadowError::Io {
            path: current.display().to_string(),
            reason: error.to_string(),
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| ShadowError::Io {
                path: current.display().to_string(),
                reason: error.to_string(),
            })?;
            let absolute = entry.path();
            let relative = absolute
                .strip_prefix(source_root)
                .map_err(|_| ShadowError::Containment {
                    path: absolute.display().to_string(),
                    reason: "the walk left the workspace it started in".into(),
                })?
                .to_string_lossy()
                .to_string();
            // `symlink_metadata` never follows: a link to a directory must stay a link.
            let meta = fs::symlink_metadata(&absolute).map_err(|error| ShadowError::Io {
                path: absolute.display().to_string(),
                reason: error.to_string(),
            })?;
            if meta.is_symlink() {
                walk.links.push(relative);
            } else if meta.is_dir() {
                walk.directories.push(relative);
                stack.push(absolute);
            } else if meta.is_file() {
                bytes = bytes.saturating_add(meta.len());
                walk.files.push(relative.clone());
                if walk.files.len() > limits.max_files {
                    return Err(ShadowError::Limit {
                        path: relative,
                        reason: format!(
                            "the workspace holds more than {} files; a partial shadow would be compared as if it were complete",
                            limits.max_files
                        ),
                    });
                }
                if bytes > limits.max_bytes {
                    return Err(ShadowError::Limit {
                        path: relative,
                        reason: format!(
                            "the workspace exceeds {} bytes; a partial shadow would be compared as if it were complete",
                            limits.max_bytes
                        ),
                    });
                }
            } else {
                walk.excluded.push(relative);
            }
        }
    }
    Ok(walk)
}

impl ShadowWorkspace {
    /// Copies only `paths`, each relative to `source_root`, into `shadow_root`.
    /// A path that is not contained by either root aborts the whole creation: a partially
    /// built shadow that silently dropped one file would be compared as if complete.
    pub fn create(source_root: &Path, shadow_root: &Path, paths: &[String]) -> Outcome<Self> {
        if paths.is_empty() {
            return Err(ShadowError::Invalid {
                field: "paths".into(),
                reason: "a shadow of nothing can neither be executed nor observed".into(),
            });
        }
        fs::create_dir_all(shadow_root).map_err(|error| ShadowError::Io {
            path: shadow_root.display().to_string(),
            reason: error.to_string(),
        })?;

        let mut baseline = BTreeMap::new();
        for relative in paths {
            let from = contained(source_root, relative)?;
            let to = contained(shadow_root, relative)?;
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|error| ShadowError::Io {
                    path: parent.display().to_string(),
                    reason: error.to_string(),
                })?;
            }
            if from.is_file() {
                fs::copy(&from, &to).map_err(|error| ShadowError::Io {
                    path: from.display().to_string(),
                    reason: error.to_string(),
                })?;
                baseline.insert(relative.clone(), Some(digest_of(&to)?));
            } else {
                // A file the plan names that does not exist yet is legitimate — the plan may
                // create it — and its baseline is its absence, recorded as such.
                baseline.insert(relative.clone(), None);
            }
        }
        Ok(Self {
            root: shadow_root.to_path_buf(),
            baseline,
            strategy: ShadowStrategy::TargetedCopy,
            coverage: ShadowCoverage::DeclaredPathsOnly,
            excluded: Vec::new(),
            degraded_clones: 0,
        })
    }

    /// The whole workspace, copy-on-write where the mount allows it. This is the shadow the
    /// plan asks for: it can hold a file nobody declared, which is the only way the
    /// comparison can ever report that one was touched.
    pub fn materialise(
        source_root: &Path,
        shadow_root: &Path,
        limits: ShadowLimits,
    ) -> Outcome<Self> {
        if shadow_root == source_root
            || shadow_root.starts_with(source_root)
            || source_root.starts_with(shadow_root)
        {
            return Err(ShadowError::Containment {
                path: shadow_root.display().to_string(),
                reason: "the shadow and the workspace must not contain one another".into(),
            });
        }
        if !source_root.is_dir() {
            return Err(ShadowError::Invalid {
                field: "source_root".into(),
                reason: "the workspace to shadow must be an existing directory".into(),
            });
        }
        // The walk happens first and returns before anything is written: a Limit refusal must
        // not leave half a tree behind that a later reader could mistake for a shadow.
        let walk = walk_source(source_root, limits)?;

        fs::create_dir_all(shadow_root).map_err(|error| ShadowError::Io {
            path: shadow_root.display().to_string(),
            reason: error.to_string(),
        })?;
        let probe = probe_copy_on_write(shadow_root);

        let mut baseline = BTreeMap::new();
        let mut degraded_clones = 0usize;
        for relative in &walk.directories {
            let to = contained(shadow_root, relative)?;
            fs::create_dir_all(&to).map_err(|error| ShadowError::Io {
                path: to.display().to_string(),
                reason: error.to_string(),
            })?;
        }
        for relative in &walk.files {
            let from = source_root.join(relative);
            let to = contained(shadow_root, relative)?;
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|error| ShadowError::Io {
                    path: parent.display().to_string(),
                    reason: error.to_string(),
                })?;
            }
            let cloned = if probe.supported {
                // The probe passed and this file may still refuse: a hard link, a different
                // mount underneath, an inode the filesystem will not share. Fall back for
                // this file and count it, rather than leave the mechanism overstated.
                matches!(try_reflink(&from, &to), Ok(true))
            } else {
                false
            };
            if !cloned {
                if probe.supported {
                    degraded_clones += 1;
                }
                fs::copy(&from, &to).map_err(|error| ShadowError::Io {
                    path: from.display().to_string(),
                    reason: error.to_string(),
                })?;
            }
            baseline.insert(relative.clone(), Some(digest_of(&to)?));
        }
        for relative in &walk.links {
            let from = source_root.join(relative);
            let to = contained(shadow_root, relative)?;
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|error| ShadowError::Io {
                    path: parent.display().to_string(),
                    reason: error.to_string(),
                })?;
            }
            let target = fs::read_link(&from).map_err(|error| ShadowError::Io {
                path: from.display().to_string(),
                reason: error.to_string(),
            })?;
            // Recreated as a link, not as its contents: following it would read outside.
            #[cfg(unix)]
            std::os::unix::fs::symlink(&target, &to).map_err(|error| ShadowError::Io {
                path: to.display().to_string(),
                reason: error.to_string(),
            })?;
            baseline.insert(relative.clone(), Some(digest_of_link(&to)?));
        }
        if baseline.is_empty() {
            return Err(ShadowError::Invalid {
                field: "source_root".into(),
                reason: "a shadow of nothing can neither be executed nor observed".into(),
            });
        }
        Ok(Self {
            root: shadow_root.to_path_buf(),
            baseline,
            strategy: probe.mechanism,
            coverage: ShadowCoverage::WholeWorkspace,
            excluded: walk.excluded,
            degraded_clones,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn strategy(&self) -> ShadowStrategy {
        self.strategy
    }

    pub fn mechanism(&self) -> ShadowStrategy {
        self.strategy
    }

    /// What this shadow is able to observe.
    pub fn coverage(&self) -> ShadowCoverage {
        self.coverage
    }

    /// Entries the shadow could not clone, listed rather than silently absent.
    pub fn excluded(&self) -> &[String] {
        &self.excluded
    }

    /// Files for which the reflink was refused after the probe passed.
    pub fn degraded_clones(&self) -> usize {
        self.degraded_clones
    }

    pub fn baseline_size(&self) -> usize {
        self.baseline.len()
    }

    /// Recomputes what the shadow holds now and reports what moved.
    ///
    /// A whole-workspace shadow walks the tree, so a path nobody named is still seen. A
    /// targeted shadow can only look at what it copied, and says so through
    /// [`ShadowWorkspace::coverage`] rather than presenting the narrower answer as the same.
    pub fn observe(&self, tests: Vec<TestResult>) -> Outcome<Observation> {
        let mut changed = BTreeMap::new();
        let now = match self.coverage {
            ShadowCoverage::WholeWorkspace => self.current_tree()?,
            ShadowCoverage::DeclaredPathsOnly => self.current_baseline_paths()?,
        };
        for (relative, before) in &self.baseline {
            let after = now.get(relative);
            match (before, after) {
                (None, Some(_)) => {
                    changed.insert(relative.clone(), Change::Created);
                }
                (Some(_), None) => {
                    changed.insert(relative.clone(), Change::Deleted);
                }
                (Some(old), Some(new)) if old != new => {
                    changed.insert(relative.clone(), Change::Modified);
                }
                _ => {}
            }
        }
        if self.coverage == ShadowCoverage::WholeWorkspace {
            for relative in now.keys() {
                if !self.baseline.contains_key(relative) {
                    changed.insert(relative.clone(), Change::Created);
                }
            }
        }
        Ok(Observation { changed, tests })
    }

    fn current_baseline_paths(&self) -> Outcome<BTreeMap<String, String>> {
        let mut now = BTreeMap::new();
        for relative in self.baseline.keys() {
            let path = contained(&self.root, relative)?;
            if path.is_file() {
                now.insert(relative.clone(), digest_of(&path)?);
            }
        }
        Ok(now)
    }

    fn current_tree(&self) -> Outcome<BTreeMap<String, String>> {
        let mut now = BTreeMap::new();
        let mut stack = vec![self.root.clone()];
        while let Some(current) = stack.pop() {
            let entries = match fs::read_dir(&current) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let absolute = entry.path();
                let relative = match absolute.strip_prefix(&self.root) {
                    Ok(rest) => rest.to_string_lossy().to_string(),
                    Err(_) => continue,
                };
                let meta = match fs::symlink_metadata(&absolute) {
                    Ok(meta) => meta,
                    Err(_) => continue,
                };
                if meta.is_symlink() {
                    now.insert(relative, digest_of_link(&absolute)?);
                } else if meta.is_dir() {
                    stack.push(absolute);
                } else if meta.is_file() {
                    now.insert(relative, digest_of(&absolute)?);
                }
            }
        }
        Ok(now)
    }

    /// Removes the shadow. Refuses to remove anything that is not the root it was given,
    /// because a recursive delete aimed by a mistaken path is not a risk worth taking.
    pub fn discard(self) -> Outcome<()> {
        if self.root.as_os_str().is_empty() || self.root == Path::new("/") {
            return Err(ShadowError::Containment {
                path: self.root.display().to_string(),
                reason: "refusing to remove a root that is not a shadow".into(),
            });
        }
        fs::remove_dir_all(&self.root).map_err(|error| ShadowError::Io {
            path: self.root.display().to_string(),
            reason: error.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn scratch(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("noesar-shadow-{label}-{n}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn expectation(paths: &[&str], pass: &[&str], fail: &[&str]) -> Expectation {
        Expectation::try_new(
            pass.iter().map(|s| s.to_string()).collect(),
            fail.iter().map(|s| s.to_string()).collect(),
            paths.iter().map(|s| s.to_string()).collect(),
        )
        .unwrap()
    }

    fn observation(changed: &[(&str, Change)], tests: &[(&str, bool)]) -> Observation {
        Observation {
            changed: changed.iter().map(|(p, c)| (p.to_string(), c.clone())).collect(),
            tests: tests
                .iter()
                .map(|(n, p)| TestResult { name: n.to_string(), passed: *p })
                .collect(),
        }
    }

    #[test]
    fn a_run_that_matches_its_expectation_is_clean() {
        let surprise = compare(
            &expectation(&["src/a.rs"], &["cargo test"], &[]),
            &observation(&[("src/a.rs", Change::Modified)], &[("cargo test", true)]),
        )
        .unwrap();
        assert!(surprise.is_clean(), "{surprise:?}");
    }

    #[test]
    fn a_file_touched_that_nobody_declared_is_a_surprise() {
        let surprise = compare(
            &expectation(&["src/a.rs"], &["cargo test"], &[]),
            &observation(
                &[("src/a.rs", Change::Modified), ("src/secret.rs", Change::Modified)],
                &[("cargo test", true)],
            ),
        )
        .unwrap();
        assert_eq!(surprise.unexpected, vec!["src/secret.rs".to_string()]);
        assert!(!surprise.is_clean());
    }

    #[test]
    fn a_declared_file_that_never_moved_is_reported() {
        let surprise = compare(
            &expectation(&["src/a.rs", "src/b.rs"], &["cargo test"], &[]),
            &observation(&[("src/a.rs", Change::Modified)], &[("cargo test", true)]),
        )
        .unwrap();
        assert_eq!(surprise.expected_and_absent, vec!["src/b.rs".to_string()]);
    }

    #[test]
    fn a_test_named_and_never_run_is_not_a_pass() {
        let surprise = compare(
            &expectation(&["src/a.rs"], &["cargo test", "cargo clippy"], &[]),
            &observation(&[("src/a.rs", Change::Modified)], &[("cargo test", true)]),
        )
        .unwrap();
        assert_eq!(surprise.tests_never_run, vec!["cargo clippy".to_string()]);
        assert!(!surprise.is_clean());
    }

    #[test]
    fn a_test_expected_to_fail_that_passed_is_a_surprise() {
        // The fail-first evidence: if the test meant to prove the defect passes before the
        // repair, it was never measuring the defect.
        let surprise = compare(
            &expectation(&["src/a.rs"], &[], &["the failing case"]),
            &observation(&[("src/a.rs", Change::Modified)], &[("the failing case", true)]),
        )
        .unwrap();
        assert_eq!(surprise.tests_expected_to_fail_that_passed, vec!["the failing case".to_string()]);
    }

    #[test]
    fn an_observation_of_nothing_is_refused_not_reported_clean() {
        let error = compare(
            &expectation(&["src/a.rs"], &["cargo test"], &[]),
            &observation(&[], &[]),
        )
        .unwrap_err();
        assert!(matches!(error, ShadowError::Invalid { .. }));
    }

    #[test]
    fn the_shadow_copies_only_what_the_plan_names() {
        let source = scratch("src");
        fs::write(source.join("wanted.txt"), b"a").unwrap();
        fs::write(source.join("untouched.txt"), b"b").unwrap();
        let shadow_root = scratch("shadow");
        let shadow =
            ShadowWorkspace::create(&source, &shadow_root, &["wanted.txt".into()]).unwrap();
        assert!(shadow.root().join("wanted.txt").is_file());
        assert!(!shadow.root().join("untouched.txt").exists());
        assert_eq!(shadow.strategy(), ShadowStrategy::TargetedCopy);
        shadow.discard().unwrap();
        // The source is untouched: that is the whole point of a shadow.
        assert!(source.join("wanted.txt").is_file());
    }

    #[test]
    fn a_path_leaving_the_root_aborts_the_whole_shadow() {
        let source = scratch("src2");
        fs::write(source.join("ok.txt"), b"a").unwrap();
        let shadow_root = scratch("shadow2");
        for escape in ["../outside.txt", "/etc/passwd", "a/../../outside.txt"] {
            let error =
                ShadowWorkspace::create(&source, &shadow_root, &[escape.to_string()]).unwrap_err();
            assert!(matches!(error, ShadowError::Containment { .. }), "{escape}: {error}");
        }
        // Aborting the whole creation matters: a shadow that silently dropped one path
        // would be compared as if it were complete.
        let error = ShadowWorkspace::create(
            &source,
            &shadow_root,
            &["ok.txt".into(), "../outside.txt".into()],
        )
        .unwrap_err();
        assert!(matches!(error, ShadowError::Containment { .. }));
    }

    #[test]
    fn changes_inside_the_shadow_are_observed_and_the_source_is_not() {
        let source = scratch("src3");
        fs::write(source.join("a.txt"), b"before").unwrap();
        fs::write(source.join("gone.txt"), b"x").unwrap();
        let shadow_root = scratch("shadow3");
        let shadow = ShadowWorkspace::create(
            &source,
            &shadow_root,
            &["a.txt".into(), "gone.txt".into(), "new.txt".into()],
        )
        .unwrap();

        fs::write(shadow.root().join("a.txt"), b"after").unwrap();
        fs::remove_file(shadow.root().join("gone.txt")).unwrap();
        fs::write(shadow.root().join("new.txt"), b"created").unwrap();

        let observed = shadow.observe(vec![]).unwrap();
        assert_eq!(observed.changed.get("a.txt"), Some(&Change::Modified));
        assert_eq!(observed.changed.get("gone.txt"), Some(&Change::Deleted));
        assert_eq!(observed.changed.get("new.txt"), Some(&Change::Created));
        assert_eq!(fs::read(source.join("a.txt")).unwrap(), b"before");
        shadow.discard().unwrap();
    }

    #[test]
    fn an_untouched_shadow_observes_nothing_and_therefore_cannot_be_called_clean() {
        let source = scratch("src4");
        fs::write(source.join("a.txt"), b"same").unwrap();
        let shadow_root = scratch("shadow4");
        let shadow = ShadowWorkspace::create(&source, &shadow_root, &["a.txt".into()]).unwrap();
        let observed = shadow.observe(vec![]).unwrap();
        assert!(observed.is_empty());
        assert!(compare(&expectation(&["a.txt"], &[], &[]), &observed).is_err());
        shadow.discard().unwrap();
    }

    #[test]
    fn a_shadow_of_nothing_is_refused() {
        let source = scratch("src5");
        let shadow_root = scratch("shadow5");
        assert!(ShadowWorkspace::create(&source, &shadow_root, &[]).is_err());
    }

    // The dangerous side of the comparison is "something happened that nobody declared". A
    // shadow holding only the declared paths cannot ever observe that, so `unexpected` is
    // empty because there was nothing else to see — not because nothing else happened.
    #[test]
    fn a_write_nobody_declared_is_observed() {
        let source = scratch("src6");
        fs::write(source.join("declared.txt"), b"a").unwrap();
        fs::write(source.join("nobody-named-me.txt"), b"b").unwrap();
        let shadow_root = scratch("shadow6");
        let shadow =
            ShadowWorkspace::materialise(&source, &shadow_root, ShadowLimits::default()).unwrap();
        assert_eq!(shadow.coverage(), ShadowCoverage::WholeWorkspace);
        assert!(shadow.root().join("nobody-named-me.txt").exists());

        fs::write(shadow.root().join("declared.txt"), b"changed").unwrap();
        fs::write(shadow.root().join("nobody-named-me.txt"), b"touched by accident").unwrap();

        let observed = shadow.observe(vec![]).unwrap();
        assert_eq!(observed.changed.get("declared.txt"), Some(&Change::Modified));
        assert_eq!(
            observed.changed.get("nobody-named-me.txt"),
            Some(&Change::Modified)
        );

        let surprise = compare(&expectation(&["declared.txt"], &[], &[]), &observed).unwrap();
        assert!(!surprise.is_clean());
        assert_eq!(surprise.unexpected, vec!["nobody-named-me.txt".to_string()]);

        // Copy-on-write shares blocks, it does not share writes.
        assert_eq!(fs::read(source.join("nobody-named-me.txt")).unwrap(), b"b");
        shadow.discard().unwrap();
    }

    #[test]
    fn a_file_created_anywhere_in_the_shadow_is_observed() {
        let source = scratch("src7");
        fs::create_dir_all(source.join("src")).unwrap();
        fs::write(source.join("src/a.txt"), b"a").unwrap();
        let shadow_root = scratch("shadow7");
        let shadow =
            ShadowWorkspace::materialise(&source, &shadow_root, ShadowLimits::default()).unwrap();
        fs::create_dir_all(shadow.root().join("src/deep")).unwrap();
        fs::write(shadow.root().join("src/deep/appeared.txt"), b"new").unwrap();
        fs::remove_file(shadow.root().join("src/a.txt")).unwrap();
        let observed = shadow.observe(vec![]).unwrap();
        assert_eq!(
            observed.changed.get("src/deep/appeared.txt"),
            Some(&Change::Created)
        );
        assert_eq!(observed.changed.get("src/a.txt"), Some(&Change::Deleted));
        shadow.discard().unwrap();
    }

    #[test]
    fn the_mechanism_is_probed_on_the_real_directory_never_assumed() {
        let where_it_lives = scratch("probe");
        let probe = probe_copy_on_write(&where_it_lives);
        // Printed, because a wrong FICLONE number would make every assertion here pass while
        // the clone silently never happened: the mechanism a run actually got must be
        // readable, not inferred from a green test.
        println!(
            "PROBE {:?} supported={} at {}",
            probe.mechanism,
            probe.supported,
            where_it_lives.display()
        );
        assert!(probe.measured);
        assert_eq!(
            probe.supported,
            probe.mechanism == ShadowStrategy::ReflinkClone
        );
        assert!(matches!(
            probe.mechanism,
            ShadowStrategy::ReflinkClone | ShadowStrategy::FullCopy
        ));
        // The probe leaves nothing behind, whichever answer it gave.
        assert_eq!(fs::read_dir(&where_it_lives).unwrap().count(), 0);
    }

    #[test]
    fn a_targeted_shadow_says_what_it_cannot_observe() {
        let source = scratch("src8");
        fs::write(source.join("a.txt"), b"a").unwrap();
        let shadow_root = scratch("shadow8");
        let shadow = ShadowWorkspace::create(&source, &shadow_root, &["a.txt".into()]).unwrap();
        assert_eq!(shadow.coverage(), ShadowCoverage::DeclaredPathsOnly);
        assert_eq!(shadow.strategy(), ShadowStrategy::TargetedCopy);
        shadow.discard().unwrap();
    }

    #[test]
    fn a_workspace_larger_than_the_limits_is_refused_not_truncated() {
        let source = scratch("src9");
        for n in 0..5 {
            fs::write(source.join(format!("f{n}.txt")), b"x").unwrap();
        }
        let shadow_root = scratch("shadow9");
        let by_count = ShadowWorkspace::materialise(
            &source,
            &shadow_root,
            ShadowLimits { max_files: 3, max_bytes: DEFAULT_MAX_BYTES },
        );
        assert!(matches!(by_count, Err(ShadowError::Limit { .. })));
        let by_size = ShadowWorkspace::materialise(
            &source,
            &shadow_root,
            ShadowLimits { max_files: DEFAULT_MAX_FILES, max_bytes: 2 },
        );
        assert!(matches!(by_size, Err(ShadowError::Limit { .. })));
        // Refused before anything was written: no half-tree that a reader could mistake
        // for a complete shadow.
        assert_eq!(fs::read_dir(&shadow_root).unwrap().count(), 0);
    }

    #[test]
    fn a_symlink_is_recreated_as_a_link_and_retargeting_it_is_observed() {
        let source = scratch("src10");
        fs::write(source.join("real.txt"), b"content").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("real.txt", source.join("link.txt")).unwrap();
        let shadow_root = scratch("shadow10");
        let shadow =
            ShadowWorkspace::materialise(&source, &shadow_root, ShadowLimits::default()).unwrap();
        let link = shadow.root().join("link.txt");
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        fs::remove_file(&link).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/passwd", &link).unwrap();
        let observed = shadow.observe(vec![]).unwrap();
        // Following the link would have read outside the shadow; digesting where it points
        // catches the retarget without ever reading the target.
        assert_eq!(observed.changed.get("link.txt"), Some(&Change::Modified));
        shadow.discard().unwrap();
    }

    #[test]
    fn a_shadow_inside_the_workspace_it_shadows_is_refused() {
        let source = scratch("src11");
        fs::write(source.join("a.txt"), b"a").unwrap();
        let inside = source.join("shadow-here");
        let error =
            ShadowWorkspace::materialise(&source, &inside, ShadowLimits::default()).unwrap_err();
        assert!(matches!(error, ShadowError::Containment { .. }));
    }
}

/// Resolves a path inside a shadow, with the same containment rule the shadow used when it
/// was built. Exposed so the executor enforces containment through **one** implementation
/// of the rule instead of writing a second one that could disagree with this.
pub fn contained_in(shadow: &ShadowWorkspace, relative: &str) -> Outcome<PathBuf> {
    contained(shadow.root(), relative)
}

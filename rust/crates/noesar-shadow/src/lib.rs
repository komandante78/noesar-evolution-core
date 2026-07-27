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
//! Not a copy-on-write filesystem. Overlayfs and reflinks need privileges or a filesystem
//! that supports them, and neither is guaranteed where this product installs. This copies
//! **only the paths the plan names** — targeted, not a tree clone — and says so through
//! [`ShadowWorkspace::strategy`] rather than letting a reader assume a cheaper mechanism
//! than the one in use.
//!
//! # The comparison is two-sided, and the second side is the dangerous one
//!
//! *Expected and did not happen* is a failure. *Happened and was not expected* is a
//! surprise, and it is the one worth catching: a plan that also touched a file nobody
//! authorised is the exact shape of the accident this whole phase exists to prevent. Both
//! are reported, and [`Surprise::is_clean`] is false if either is non-empty.
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
}

impl std::fmt::Display for ShadowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Containment { path, reason } => write!(f, "containment `{path}`: {reason}"),
            Self::Io { path, reason } => write!(f, "io `{path}`: {reason}"),
            Self::Invalid { field, reason } => write!(f, "invalid `{field}`: {reason}"),
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
}

impl Surprise {
    pub fn is_clean(&self) -> bool {
        self.expected_and_absent.is_empty()
            && self.unexpected.is_empty()
            && self.tests_expected_to_pass_that_failed.is_empty()
            && self.tests_expected_to_fail_that_passed.is_empty()
            && self.tests_never_run.is_empty()
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

    Ok(Surprise {
        expected_and_absent,
        unexpected,
        tests_expected_to_pass_that_failed,
        tests_expected_to_fail_that_passed,
        tests_never_run,
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
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn strategy(&self) -> ShadowStrategy {
        self.strategy
    }

    /// Recomputes every tracked path and reports what moved. Only paths present in the
    /// baseline are looked at: this is a targeted shadow, and claiming to have observed a
    /// path it never copied would be a lie about coverage.
    pub fn observe(&self, tests: Vec<TestResult>) -> Outcome<Observation> {
        let mut changed = BTreeMap::new();
        for (relative, before) in &self.baseline {
            let path = contained(&self.root, relative)?;
            let after = if path.is_file() { Some(digest_of(&path)?) } else { None };
            match (before, &after) {
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
        Ok(Observation { changed, tests })
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
}

/// Resolves a path inside a shadow, with the same containment rule the shadow used when it
/// was built. Exposed so the executor enforces containment through **one** implementation
/// of the rule instead of writing a second one that could disagree with this.
pub fn contained_in(shadow: &ShadowWorkspace, relative: &str) -> Outcome<PathBuf> {
    contained(shadow.root(), relative)
}

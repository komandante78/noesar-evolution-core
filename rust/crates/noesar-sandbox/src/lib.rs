// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-capability isolation (ARCH-008): a capability runs with the limits written in its own
// token, not with the limits of the whole container.
//
// WHY THIS IS SHAPED AS A LADDER, NOT AS A REQUIREMENT
//
// `D-0246` probed the three mechanisms named by `MASTER_PROJECT/03_ARCHITETTURA.md` §7 against a
// real host and found two of them simply absent: Landlock is not compiled into that kernel
// (`landlock_create_ruleset` answers ENOSYS) and the container runtime delegates no writable
// cgroup subtree. The conclusion drawn at the time — ask whether the host may be changed — was
// wrong, and the Owner rejected it: NOESAR EVOLUTION is self-hosted software that is installed
// on arbitrary PCs, servers and operating systems (`CLAUDE10.md` §16). The product never owns
// the host it runs on, so "this host lacks the primitive" is a fact about a *category* of host
// that must be handled, never a blocker.
//
// So isolation is detected at runtime and applied as a ladder, strongest first, with a floor
// that needs nothing from the kernel beyond POSIX:
//
//   TIER 0  RLIMIT + PR_SET_NO_NEW_PRIVS   POSIX/Linux, no kernel config, no delegation,
//                                          no privilege needed to *lower* a limit. Works on
//                                          every host this product can run on at all.
//   TIER 1  seccomp syscall filter         Linux with CONFIG_SECCOMP_FILTER; returns EPERM
//                                          rather than killing, so a refusal is diagnosable.
//   TIER 2  Landlock filesystem confinement Linux with CONFIG_SECURITY_LANDLOCK.
//   TIER 3  cgroup v2 accounting            Linux with a delegated writable subtree.
//
// Tier 0 is the part `D-0246` never considered, and it is the part that makes ARCH-008
// measurable *today, on the host that lacks everything else*: `setrlimit` is per-process, so a
// child can be held to 64 MiB while the container it lives in is allowed 8 GiB. That is exactly
// the criterion — limits per capability, not per container — and it is observable by running it.
//
// What this crate refuses to do: report a tier it did not apply. `AppliedIsolation` records
// what the kernel actually accepted, and every tier that was asked for and did not happen is
// named with its errno. A declared guarantee that nothing enforces is the failure mode this
// whole project exists to avoid.

use std::fmt;

/// The limits a capability token may carry. Every field is optional: a token that names no
/// limit is not silently given a generous one, it is simply not granted that dimension — the
/// caller decides whether that is acceptable (the control plane refuses it for EXECUTE).
///
/// Bytes and seconds rather than "small/medium/large": a limit that cannot be compared against
/// the container's own limit cannot be shown to be tighter than it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IsolationLimits {
    /// Address space, bytes → `RLIMIT_AS`.
    pub memory_bytes: Option<u64>,
    /// CPU time, seconds → `RLIMIT_CPU`. Wall clock is the parent's job, not an rlimit.
    pub cpu_seconds: Option<u64>,
    /// Open file descriptors → `RLIMIT_NOFILE`.
    pub open_files: Option<u64>,
    /// Processes/threads → `RLIMIT_NPROC`.
    pub processes: Option<u64>,
    /// Largest file the capability may create, bytes → `RLIMIT_FSIZE`.
    pub file_size_bytes: Option<u64>,
    /// Core dumps, bytes → `RLIMIT_CORE`. Defaults to refusing them: a core dump of a sandboxed
    /// process is a copy of its memory written outside the sandbox.
    pub core_dump_bytes: Option<u64>,
}

impl IsolationLimits {
    /// TWO DIFFERENT RELATIONS, AND CONFLATING THEM IS A REAL BUG THIS CRATE ALREADY HAD.
    ///
    /// `within` is the **granted-scope** check: does this token stay inside the limits an
    /// approval granted it? Here an unset field means *unlimited*, so it never satisfies a set
    /// ceiling — asking for "no limit on open files" when the grant caps them is widening.
    ///
    /// `exceeds` (below) is the **container-ceiling** check, and it is not the same question. A
    /// child process *inherits* the container's limits, so a dimension this token leaves unset
    /// is not unlimited at all — it is whatever the container already enforces. Refusing an
    /// unset dimension there refuses every ordinary spec.
    ///
    /// The first measured run of this crate refused a perfectly valid 64 MiB spec against an
    /// 8 GiB container, because `within` was used for the ceiling check and the container
    /// reported `openFiles=40960` and `processes=127784` while the spec named neither. The
    /// spec was correct; the relation was wrong.
    pub fn within(&self, other: &IsolationLimits) -> bool {
        fn ok(mine: Option<u64>, ceiling: Option<u64>) -> bool {
            match (mine, ceiling) {
                (_, None) => true,          // no ceiling on this dimension
                (Some(m), Some(c)) => m <= c,
                (None, Some(_)) => false,   // unlimited is never within a limit
            }
        }
        ok(self.memory_bytes, other.memory_bytes)
            && ok(self.cpu_seconds, other.cpu_seconds)
            && ok(self.open_files, other.open_files)
            && ok(self.processes, other.processes)
            && ok(self.file_size_bytes, other.file_size_bytes)
            && ok(self.core_dump_bytes, other.core_dump_bytes)
    }

    /// The container-ceiling check: names the first dimension this token sets *above* what the
    /// container itself allows, or `None` when every dimension it sets is at or below it.
    ///
    /// A dimension left unset is inherited from the container, not granted without limit, so it
    /// is not a violation. Returning the dimension's name rather than a bare bool because a
    /// refusal an operator cannot locate is a refusal they will work around.
    pub fn exceeds(&self, ceiling: &IsolationLimits) -> Option<&'static str> {
        const DIMENSIONS: [(&str, fn(&IsolationLimits) -> Option<u64>); 6] = [
            ("memoryBytes", |limits| limits.memory_bytes),
            ("cpuSeconds", |limits| limits.cpu_seconds),
            ("openFiles", |limits| limits.open_files),
            ("processes", |limits| limits.processes),
            ("fileSizeBytes", |limits| limits.file_size_bytes),
            ("coreDumpBytes", |limits| limits.core_dump_bytes),
        ];
        for (name, read) in DIMENSIONS {
            if let (Some(mine), Some(limit)) = (read(self), read(ceiling)) {
                if mine > limit { return Some(name); }
            }
        }
        None
    }

    /// How many dimensions are actually constrained. Used to refuse a "limits" object that
    /// constrains nothing while looking like it does.
    pub fn constrained_dimensions(&self) -> usize {
        [
            self.memory_bytes, self.cpu_seconds, self.open_files,
            self.processes, self.file_size_bytes, self.core_dump_bytes,
        ]
        .iter()
        .filter(|slot| slot.is_some())
        .count()
    }
}

/// Which mechanisms this host offers, probed rather than assumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IsolationSupport {
    pub rlimit: bool,
    pub no_new_privs: bool,
    pub seccomp_filter: bool,
    pub landlock: bool,
    pub cgroup_v2_writable: bool,
    /// Set when the architecture has no syscall table this crate knows, so a seccomp filter
    /// would have to guess syscall numbers. Guessing there means blocking the wrong call.
    pub seccomp_unsupported_arch: bool,
}

impl IsolationSupport {
    /// The highest tier that is actually usable, named for declaration to an operator.
    pub fn tier(&self) -> u8 {
        if self.cgroup_v2_writable { 3 }
        else if self.landlock { 2 }
        else if self.seccomp_filter { 1 }
        else if self.rlimit { 0 }
        else { 255 } // nothing at all: not an isolation host
    }

    pub fn tier_name(&self) -> &'static str {
        match self.tier() {
            0 => "POSIX_RLIMIT",
            1 => "SECCOMP_FILTER",
            2 => "LANDLOCK",
            3 => "CGROUP_V2",
            _ => "NONE",
        }
    }
}

/// What was actually applied to the current process. Anything asked for and refused is named
/// with its errno instead of being dropped.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppliedIsolation {
    pub rlimits_applied: Vec<&'static str>,
    pub no_new_privs: bool,
    pub seccomp_filter: bool,
    pub blocked_syscalls: usize,
    pub failures: Vec<IsolationFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IsolationFailure {
    pub mechanism: String,
    pub errno: i32,
}

impl fmt::Display for IsolationFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}=errno:{}", self.mechanism, self.errno)
    }
}

impl AppliedIsolation {
    /// A run is only honest if nothing it claims was refused by the kernel.
    pub fn complete(&self) -> bool {
        self.failures.is_empty()
    }
}

// ---------------------------------------------------------------------------------------------
// Platform implementation. Everything that touches the kernel lives below this line so the
// logic above stays testable on any platform.
// ---------------------------------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    // AUDIT_ARCH_* is not exposed by the libc crate; these are the two tables this crate
    // knows. On any other architecture the seccomp filter is declared unsupported rather than
    // installed against guessed syscall numbers.
    #[cfg(target_arch = "x86_64")]
    const AUDIT_ARCH: u32 = 0xC000_003E;
    #[cfg(target_arch = "aarch64")]
    const AUDIT_ARCH: u32 = 0xC000_00B7;

    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    pub const ARCH_KNOWN: bool = true;
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    pub const ARCH_KNOWN: bool = false;

    /// Syscalls a sandboxed capability has no business making. Taken from libc's per-arch
    /// constants rather than written as numbers: hardcoding a syscall table is how a filter
    /// ends up blocking a different call than the one it names.
    ///
    /// Deliberately a denylist of unambiguously privileged operations, not an allowlist: an
    /// allowlist for "arbitrary code" cannot be written without knowing what the code is, and
    /// one that is wrong kills correct programs. This is defence in depth on top of tier 0,
    /// which is where the resource guarantee actually lives.
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    pub fn denied_syscalls() -> Vec<(&'static str, i64)> {
        vec![
            ("ptrace", libc::SYS_ptrace),
            ("mount", libc::SYS_mount),
            ("umount2", libc::SYS_umount2),
            ("pivot_root", libc::SYS_pivot_root),
            ("setns", libc::SYS_setns),
            ("unshare", libc::SYS_unshare),
            ("bpf", libc::SYS_bpf),
            ("perf_event_open", libc::SYS_perf_event_open),
            ("kexec_load", libc::SYS_kexec_load),
            ("init_module", libc::SYS_init_module),
            ("finit_module", libc::SYS_finit_module),
            ("delete_module", libc::SYS_delete_module),
            ("add_key", libc::SYS_add_key),
            ("request_key", libc::SYS_request_key),
            ("keyctl", libc::SYS_keyctl),
            ("userfaultfd", libc::SYS_userfaultfd),
            ("process_vm_readv", libc::SYS_process_vm_readv),
            ("process_vm_writev", libc::SYS_process_vm_writev),
        ]
    }

    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    pub fn denied_syscalls() -> Vec<(&'static str, i64)> { Vec::new() }

    pub fn detect() -> IsolationSupport {
        let mut support = IsolationSupport::default();

        // RLIMIT: reading one back is the probe. If getrlimit works, setrlimit downward works —
        // lowering a soft limit needs no privilege on any POSIX system.
        let mut probe = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        support.rlimit = unsafe { libc::getrlimit(libc::RLIMIT_AS, &mut probe) } == 0;

        // PR_SET_NO_NEW_PRIVS is queried, not set: setting it here would leak into the parent.
        support.no_new_privs = unsafe { libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) } >= 0;

        // seccomp: ask the kernel whether filter mode exists, without installing anything.
        // SECCOMP_SET_MODE_FILTER with a null program answers EFAULT when the mode is
        // supported and EINVAL when it is not — the distinction is the probe. ENOSYS means
        // the syscall itself is absent.
        support.seccomp_filter = if ARCH_KNOWN {
            let result = unsafe {
                libc::syscall(libc::SYS_seccomp, 1 /* SET_MODE_FILTER */, 0, std::ptr::null::<u8>())
            };
            result == -1 && errno() == libc::EFAULT
        } else {
            false
        };
        support.seccomp_unsupported_arch = !ARCH_KNOWN;

        // Landlock: the ABI-version query is the documented probe and mutates nothing.
        // ENOSYS here is exactly what `D-0246` measured on the development host.
        let landlock = unsafe {
            libc::syscall(
                444, /* landlock_create_ruleset */
                std::ptr::null::<u8>(), 0usize, 1u32, /* LANDLOCK_CREATE_RULESET_VERSION */
            )
        };
        support.landlock = landlock > 0;

        // cgroup v2: mounted is not the same as delegated. The question is whether *this*
        // process may write a limit, and the only honest answer comes from trying.
        support.cgroup_v2_writable = cgroup_v2_writable();

        support
    }

    fn cgroup_v2_writable() -> bool {
        // A writable subtree shows up as an accessible cgroup.subtree_control we may open for
        // writing. Opening with O_WRONLY does not modify anything.
        for candidate in ["/sys/fs/cgroup/cgroup.subtree_control", "/sys/fs/cgroup/cgroup.procs"] {
            let path = match std::ffi::CString::new(candidate) { Ok(value) => value, Err(_) => continue };
            let fd = unsafe { libc::open(path.as_ptr(), libc::O_WRONLY) };
            if fd >= 0 {
                unsafe { libc::close(fd) };
                return true;
            }
        }
        false
    }

    fn errno() -> i32 {
        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
    }

    // glibc types an rlimit resource as `__rlimit_resource_t` (u32); musl and the BSDs use
    // `c_int` (i32). Aliasing it rather than casting at each call site: the product image is
    // Debian today, but nothing in the platform law (§16) lets this crate assume that, and a
    // wrong cast here would silently address the wrong resource.
    #[cfg(target_env = "gnu")]
    type RlimitResource = libc::__rlimit_resource_t;
    #[cfg(not(target_env = "gnu"))]
    type RlimitResource = libc::c_int;

    fn set_rlimit(resource: RlimitResource, value: u64, name: &'static str,
                  applied: &mut AppliedIsolation) {
        // The hard limit is lowered with the soft limit. Leaving the hard limit high would let
        // the sandboxed process raise its own soft limit back up — a limit it can undo is not a
        // limit, and this is the mistake that makes rlimit sandboxes ornamental.
        let limit = libc::rlimit { rlim_cur: value, rlim_max: value };
        if unsafe { libc::setrlimit(resource, &limit) } == 0 {
            applied.rlimits_applied.push(name);
        } else {
            applied.failures.push(IsolationFailure { mechanism: name.to_string(), errno: errno() });
        }
    }

    /// Apply the limits to the CURRENT process. Called between fork and exec, so everything
    /// here lands on the child and nothing on the parent.
    pub fn apply(limits: &IsolationLimits, support: &IsolationSupport) -> AppliedIsolation {
        let mut applied = AppliedIsolation::default();

        if support.rlimit {
            if let Some(value) = limits.memory_bytes { set_rlimit(libc::RLIMIT_AS, value, "RLIMIT_AS", &mut applied); }
            if let Some(value) = limits.cpu_seconds { set_rlimit(libc::RLIMIT_CPU, value, "RLIMIT_CPU", &mut applied); }
            if let Some(value) = limits.open_files { set_rlimit(libc::RLIMIT_NOFILE, value, "RLIMIT_NOFILE", &mut applied); }
            if let Some(value) = limits.processes { set_rlimit(libc::RLIMIT_NPROC, value, "RLIMIT_NPROC", &mut applied); }
            if let Some(value) = limits.file_size_bytes { set_rlimit(libc::RLIMIT_FSIZE, value, "RLIMIT_FSIZE", &mut applied); }
            // Absent means "no core dumps", not "unlimited": a core dump is a copy of the
            // sandbox's memory written outside it.
            set_rlimit(libc::RLIMIT_CORE, limits.core_dump_bytes.unwrap_or(0), "RLIMIT_CORE", &mut applied);
        } else {
            applied.failures.push(IsolationFailure { mechanism: "RLIMIT".into(), errno: libc::ENOSYS });
        }

        // Before seccomp, and unconditionally: a filter that a setuid binary can escape is not
        // a filter. PR_SET_NO_NEW_PRIVS is also seccomp's own precondition for unprivileged use.
        if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } == 0 {
            applied.no_new_privs = true;
        } else {
            applied.failures.push(IsolationFailure { mechanism: "NO_NEW_PRIVS".into(), errno: errno() });
        }

        if support.seccomp_filter && applied.no_new_privs {
            match install_seccomp_filter() {
                Ok(count) => { applied.seccomp_filter = true; applied.blocked_syscalls = count; }
                Err(code) => applied.failures.push(IsolationFailure { mechanism: "SECCOMP_FILTER".into(), errno: code }),
            }
        }

        applied
    }

    /// A classic-BPF seccomp program: check the architecture, then refuse a fixed set of
    /// syscalls with EPERM.
    ///
    /// EPERM rather than SECCOMP_RET_KILL_PROCESS on purpose. A killed process gives an
    /// operator a signal and no reason; EPERM surfaces as an ordinary permission error the
    /// program can report, which is the difference between a diagnosable refusal and a mystery.
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    fn install_seccomp_filter() -> Result<usize, i32> {
        const BPF_LD: u16 = 0x00;
        const BPF_W: u16 = 0x00;
        const BPF_ABS: u16 = 0x20;
        const BPF_JMP: u16 = 0x05;
        const BPF_JEQ: u16 = 0x10;
        const BPF_K: u16 = 0x00;
        const BPF_RET: u16 = 0x06;

        const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;
        const SECCOMP_RET_ERRNO: u32 = 0x0005_0000;

        // Offsets into struct seccomp_data: nr at 0, arch at 4.
        const OFFSET_NR: u32 = 0;
        const OFFSET_ARCH: u32 = 4;

        #[repr(C)]
        struct SockFilter { code: u16, jt: u8, jf: u8, k: u32 }
        #[repr(C)]
        struct SockFprog { len: u16, filter: *const SockFilter }

        let denied = denied_syscalls();
        let count = denied.len();
        if count == 0 || count > 250 { return Err(libc::EINVAL); }

        // Layout, so the jump arithmetic below is checkable by reading it:
        //   [0]            LD   arch
        //   [1]            JEQ  AUDIT_ARCH   jt=0 (fall through)  jf=-> ERRNO
        //   [2]            LD   nr
        //   [3 .. 3+N-1]   JEQ  denied[i]    jt=-> ERRNO          jf=0 (next test)
        //   [3+N]          RET  ALLOW
        //   [3+N+1]        RET  ERRNO
        // From index 1 the ERRNO instruction is at 3+N+1, i.e. (3+N+1)-(1+1) = N+2 ahead.
        // From index 3+i it is (3+N+1)-(3+i+1) = N-i ahead. Both fit u8 for N <= 250.
        let n = count as u8;
        let mut program: Vec<SockFilter> = Vec::with_capacity(count + 4);
        program.push(SockFilter { code: BPF_LD | BPF_W | BPF_ABS, jt: 0, jf: 0, k: OFFSET_ARCH });
        program.push(SockFilter { code: BPF_JMP | BPF_JEQ | BPF_K, jt: 0, jf: n + 2, k: AUDIT_ARCH });
        program.push(SockFilter { code: BPF_LD | BPF_W | BPF_ABS, jt: 0, jf: 0, k: OFFSET_NR });
        for (index, (_, number)) in denied.iter().enumerate() {
            program.push(SockFilter {
                code: BPF_JMP | BPF_JEQ | BPF_K,
                jt: n - index as u8,
                jf: 0,
                k: *number as u32,
            });
        }
        program.push(SockFilter { code: BPF_RET | BPF_K, jt: 0, jf: 0, k: SECCOMP_RET_ALLOW });
        program.push(SockFilter {
            code: BPF_RET | BPF_K, jt: 0, jf: 0,
            k: SECCOMP_RET_ERRNO | (libc::EPERM as u32 & 0x0000_ffff),
        });

        let fprog = SockFprog { len: program.len() as u16, filter: program.as_ptr() };
        // SECCOMP_SET_MODE_FILTER = 1. No flags: SECCOMP_FILTER_FLAG_TSYNC is pointless in a
        // single-threaded pre-exec child and would fail if any thread could not be synced.
        let result = unsafe {
            libc::syscall(libc::SYS_seccomp, 1, 0, &fprog as *const SockFprog)
        };
        if result == 0 { Ok(count) } else { Err(errno()) }
    }

    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    fn install_seccomp_filter() -> Result<usize, i32> { Err(libc::ENOSYS) }

    /// The container's own limits, which are the ceiling a token may not exceed.
    pub fn container_ceiling() -> IsolationLimits {
        fn current(resource: RlimitResource) -> Option<u64> {
            let mut limit = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
            if unsafe { libc::getrlimit(resource, &mut limit) } != 0 { return None; }
            if limit.rlim_max == libc::RLIM_INFINITY { None } else { Some(limit.rlim_max) }
        }
        IsolationLimits {
            memory_bytes: current(libc::RLIMIT_AS).or_else(cgroup_memory_max),
            cpu_seconds: current(libc::RLIMIT_CPU),
            open_files: current(libc::RLIMIT_NOFILE),
            processes: current(libc::RLIMIT_NPROC),
            file_size_bytes: current(libc::RLIMIT_FSIZE),
            core_dump_bytes: current(libc::RLIMIT_CORE),
        }
    }

    /// A container usually caps memory through cgroup, not RLIMIT_AS, so the rlimit reads
    /// unlimited while the real ceiling is elsewhere. Reading it is what makes "tighter than
    /// the container" a measured claim instead of an assumed one.
    fn cgroup_memory_max() -> Option<u64> {
        for candidate in ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"] {
            if let Ok(text) = std::fs::read_to_string(candidate) {
                let trimmed = text.trim();
                if trimmed == "max" { continue; }
                if let Ok(value) = trimmed.parse::<u64>() {
                    // A cgroup with no limit reports a sentinel near u64::MAX rather than "max".
                    if value < u64::MAX / 2 { return Some(value); }
                }
            }
        }
        None
    }
}

#[cfg(not(target_os = "linux"))]
mod platform {
    use super::*;

    // Not a stub that pretends: on a non-Linux host the POSIX floor is still real, and
    // everything above it is honestly reported as absent. macOS and the BSDs have setrlimit.
    pub const ARCH_KNOWN: bool = false;
    pub fn denied_syscalls() -> Vec<(&'static str, i64)> { Vec::new() }

    pub fn detect() -> IsolationSupport {
        IsolationSupport {
            rlimit: cfg!(unix),
            no_new_privs: false,
            seccomp_filter: false,
            landlock: false,
            cgroup_v2_writable: false,
            seccomp_unsupported_arch: true,
        }
    }

    pub fn apply(_limits: &IsolationLimits, _support: &IsolationSupport) -> AppliedIsolation {
        AppliedIsolation {
            failures: vec![IsolationFailure { mechanism: "PLATFORM".into(), errno: 0 }],
            ..Default::default()
        }
    }

    pub fn container_ceiling() -> IsolationLimits { IsolationLimits::default() }
}

pub use platform::{apply, container_ceiling, denied_syscalls, detect};

#[cfg(test)]
mod tests {
    use super::*;

    fn limits(memory: Option<u64>, cpu: Option<u64>) -> IsolationLimits {
        IsolationLimits { memory_bytes: memory, cpu_seconds: cpu, ..Default::default() }
    }

    #[test]
    fn tighter_limits_are_within_a_looser_ceiling() {
        assert!(limits(Some(64), Some(5)).within(&limits(Some(128), Some(10))));
    }

    #[test]
    fn equal_limits_are_within_the_ceiling() {
        assert!(limits(Some(128), Some(10)).within(&limits(Some(128), Some(10))));
    }

    #[test]
    fn a_wider_limit_is_refused_not_clamped() {
        assert!(!limits(Some(256), Some(5)).within(&limits(Some(128), Some(10))));
    }

    #[test]
    fn unlimited_is_never_within_a_limited_ceiling() {
        // The dangerous direction: omitting a field must not read as "fine".
        assert!(!limits(None, Some(5)).within(&limits(Some(128), Some(10))));
    }

    #[test]
    fn any_limit_is_within_an_unlimited_ceiling() {
        assert!(limits(Some(1), Some(1)).within(&IsolationLimits::default()));
        assert!(IsolationLimits::default().within(&IsolationLimits::default()));
    }

    #[test]
    fn constrained_dimensions_counts_only_set_fields() {
        assert_eq!(IsolationLimits::default().constrained_dimensions(), 0);
        assert_eq!(limits(Some(1), None).constrained_dimensions(), 1);
        assert_eq!(limits(Some(1), Some(2)).constrained_dimensions(), 2);
    }

    #[test]
    fn tier_reports_the_highest_usable_mechanism() {
        let mut support = IsolationSupport::default();
        assert_eq!(support.tier_name(), "NONE");
        support.rlimit = true;
        assert_eq!(support.tier_name(), "POSIX_RLIMIT");
        support.seccomp_filter = true;
        assert_eq!(support.tier_name(), "SECCOMP_FILTER");
        support.landlock = true;
        assert_eq!(support.tier_name(), "LANDLOCK");
        support.cgroup_v2_writable = true;
        assert_eq!(support.tier_name(), "CGROUP_V2");
    }

    #[test]
    fn detection_finds_the_posix_floor_on_any_supported_host() {
        // The point of the ladder: whatever else is missing, tier 0 is there. If this ever
        // fails, the host cannot run a sandbox at all and must be told so, not defaulted.
        let support = detect();
        assert!(support.rlimit, "setrlimit must exist for the baseline tier to hold");
    }

    #[test]
    fn exceeds_ignores_dimensions_the_token_leaves_to_the_container() {
        // The bug the first measured run found: a real container reports openFiles and
        // processes, an ordinary spec names neither, and that must not be a refusal.
        let ceiling = IsolationLimits {
            memory_bytes: Some(8 * 1024 * 1024 * 1024),
            open_files: Some(40960),
            processes: Some(127784),
            core_dump_bytes: Some(0),
            ..Default::default()
        };
        let spec = limits(Some(64 * 1024 * 1024), Some(10));
        assert_eq!(spec.exceeds(&ceiling), None, "64 MiB must be accepted under an 8 GiB ceiling");
        // ...while `within` still refuses it, because it answers the other question.
        assert!(!spec.within(&ceiling), "within must stay strict: it guards the granted scope");
    }

    #[test]
    fn exceeds_names_the_dimension_that_is_too_wide() {
        let ceiling = IsolationLimits { memory_bytes: Some(1024), ..Default::default() };
        let spec = IsolationLimits { memory_bytes: Some(4096), ..Default::default() };
        assert_eq!(spec.exceeds(&ceiling), Some("memoryBytes"));
    }

    #[test]
    fn exceeds_accepts_equality_at_the_ceiling() {
        let ceiling = IsolationLimits { memory_bytes: Some(1024), ..Default::default() };
        let spec = IsolationLimits { memory_bytes: Some(1024), ..Default::default() };
        assert_eq!(spec.exceeds(&ceiling), None);
    }

    #[test]
    fn exceeds_checks_every_dimension_not_just_memory() {
        let ceiling = IsolationLimits {
            memory_bytes: Some(4096), cpu_seconds: Some(10), open_files: Some(64),
            processes: Some(8), file_size_bytes: Some(1000), core_dump_bytes: Some(0),
        };
        assert_eq!(IsolationLimits { cpu_seconds: Some(11), ..ceiling }.exceeds(&ceiling), Some("cpuSeconds"));
        assert_eq!(IsolationLimits { open_files: Some(65), ..ceiling }.exceeds(&ceiling), Some("openFiles"));
        assert_eq!(IsolationLimits { processes: Some(9), ..ceiling }.exceeds(&ceiling), Some("processes"));
        assert_eq!(IsolationLimits { file_size_bytes: Some(1001), ..ceiling }.exceeds(&ceiling), Some("fileSizeBytes"));
        assert_eq!(IsolationLimits { core_dump_bytes: Some(1), ..ceiling }.exceeds(&ceiling), Some("coreDumpBytes"));
    }

    #[test]
    fn the_container_ceiling_is_readable() {
        // Not asserting values: they differ per host by design. Asserting the call is safe and
        // that a ceiling with any dimension set is comparable.
        let ceiling = container_ceiling();
        let tiny = IsolationLimits { memory_bytes: Some(1024), ..Default::default() };
        if ceiling.memory_bytes.is_some() {
            assert!(tiny.within(&ceiling), "1 KiB must be within any real container ceiling");
        }
    }

    #[test]
    fn the_denylist_has_no_duplicates_and_names_every_entry() {
        let denied = denied_syscalls();
        if denied.is_empty() { return; } // unsupported architecture, declared elsewhere
        let mut numbers: Vec<i64> = denied.iter().map(|(_, number)| *number).collect();
        numbers.sort_unstable();
        let before = numbers.len();
        numbers.dedup();
        assert_eq!(before, numbers.len(), "a duplicated syscall means a miscounted jump offset");
        for (name, _) in &denied {
            assert!(!name.is_empty(), "an unnamed blocked syscall cannot be reported");
        }
    }
}

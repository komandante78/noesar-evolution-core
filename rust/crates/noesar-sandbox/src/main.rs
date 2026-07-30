// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `noesar-sandbox` — applies a capability token's own limits to a child process, then becomes
// that child. ARCH-008's enforcement point.
//
// The control plane (JavaScript, one long-lived process serving every request on one event
// loop) cannot do this itself, and that is not an implementation gap: a seccomp filter or an
// rlimit installed in that process would narrow it permanently, for every later request, which
// is the opposite of per-capability. `D-0246` named this exact obstacle. So the limits are
// applied in a short-lived process that exists only for one spent token, and this binary is it.
//
// Two modes, both deliberately dull:
//
//   noesar-sandbox --detect
//       Print what this host offers and what the container's own ceiling is, as JSON. Probes
//       only: nothing is installed, no child is started. This is what an installation reports
//       so the isolation level is *declared* rather than assumed.
//
//   noesar-sandbox --spec <file.json> -- <command> [args...]
//       Read limits, apply them to this process, then exec the command. Because the limits are
//       applied before exec, the command inherits them and cannot have run a single instruction
//       under looser ones. `--spec` is a file rather than an argument so limits never appear in
//       a process listing.
//
// The order is the security property, exactly as in `executor.mjs`: limits are applied BEFORE
// the child exists. A failure to apply them means the child never runs. There is no path here
// that starts a process and then tries to confine it.

use std::io::Write;

use noesar_sandbox::{apply, container_ceiling, detect, AppliedIsolation, IsolationLimits};

fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other if (other as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", other as u32)),
            other => out.push(other),
        }
    }
    out
}

fn limit_json(name: &str, value: Option<u64>) -> String {
    match value {
        Some(number) => format!("\"{name}\":{number}"),
        None => format!("\"{name}\":null"),
    }
}

fn limits_json(limits: &IsolationLimits) -> String {
    format!(
        "{{{},{},{},{},{},{}}}",
        limit_json("memoryBytes", limits.memory_bytes),
        limit_json("cpuSeconds", limits.cpu_seconds),
        limit_json("openFiles", limits.open_files),
        limit_json("processes", limits.processes),
        limit_json("fileSizeBytes", limits.file_size_bytes),
        limit_json("coreDumpBytes", limits.core_dump_bytes),
    )
}

fn applied_json(applied: &AppliedIsolation) -> String {
    let rlimits = applied
        .rlimits_applied
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(",");
    let failures = applied
        .failures
        .iter()
        .map(|failure| format!(
            "{{\"mechanism\":\"{}\",\"errno\":{}}}",
            escape(&failure.mechanism), failure.errno
        ))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"rlimitsApplied\":[{rlimits}],\"noNewPrivs\":{},\"seccompFilter\":{},\
\"blockedSyscalls\":{},\"complete\":{},\"failures\":[{failures}]}}",
        applied.no_new_privs, applied.seccomp_filter, applied.blocked_syscalls, applied.complete(),
    )
}

/// A deliberately small JSON reader for a file this program's own control plane writes.
///
/// Not a general parser, and it does not pretend to be: it accepts a flat object of
/// number-or-null fields and refuses everything else, including nested objects and strings.
/// Pulling in a JSON crate for six integers would add a dependency to the one binary in this
/// workspace that runs with the fewest guarantees around it.
fn parse_limits(text: &str) -> Result<IsolationLimits, String> {
    let trimmed = text.trim();
    let body = trimmed
        .strip_prefix('{')
        .and_then(|rest| rest.strip_suffix('}'))
        .ok_or_else(|| "a limits spec must be a single JSON object".to_string())?;

    let mut limits = IsolationLimits::default();
    let mut seen = 0usize;

    for field in body.split(',') {
        let field = field.trim();
        if field.is_empty() { continue; }
        let (raw_key, raw_value) = field
            .split_once(':')
            .ok_or_else(|| format!("field `{field}` is not `key: value`"))?;
        let key = raw_key.trim().trim_matches('"');
        let value = raw_value.trim();

        let parsed = if value == "null" {
            None
        } else {
            // Rejecting a quoted number on purpose: "1e9" or " 12 " arriving as a string is a
            // sign the caller built the spec by hand, and guessing what it meant is how a
            // limit becomes larger than intended.
            Some(value.parse::<u64>().map_err(|_| {
                format!("field `{key}` must be an unquoted non-negative integer or null, got `{value}`")
            })?)
        };

        match key {
            "memoryBytes" => limits.memory_bytes = parsed,
            "cpuSeconds" => limits.cpu_seconds = parsed,
            "openFiles" => limits.open_files = parsed,
            "processes" => limits.processes = parsed,
            "fileSizeBytes" => limits.file_size_bytes = parsed,
            "coreDumpBytes" => limits.core_dump_bytes = parsed,
            other => return Err(format!("unknown limit `{other}`")),
        }
        seen += 1;
    }

    if seen == 0 {
        return Err("a limits spec naming no dimension confines nothing".to_string());
    }
    Ok(limits)
}

fn fail(message: &str) -> ! {
    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "{{\"sandbox\":\"REFUSED\",\"reason\":\"{}\"}}", escape(message));
    // 78 = EX_CONFIG. Distinct from any exit status the child could plausibly return, so a
    // refusal by the sandbox is never mistaken for a result from the command.
    std::process::exit(78);
}

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();

    if arguments.is_empty() || arguments[0] == "--help" {
        println!("noesar-sandbox --detect");
        println!("noesar-sandbox --spec <file.json> -- <command> [args...]");
        return;
    }

    if arguments[0] == "--detect" {
        let support = detect();
        let ceiling = container_ceiling();
        println!(
            "{{\"tier\":{},\"tierName\":\"{}\",\"support\":{{\"rlimit\":{},\"noNewPrivs\":{},\
\"seccompFilter\":{},\"landlock\":{},\"cgroupV2Writable\":{},\"seccompUnsupportedArch\":{}}},\
\"containerCeiling\":{},\"deniedSyscalls\":{}}}",
            support.tier(), support.tier_name(), support.rlimit, support.no_new_privs,
            support.seccomp_filter, support.landlock, support.cgroup_v2_writable,
            support.seccomp_unsupported_arch, limits_json(&ceiling),
            noesar_sandbox::denied_syscalls().len(),
        );
        return;
    }

    if arguments[0] != "--spec" || arguments.len() < 2 {
        fail("usage: --detect | --spec <file.json> -- <command> [args...]");
    }

    let spec_path = &arguments[1];
    let separator = arguments.iter().position(|argument| argument == "--");
    let command: Vec<String> = match separator {
        Some(index) if index + 1 < arguments.len() => arguments[index + 1..].to_vec(),
        _ => fail("no command given after `--`"),
    };

    let text = match std::fs::read_to_string(spec_path) {
        Ok(value) => value,
        Err(error) => fail(&format!("cannot read spec `{spec_path}`: {error}")),
    };
    let limits = match parse_limits(&text) {
        Ok(value) => value,
        Err(reason) => fail(&reason),
    };

    // The ceiling is re-derived here, in the process that will actually be confined, rather
    // than trusted from the caller. The control plane checks it too when minting; this is the
    // same rule enforced where it takes effect, not a second opinion about it.
    let ceiling = container_ceiling();
    if let Some(dimension) = limits.exceeds(&ceiling) {
        // `exceeds`, not `within`: a dimension this spec leaves unset is inherited from the
        // container, not granted without limit. Using `within` here refused every ordinary
        // spec — see the comment on both relations in lib.rs.
        fail(&format!(
            "limit `{dimension}` is wider than this container's own ceiling; a sandbox cannot grant more than the container it runs in"
        ));
    }

    let support = detect();
    let applied = apply(&limits, &support);

    // Reported before exec, on stderr, as one line: after exec this process is gone and could
    // not report anything. The parent records this as what was actually enforced — a claim
    // about isolation that nothing measured is exactly what this project forbids.
    let mut stderr = std::io::stderr();
    let _ = writeln!(
        stderr,
        "{{\"sandbox\":\"APPLIED\",\"tier\":{},\"tierName\":\"{}\",\"limits\":{},\"applied\":{}}}",
        support.tier(), support.tier_name(), limits_json(&limits), applied_json(&applied)
    );
    let _ = stderr.flush();

    if !applied.complete() {
        // Fail closed. A child started under limits the kernel refused would be a child running
        // with the container's limits while the audit trail says otherwise.
        fail("the kernel refused part of the requested isolation; the command was not started");
    }

    let program = std::ffi::CString::new(command[0].clone())
        .unwrap_or_else(|_| { fail("the command contains a NUL byte"); });
    let argv: Vec<std::ffi::CString> = command
        .iter()
        .map(|argument| std::ffi::CString::new(argument.clone())
            .unwrap_or_else(|_| { fail("an argument contains a NUL byte"); }))
        .collect();
    let mut pointers: Vec<*const libc::c_char> = argv.iter().map(|value| value.as_ptr()).collect();
    pointers.push(std::ptr::null());

    // execvp, so the child replaces this process: no supervisor sitting between the caller and
    // the command, and no chance of the command outliving its limits.
    unsafe { libc::execvp(program.as_ptr(), pointers.as_ptr()); }

    // Only reachable if exec failed.
    let error = std::io::Error::last_os_error();
    fail(&format!("cannot execute `{}`: {}", command[0], error));
}

#[cfg(test)]
mod tests {
    use super::parse_limits;

    #[test]
    fn parses_a_flat_spec() {
        let limits = parse_limits("{\"memoryBytes\":67108864,\"cpuSeconds\":5}").unwrap();
        assert_eq!(limits.memory_bytes, Some(67108864));
        assert_eq!(limits.cpu_seconds, Some(5));
        assert_eq!(limits.open_files, None);
    }

    #[test]
    fn null_means_unconstrained_not_zero() {
        let limits = parse_limits("{\"memoryBytes\":null,\"cpuSeconds\":1}").unwrap();
        assert_eq!(limits.memory_bytes, None);
        assert_eq!(limits.cpu_seconds, Some(1));
    }

    #[test]
    fn refuses_a_spec_that_constrains_nothing() {
        assert!(parse_limits("{}").is_err());
    }

    #[test]
    fn refuses_an_unknown_limit_rather_than_ignoring_it() {
        // Silently dropping it would apply less isolation than the caller asked for.
        assert!(parse_limits("{\"memoryBytez\":1}").is_err());
    }

    #[test]
    fn refuses_a_quoted_number() {
        assert!(parse_limits("{\"memoryBytes\":\"64\"}").is_err());
    }

    #[test]
    fn refuses_a_negative_or_fractional_limit() {
        assert!(parse_limits("{\"memoryBytes\":-1}").is_err());
        assert!(parse_limits("{\"cpuSeconds\":1.5}").is_err());
    }

    #[test]
    fn refuses_something_that_is_not_an_object() {
        assert!(parse_limits("[1,2]").is_err());
        assert!(parse_limits("64").is_err());
    }
}

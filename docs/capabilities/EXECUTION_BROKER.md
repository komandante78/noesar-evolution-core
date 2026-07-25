# Capability Execution Broker

The broker forbids shell strings, requires an absolute executable under a
trusted root, rejects symlinks, uses an empty controlled environment, creates a
private ephemeral working directory, applies CPU, memory, file-size, output,
descriptor and process limits, kills timed-out process groups, destroys the
workspace and writes a receipt containing command hash rather than arguments.

Process containment does not constitute OS isolation. Network denial is only
kernel-enforced in the attested `os-isolated` profile.

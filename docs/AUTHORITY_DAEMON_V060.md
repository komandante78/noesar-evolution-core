# Authority Daemon V0.6.0

The Linux source path uses a private Unix-domain socket and `SO_PEERCRED`.

Required runtime inputs:

- absolute socket path under a non-world-writable directory;
- allowed Unix UID list;
- private HMAC secret file;
- maximum connection count.

The daemon rejects unauthorized UIDs, symlink secret files, unsafe secret
permissions, invalid clients, replayed envelopes, multiple requests on one
connection and malformed frames.

The daemon was not compiled or executed in this artifact environment.

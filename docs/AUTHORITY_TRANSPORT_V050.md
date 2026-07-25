# Authority Transport V0.5.0

The transport contract uses:

- authenticated Unix-domain sockets or Windows named pipes;
- peer UID/PID or SID binding;
- four-byte unsigned big-endian frame length;
- canonical UTF-8 JSON;
- maximum frame size of one MiB;
- partial-frame buffering;
- rejection of zero, oversized, malformed and non-object frames.

This package contains executable Node reference tests and Rust source. No
production transport was activated.

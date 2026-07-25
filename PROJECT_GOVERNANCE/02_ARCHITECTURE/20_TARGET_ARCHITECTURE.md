# Target Architecture

Default topology is one external OCI container containing a Rust supervisor,
Control Plane, Security Kernel, WebUI, internal PostgreSQL, supervised Python
workers, WASM workers, runtime adapters, audit and update services, with
persistent `/workspace`.

Logical planes are Control, Cognitive and Data. The default is a modular
monolith with typed contracts and process isolation. Enterprise may explicitly
separate services.

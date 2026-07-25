# Security Kernel

The Security Kernel is an independent Rust authority outside the model. It
contains the Policy Decision Point, Identity Guard, Capability Token Broker,
Path Authorization Broker, Network Egress Broker, Secret Broker, Model Trust
Registry, Update Trust Verifier, Sandbox Manager, Resource Governor, Audit
Ledger and Emergency Stop.

Natural-language content is never an authorization token. Instructions from
users, documents, web pages, tools, MCP servers, agents or memory remain
untrusted data until an authenticated actor and policy grant a bounded
capability. Default-deny covers shell, host filesystem, network, secrets,
database/memory mutation, model download, runtime install, sensors, physical
actuation and core mutation.

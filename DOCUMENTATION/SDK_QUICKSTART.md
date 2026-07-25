
# SDK quickstart

SDK source is under `CAPABILITIES_AND_SDK/packages/sdk/`.

Typical integration flow:

1. validate a capability manifest against the canonical schema;
2. resolve publisher identity and signature policy;
3. request explicit permissions;
4. issue a scoped execution ticket;
5. execute through the broker/sandbox boundary;
6. verify the execution receipt and audit record;
7. quarantine or roll back on policy failure.

Examples are supplied under `CAPABILITIES_AND_SDK/capabilities/examples/`.

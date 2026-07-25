# Interface and Event Contracts

Public APIs cover identity, projects, tasks, approvals, documents, agents,
workflows, models, hardware, capabilities, licensing, audit and updates.

Events include ID, type, schema version, UTC time, actor, tenant, correlation,
causation, resource, classification and payload digest.

Stable adapter contracts include ReasoningProvider, ModelRuntimeAdapter,
HardwareProbeAdapter, VectorStoreAdapter, ObjectStoreAdapter,
IndustryModuleProvider, CompliancePackProvider and HostBridgeAdapter. Adapters
cannot self-grant permissions.

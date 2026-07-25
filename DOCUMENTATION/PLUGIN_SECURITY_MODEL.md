
# Plugin and capability security model

The governing sequence is: AI proposes; policy decides; user or policy authorizes; sandbox executes; verifier checks; audit records. Default deny applies to shell, host filesystem, network, secrets, database mutation, memory promotion, model installation, sensors, physical actuation and core mutation.

B003 remains open because OS-level enforcement has not yet been completed and validated.

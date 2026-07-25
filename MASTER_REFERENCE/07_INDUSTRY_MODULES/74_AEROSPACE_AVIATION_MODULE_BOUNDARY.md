# Aerospace and Aviation Module Boundary

## Core-permitted use
- requirements analysis
- maintenance knowledge
- simulation support
- document traceability
- anomaly review

## Separate module and validation required
- flight-control decisions
- airborne release authority
- autonomous vehicle actuation
- unreviewed certified-code generation

## Required controls
- requirements traceability
- configuration baselines
- deterministic replay
- locked models
- independent verification
- tool qualification mode
- human sign-off
- external certified controller

```text
FLIGHT_CONTROL=false
AUTONOMOUS_ACTUATION=false
CERTIFIED_PATH_LOCKED_MODEL=true
```

Validation applies to the exact intended use, release, models, data, workflow,
jurisdiction and deployment. The core does not inherit the module's status.

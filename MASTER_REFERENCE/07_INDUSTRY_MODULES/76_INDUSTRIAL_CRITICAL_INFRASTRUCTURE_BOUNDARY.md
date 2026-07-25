# Industrial and Critical Infrastructure Boundary

## Core-permitted use
- predictive maintenance analysis
- quality analysis
- digital-twin review
- documentation
- read-only telemetry

## Separate module and validation required
- PLC/SCADA writes
- safety shutdown authority
- energy dispatch
- robot/machinery control

## Required controls
- read-only default
- asset allowlist
- separate physical gateway
- rate/range limits
- human authorization
- certified safety controller
- emergency disconnect
- segmentation

```text
INDUSTRIAL_WRITE=false
SAFETY_CONTROLLER_AUTHORITY=false
READ_ONLY_TELEMETRY=true
```

Validation applies to the exact intended use, release, models, data, workflow,
jurisdiction and deployment. The core does not inherit the module's status.

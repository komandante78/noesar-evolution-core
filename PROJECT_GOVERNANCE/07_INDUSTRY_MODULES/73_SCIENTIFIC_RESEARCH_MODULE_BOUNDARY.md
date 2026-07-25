# Scientific Research Module Boundary

## Core-permitted use
- literature review
- dataset analysis
- reproducible reports
- simulation support
- research knowledge

## Separate module and validation required
- laboratory instrument control
- regulated clinical records
- validated GxP workflows
- institution-specific LIMS/ELN

## Required controls
- dataset provenance
- FAIR metadata
- experiment lineage
- environment lock
- units/uncertainty
- citation integrity
- ELN/LIMS connectors
- reproducible pipelines

```text
RAW_DATA_IMMUTABILITY=true
PROVENANCE_REQUIRED=true
REPRODUCTION_EVIDENCE=true
```

Validation applies to the exact intended use, release, models, data, workflow,
jurisdiction and deployment. The core does not inherit the module's status.

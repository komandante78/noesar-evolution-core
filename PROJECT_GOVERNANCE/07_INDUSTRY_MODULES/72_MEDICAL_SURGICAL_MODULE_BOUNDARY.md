# Medical and Surgical Module Boundary

## Core-permitted use
- research support
- document management
- literature review
- administrative workflow
- non-clinical analysis

## Separate module and validation required
- clinical decision support
- diagnosis/treatment recommendation
- patient-specific risk scoring
- device integration
- surgical actuation

## Required controls
- FHIR/HL7/DICOM adapters
- PHI classification
- patient isolation
- clinical audit
- validated signatures
- human clinical approval
- post-market controls
- external safety interlocks

```text
SURGICAL_ACTUATION=false
AUTONOMOUS_CLINICAL_DECISION=false
HUMAN_CLINICAL_APPROVAL=true
```

Validation applies to the exact intended use, release, models, data, workflow,
jurisdiction and deployment. The core does not inherit the module's status.

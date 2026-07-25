# Finance and Trading Module Boundary

## Core-permitted use
- education
- historical analysis
- research
- backtesting
- paper trading
- risk analysis

## Separate module and validation required
- live order execution
- regulated advice
- consequential credit decisions
- automated portfolio control

## Required controls
- model inventory
- independent validation
- pre-trade limits
- maximum loss
- approved instruments
- four-eyes approval
- kill switch
- immutable order audit
- drift monitoring

```text
LIVE_TRADING=false
PAPER_TRADING=true
GUARANTEED_RETURN_CLAIM=false
```

Validation applies to the exact intended use, release, models, data, workflow,
jurisdiction and deployment. The core does not inherit the module's status.

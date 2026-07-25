# Execution Authority

The execution authority validates:

1. principal matches plan actor and session;
2. plan is not denied;
3. approval matches actor, session, capability, version and plan hash;
4. approval is not expired or replayed;
5. selected sandbox profile is permitted;
6. `os-isolated` has a bound production attestation.

Declarative execution is production-eligible without a native process.
Development fixtures are explicitly non-production. Native external execution
remains disabled because the production adapter is not integrated.

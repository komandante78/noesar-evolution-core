# Production Readiness Compiler

The compiler evaluates six independent evidence domains:

1. Rust authority;
2. PostgreSQL data plane;
3. production sandbox;
4. platform matrix;
5. update trust;
6. independent penetration test.

A missing domain produces a blocker and `productionReady=false`.

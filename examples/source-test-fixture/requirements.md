# Isolated quantity regression benchmark

This is a synthetic local program, with no browser, database or external service.

- QTY-001: integers 1 through 9999 must be retained unchanged.
- QTY-002: zero, negative values, fractions and nonnumeric values must be rejected with null.

Create regression tests with Node's built-in test runner. Keep `quantity.mjs` and these requirements unchanged. Execute the tests, report the real failure and preserve each requirement ID. Do not install dependencies, skip tests, change expected values or fix application code.

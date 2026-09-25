# Frozen legacy client

These two files are the 0.1.0 Node SDK implementation from the repository HEAD
before SDK productization. Do not update to satisfy a compatibility failure.
`tests/sdk-parity.cjs` sends this old client's encrypted frames through the current
gateway, real transaction and webhook worker. This is software compatibility
evidence, not a hardware qualification. Frozen v2/v3 wire vectors also remain in
sdk/tests and are checked independently by Python, Rust, Node and C tests.

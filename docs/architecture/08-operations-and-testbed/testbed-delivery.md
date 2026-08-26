# Testbed Delivery

[Book index](../README.md) | [Part index](README.md) | [Previous: verification](verification-boundary.md) | [Appendices](../appendices/README.md)

**Status:** optional maintainer delivery target.

The testbed combines frontend, backend, supervisor, and Go microservice workloads for local and Docker lifecycle verification. It is not required for the fake-first consumer trajectory.

## Source anchors

[`testbed/package.json`](../../../testbed/package.json), [`testbed/Dockerfile`](../../../testbed/Dockerfile), [`testbed/microservice`](../../../testbed/microservice), and [`docs/usage-guide/maintenance/testbed-delivery.md`](../../usage-guide/maintenance/testbed-delivery.md).

## Limitations

The build deletes and recreates `testbed/dist`; that directory must contain only disposable build artifacts. Docker and Go are required for the complete operator delivery gate.

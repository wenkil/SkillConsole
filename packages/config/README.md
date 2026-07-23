# Configuration

`packages/config` owns typed, validated application configuration.

## Responsibilities

- Define environment-variable schemas for Server and Worker.
- Validate configuration before either process starts.
- Separate public Web configuration from Server and Worker secrets.
- Provide defaults that are safe for local development.

This package may define Secret references, but it must never log or serialize resolved Secret values.

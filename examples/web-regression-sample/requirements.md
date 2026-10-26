# Northstar local regression sample

This sample site is isolated on loopback and stores only synthetic records.

## Landing page

- The baseline and fixed deployments show the exact heading Application Overview.
- The regression deployment intentionally changes that heading to Activity Overview.
- The record name field accepts the reusable synthetic marker from the selected test-data set.

## Record service

- A run-scoped synthetic record can be created and read, then removed by the matching cleanup fixture.
- A request for a missing record returns HTTP 404 with record not found.
- A record-list limit below 1 or greater than 100 returns HTTP 400 with the documented boundary message; values 1 and 100 are accepted.
- The authoritative HTTP contract for the local fixture is `openapi.yaml` (OpenAPI 3.1.0). Its API cases link to the exact operation paths used by the regression suite.

The UI case only checks the heading and fills the synthetic marker field. API fixture setup and cleanup own the reversible write scenario.

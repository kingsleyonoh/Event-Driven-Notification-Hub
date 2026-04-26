# Test Factories

## What it establishes

Factory functions for creating test data per tenant. Each factory inserts a row, returns it; `cleanupTestData(tenantId)` deletes everything for the tenant.

## Files

- `src/test/factories.ts` — `createTestTenant()`, `createTestTemplate(tenantId, ...)`, `createTestRule(tenantId, ...)`, `createTestPreferences(tenantId, ...)`, `createTestNotification(tenantId, ...)`, `cleanupTestData(tenantId)`.

## When to read this

Before writing any test that needs fixtures. Before adding a new schema-dependent test helper.

## Contract

- Multi-tenant tests MUST create ≥2 tenants via `createTestTenant()` — see `CODING_STANDARDS_TESTING.md` Multi-Tenant Fixtures Mandatory.
- Every factory accepts an optional override object; unspecified fields use sensible defaults.
- `cleanupTestData(tenantId)` cascades through FK relationships — call it in `afterEach`.
- Helpers stay short (≤10 lines each); complex setup goes in the test itself.

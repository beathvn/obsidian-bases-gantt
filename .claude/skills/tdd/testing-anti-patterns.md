# Testing anti-patterns

Mocks exist to isolate code. They are never the thing being tested.

| Anti-pattern | Why it's wrong | Fix |
|---|---|---|
| Asserting on a mock (e.g. a `*-mock` test ID or call count) | Proves the mock works, not the code | Assert on real output, or don't mock that part |
| Test-only methods in production code (e.g. `destroy()` used only in `afterEach`) | Pollutes the API and can be called in production by mistake | Put cleanup and setup helpers in test utilities |
| Mocking without knowing the side effects | The mocked method may do something the test relies on, such as writing state | Run with the real code first, then mock only the slow or external part at the lowest level |
| Incomplete mock data | Code reads a field the mock left out, so tests pass while the real thing breaks | Mirror the real structure completely, with every field the real API returns |
| Tests written after "done" | Tests that pass right away prove nothing | Follow the cycle: test, code, refactor, then call it done |

## Before writing a mock, ask

1. What side effects does the real method have, and does this test depend on any of them?
2. Is this only for speed or safety, "just in case"? Then don't mock.
3. Would a small integration test with real components be simpler?

## Warning signs

- Mock setup is longer than the test itself.
- A test breaks when you change the mock, not the code.
- You can't explain why a mock is needed.

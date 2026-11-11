---
name: tdd
description: Test-driven development with the red-green-refactor cycle. Use for every new feature, bug fix, refactor or behavior change, and whenever the user mentions TDD.
---

# Test-driven development

**No production code without a failing test first.** If you didn't watch the test fail, you don't know whether it tests the right thing.

Work in small red-green-refactor cycles. Each cycle adds one small piece of behavior, so repeat it until the feature is done. Skip TDD only for throwaway prototypes, generated code or config files, and only after the user agrees.

## 0. Plan: make a test list

Before writing code, list the behaviors the feature needs as short test cases, including edge cases (empty input, boundaries, invalid data). Start with the simplest one. Add new cases to the list as they come up instead of chasing them right away.

For a bug fix, the first test reproduces the bug. Never fix a bug without one.

## 1. Red: write a failing test

- Write one minimal test for the next behavior on the list, against real code. Write it before any production code.
- Run it and watch it fail. It must fail on the assertion because the feature is missing, not error out on a typo or a broken import.
- If it passes right away, it tests behavior that already exists. Fix the test.
- Write no production code in this step.

## 2. Green: make it pass

- Write the simplest code that makes the test pass. A hard-coded value is fine if the next test will force the general solution. No options, features or cleanup the test doesn't ask for.
- Run all tests. All must pass, with clean output (no errors or warnings).
- If the test fails, fix the code, not the test. Do not add or change tests in this step.

## 3. Refactor: make it good

- Only on green: remove duplication, improve names, extract helpers, in production code and tests alike.
- Do not change behavior. Run the tests after each change, and keep them green.
- If the next test needs a different structure, refactor first, then start the next cycle.

## Rules

- Write only as much of a test as it takes to fail. A test that doesn't compile counts as failing.
- Write only as much production code as it takes to pass the failing test.
- Keep the phases separate. Every change belongs to exactly one of them.
- Keep cycles short, a few minutes each.
- Code written before its test gets deleted, not kept as a reference. Rewrite it from the tests.
- Never weaken, skip or delete a test to get to green. If a test is wrong, say so and fix it in the red phase.
- If the project has no test runner yet, stop and ask the user which one to set up before starting.

**Red flags. Stop and start over if you catch yourself:** writing code before the test, seeing a test pass on its first run, being unable to explain why a test failed, or thinking "too simple to test", "I'll add tests after", "I already checked it by hand" or "just this once".

## Writing good tests

- Test behavior through the public interface, not implementation details, so refactoring doesn't break tests.
- One behavior per test. Name it after that behavior, e.g. `rejects empty email`. An "and" in the name means split it.
- Structure each test as arrange, act, assert.
- Keep tests fast, isolated and deterministic: no shared state, no real clock, no network. Pass dates and time in.
- Prefer real code over mocks. Mock only at boundaries you don't control (external services, frameworks, the file system), and put logic in plain functions that need no mocks. Before writing any mock, read [testing-anti-patterns.md](testing-anti-patterns.md).
- When code is hard to test, treat it as a design problem. Simplify the interface or inject dependencies instead of piling up mocks.

## Done checklist

Before calling the work complete:

- Every new function has a test, and you watched each one fail for the expected reason.
- Each test got only minimal code to pass.
- All tests pass with clean output.
- Edge cases and error paths are covered.

If any box is unchecked, TDD was skipped. Go back and do it.

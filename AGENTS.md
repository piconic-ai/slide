# slide design rules

Slide is an HTML slide publishing, sharing, and sales service under development.
It uses BarefootJS and Hono on Cloudflare Workers, with D1 and private R2
storage.

## Design principles

- **Prefer pure functions.** Make outputs depend on explicit inputs. Keep
  database access, storage, network requests, time, randomness, and mutable
  state at the boundaries that need them.
- **Make pure logic and side effects distinguishable by file.** Keep validation,
  transformations, and policy decisions separate from request handlers and
  persistence. In the current upload code, `src/uploads/inventory.ts`,
  `limits.ts`, and `content-policy.ts` hold pure logic or constants; `api.ts`
  and `oidc.ts` handle HTTP, D1, R2, and identity verification. Extract new pure
  logic from handlers or stateful components when it has its own responsibility.
  A `.ts` extension alone does not imply purity.
- **Keep pure functions narrow.** Give each function one responsibility. Compose
  small transformations rather than mixing validation, decisions, and writes in
  one function. Do not add layers or abstractions without a concrete need.
- **Represent valid states in types.** Use discriminated unions for states with
  different data, rather than unrelated flags or optional fields that permit
  contradictory combinations. Derive types from schemas where possible.
- **Validate at boundaries.** Treat requests, external responses, configuration,
  and stored data as untrusted inputs. Parse them into domain types before
  applying business rules, and avoid repeating the same validation inside pure
  logic.
- **Build a working slice first.** Implement a concrete user action that can be
  tried and reviewed, then refine it through feedback. Keep follow-up work
  explicit instead of expanding a prototype into every planned feature.

## Tests and debugging

- For new or changed domain logic, cover typical inputs and adversarial cases
  such as invalid input, boundary values, empty values, and conflicting states.
  Express the expected behavior as Given-When-Then, and assert observable
  results rather than implementation details.
- Use Vitest for pure logic. Use local HTTP, D1, and R2 checks for upload and
  persistence behavior. Use Playwright when the behavior depends on browser
  enforcement, including CSP and iframe isolation. The existing entry points and
  validation commands are in [the development
  instructions](docs/dev/development.md#変更を確認する) and [the upload verification
  guide](docs/dev/f01-local-slice.md#ローカルで確認する).
- Reproduce a reported failure before changing code. Check neighboring inputs
  and operations that share the same decision, fix the cause, and keep a
  regression test for the observed behavior.
- Do not use mocked success as evidence that a real integration works. State
  what a check exercises and what still needs manual or external verification.
- Before adding a framework workaround, check the installed `bf` documentation
  and reproduce the failure in a browser. Static analysis alone does not prove a
  runtime defect.

## Planning and changes

- Search existing open and closed GitHub issues before creating a plan. Update
  an existing issue when it covers the same outcome.
- Write plans in Japanese with the user situation, goal, scope, exclusions,
  approach, and acceptance criteria. Separate automated checks from human
  judgment. For an unrefined idea, record what is known and the open questions.
- When implementing an issue, read its full body and comments, follow its scope,
  and link the implementation PR. Keep the issue open while acceptance criteria
  or human checks remain.
- Keep each commit focused on one behavior or refactor, including the tests that
  verify it.
- Use oxfmt for formatting. Follow the validation commands in [the development
  instructions](docs/dev/development.md#変更を確認する).
- Do not edit generated output by hand. Change its source and regenerate it.

## Documentation

- Keep README.md to a brief project description and documentation links.
- Read [the development guide](docs/dev/index.md) for setup, commands,
  architecture, and validation. Keep technical documentation under docs/dev/.
- Write documentation in Japanese and code comments in English. Communicate with
  the user politely in Japanese.
- Keep feature scope and implementation order in [the story
  map](docs/story-mapping.canvas). Describe features through concrete user
  situations, and use feature names in links rather than numbers alone.

## GitHub operations

- Prefer standard gh subcommands and REST APIs. Use direct GraphQL only when
  necessary.
- Do not merge pull requests or deploy without the user's authorization.

## GitHub reviews

- Write pull request reviews, comments, and replies in Japanese only. Do not add
  English translations. Keep code identifiers and quoted code unchanged.
- Never resolve or unresolve review threads. The repository owner manages thread
  resolution.

# Working in slide

Slide is an HTML slide publishing, sharing, and sales service under development.

## Documentation

- Keep README.md to a brief project description and documentation links.
- Read [the development guide](docs/dev/index.md) for setup, commands, architecture, and validation. Keep technical documentation under docs/dev/.
- Write documentation in Japanese and code comments in English. Communicate with the user politely in Japanese.
- Keep feature scope and implementation order in [the story map](docs/story-mapping.canvas). Describe features through concrete user situations, and use feature names in links rather than numbers alone.

## Changes

- Use oxfmt for formatting. Follow the validation commands in [the development instructions](docs/dev/development.md#変更を確認する).
- Do not edit generated output by hand. Change its source and regenerate it.
- Prefer standard gh subcommands and REST APIs. Use direct GraphQL only when necessary.
- Do not merge pull requests or deploy without the user's authorization.

## GitHub reviews

- Write pull request reviews, comments, and replies in Japanese only. Do not add English translations. Keep code identifiers and quoted code unchanged.
- Never resolve or unresolve review threads. The repository owner manages thread resolution.

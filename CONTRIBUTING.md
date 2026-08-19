# Contributing

This repository is a university coursework project (see the "About this
project" section in the [README](./README.md)) developed as part of a
semester project. It is not currently seeking external contributions.

If you nonetheless want to explore, fork, or build on it:

- Read the [README](./README.md) for setup instructions and an overview of
  the gesture library's public API.
- Check [`docs/adr/`](./docs/adr/) for the architectural decisions and
  rationale behind the current design before proposing changes.
- Follow the existing code style: plain ES modules, no build-step
  transpilation beyond what Vite provides, [Conventional
  Commits](https://www.conventionalcommits.org/)-style commit messages
  (`feat:`, `fix:`, `docs:`, `ci:`, ...).
- Run `npm run lint` and `npm run test` before opening a pull request; both
  are also checked in CI.

Bug reports and suggestions are welcome via GitHub Issues, but please note
that ongoing development priorities are driven by the coursework assignments
this project is built around.

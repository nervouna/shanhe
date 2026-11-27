# Security

Shanhe is a static browser game. It has no server, no accounts and no payments, and it stores saved games only in the player's own browser. The realistic risks are in what the page loads and runs: its dependencies, its build pipeline, and saved-game files that a player imports.

## Reporting a problem

Report privately through **Security → Report a vulnerability**, or directly at https://github.com/nervouna/shanhe/security/advisories/new.

Include the steps to reproduce, your browser and OS, and the commit you tested.

You will get an answer within a week. Fixes land on `main`; there are no maintained release branches.

## In scope

- Script execution or data exposure caused by importing a saved-game file.
- A dependency or build step that runs or ships code it should not.
- Anything that makes the page send the player's data to a third party.

## Out of scope

- Cheating in a single-player game by editing your own save or memory.
- Bugs in browsers or in WebGPU drivers.
- Performance problems and crashes without a security impact; open a normal issue for those.

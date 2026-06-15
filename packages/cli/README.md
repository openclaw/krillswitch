# @openclaw/krillswitch-cli

Manage krillswitch feature flags from the terminal. Built for humans and for
coding agents: every command takes `--json` and exits nonzero on failure, so
scripts and agents can act on results without scraping tables.

## Install

Until the go-live npm publish, run it from the workspace with bun:

```sh
bun packages/cli/src/index.ts <command>
```

After publish:

```sh
npm install -g @openclaw/krillswitch-cli
krillswitch <command>
```

## Auth and base URL

Mint a role-scoped token in the dashboard (Access → Access tokens; editor or
viewer). Then supply it, in precedence order:

1. `--token <ksat_…>`
2. `KRILLSWITCH_TOKEN` env var
3. `~/.krillswitch.json` → `{ "token": "ksat_…", "baseUrl": "https://…" }`

The base URL resolves `--base-url` > `KRILLSWITCH_URL` > config file > the local
default `http://localhost:8799`.

```sh
export KRILLSWITCH_URL=http://localhost:8799
export KRILLSWITCH_TOKEN=ksat_...
```

## Commands

```text
projects list
flags list         --project <key> --env <key>
flags get <key>    --project <key> --env <key>
flags toggle <key> --project <key> --env <key> --on|--off
flags create <key> --project <key> --kind <boolean|string|number|json>
                   [--name <name>] [--variation <v> ...] [--enabled]
flags targeting set <key> --project <key> --env <key> --targeting '<json>'
eval               --project <key> --env <key> --key <contextKey> [--attr k=v ...]
log tail           [--flag <key>] [--project <key>] [--limit <n>]
```

`--project`/`-p`, `--env`/`-e`, `--key`/`-k` have short aliases. Add `--json` to
any command for machine-readable output.

### Roles

Tokens are `editor` or `viewer` (never admin). Viewer tokens read everything
and are refused on every mutation. Admin-only actions (role grants, projects,
environments, key rotation) stay in the dashboard.

### Targeting spec

`flags targeting set` replaces the environment's targeting from a JSON spec,
referencing variations by their index in `flags get`:

```sh
krillswitch flags targeting set souls -p clawhub -e production --targeting '{
  "allowlist": [{ "variationIndex": 0, "contextKeys": ["12345"] }],
  "rules":     [{ "variationIndex": 0, "attribute": "role", "values": ["admin"] }],
  "split":     [{ "variationIndex": 0, "weight": 50 }, { "variationIndex": 1, "weight": 50 }]
}'
```

Omitted keys clear that dimension — read `flags get --json` first if you want to
preserve existing rules. Split weights must sum to 100.

## Exit codes

- `0` success
- `1` runtime failure (auth, forbidden, validation, unreachable service)
- `2` usage error (unknown command, missing required flag)

## Agent loop

A no-browser agent can drive the full cycle:

```sh
krillswitch flags list -p clawhub -e development --json
krillswitch flags toggle souls -p clawhub -e development --off --json
krillswitch eval -p clawhub -e development -k some-user --json   # verify the flip
krillswitch log tail --flag souls --json                          # confirm attribution
```

# @openclaw/krillswitch-cli

Manage krillswitch feature flags from the terminal. Built for humans and for
coding agents: every command takes `--json` and exits nonzero on failure, so
scripts and agents can act on results without scraping tables.

## Install

Until the go-live npm publish, build and run the package binary locally:

```sh
bun run --cwd packages/cli build
mkdir -p /tmp/krillswitch-cli-bin
ln -sf "$PWD/packages/cli/dist/index.js" /tmp/krillswitch-cli-bin/krillswitch
/tmp/krillswitch-cli-bin/krillswitch <command>
```

After publish:

```sh
npm install -g @openclaw/krillswitch-cli
krillswitch <command>
```

## Auth and base URL

Mint a role-scoped token in the dashboard (Access → Access tokens; editor or
viewer). Then onboard once:

```sh
krillswitch onboard \
  --base-url http://localhost:8799 \
  --token ksat_...
```

`onboard` writes non-secret settings to `~/.krillswitch.json` and stores the
access token in OS secure storage (macOS Keychain, Windows Credential Manager,
or the Linux keyring).

To inspect or change the stored CLI config later:

```sh
krillswitch config show
krillswitch config set --base-url http://localhost:8799
krillswitch config set --token ksat_...
krillswitch config set --base-url https://krill.example --token ksat_...
```

Changing `--base-url` without a new `--token` clears any token reference tied
to the previous URL. This avoids sending a token minted for one API to another
API by accident.

You can still override settings for one command, in precedence order:

1. `--token <ksat_…>`
2. `KRILLSWITCH_TOKEN` env var
3. OS secure storage reference from `~/.krillswitch.json`
4. Legacy `~/.krillswitch.json` plaintext token

The base URL resolves `--base-url` > `KRILLSWITCH_URL` > config file > the local
default `http://localhost:8799`.

```sh
krillswitch projects list \
  --base-url http://localhost:8799 \
  --token ksat_... \
  --json
```

## Shell completion

Install tab completion for commands, subcommands, and options:

```sh
krillswitch completion install zsh
```

Then open a new shell. For bash or fish:

```sh
krillswitch completion install bash
krillswitch completion install fish
```

If you only want to enable completion for the current shell session:

```sh
eval "$(krillswitch completion zsh)"
```

For bash or fish in the current session:

```sh
eval "$(krillswitch completion bash)"
krillswitch completion fish | source
```

Once enabled, examples like `krillswitch li<Tab>` and
`krillswitch flags l<Tab>` complete to `list`.

## Commands

```text
onboard            [--base-url <url>] [--token <ksat_...>] [--skip-verify]
config show
config set         [--base-url <url>] [--token <ksat_...>]
projects list
list               <project> <env>
flags list         <project> <env>
flags get <key>    --project <key> --env <key>
flags toggle <key> --project <key> --env <key> --on|--off
flags create <key> --project <key> --kind <boolean|string|number|json>
                   [--name <name>] [--variation <v> ...] [--enabled]
flags targeting set <key> --project <key> --env <key> --targeting '<json>'
eval               --project <key> --env <key> --key <contextKey> [--attr k=v ...]
log tail           [--flag <key>] [--project <key>] [--limit <n>]
completion         <zsh|bash|fish>
completion install <zsh|bash|fish>
```

`--project`/`-p`, `--env`/`-e`, `--key`/`-k` have short aliases. Add `--json` to
any command for machine-readable output.

When a command needs a project or environment and you leave it out, an
interactive terminal prompts from the live choices. Non-interactive runs print
the available keys and the exact usage instead.

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

Omitted keys clear that dimension. Read `flags get --json` first if you want to
preserve existing rules. Split weights must sum to 100.

## Exit codes

- `0` success
- `1` failure (auth, forbidden, validation, unreachable service, or usage error)

## Agent loop

A no-browser agent can drive the full cycle:

```sh
krillswitch flags list -p clawhub -e development --json
krillswitch flags toggle souls -p clawhub -e development --off --json
krillswitch eval -p clawhub -e development -k some-user --json   # verify the flip
krillswitch log tail --flag souls --json                          # confirm attribution
```

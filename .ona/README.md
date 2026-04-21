# Ona dev-env tooling

This directory contains a self-contained tool for spinning up a Home
Assistant Core + frontend dev environment inside an Ona dev environment.

It lives **only on the `ona-tooling` branch** of this fork. Feature branches
must never carry this directory — the whole point is that upstream's
`home-assistant/frontend` never sees these files, so rebasing the fork onto
upstream causes zero conflicts.

## Usage

Consume the tooling from a feature branch via `git worktree`:

```sh
# one-off, from inside the main worktree (any branch):
git worktree add ../ona-tooling ona-tooling

# now, on any feature branch:
../ona-tooling/.ona/dev-env.sh        # default = setup (if needed) + run
```

That's it. The script auto-detects the target frontend repo (the _other_
worktree), installs Home Assistant Core into a venv, opens port 8123 in
Ona, writes a working `configuration.yaml`, and runs both `hass` and
`script/develop` in the background while tailing their logs.

Subcommands:

| command  | what it does                                             |
| -------- | -------------------------------------------------------- |
| `setup`  | install HA Core, open port 8123, write HA config         |
| `run`    | start HA + frontend watch, tail logs (Ctrl-C stops both) |
| `stop`   | stop both background processes                           |
| `status` | show whether HA / frontend / port are up                 |
| `url`    | print the public Ona URL for HA                          |
| `reset`  | wipe `~/.ona-ha/` (venv + HA config + logs)              |
| `help`   | full usage                                               |

## Where state lives

Everything outside the worktree, under `~/.ona-ha/`:

```
~/.ona-ha/
├── venv/        # Python venv with `homeassistant` installed
├── config/      # configuration.yaml + HA storage
├── logs/        # frontend.log + hass.log
├── run/         # PID files for the background processes
└── state        # cached target repo path
```

This means `git status` in the working tree stays clean and `git clean -fd`
won't nuke your HA install.

## Updating

```sh
git -C ../ona-tooling pull
```

## Caveats

- Re-creating the Ona environment wipes `~/.ona-ha/` along with everything
  else in `$HOME`. Re-run `dev-env.sh setup` after a rebuild.
- The public Ona URL changes between environments. `setup` re-renders
  `cors_allowed_origins` automatically; just re-run it if HA suddenly
  rejects WebSocket connections after an env restart.
- HA onboarding (creating the first user) runs once per fresh state dir.

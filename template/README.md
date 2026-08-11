# My Agent Skills (parasite-skill sync repo)

This is a ready-made git repo for syncing your agent skills with parasite-skill.
Create your own repo from this template, then point parasite-skill at it:

```bash
# 1. Create a repo on GitHub (e.g. https://github.com/<you>/my-skills)
# 2. Backup your local skills to it:
npx parasite-skill sync --init https://github.com/<you>/my-skills.git
npx parasite-skill sync --push
# 3. On a new machine:
npx parasite-skill sync --pull
```

## What lives here

- `skills/` — your installed skills (the payload parasite-skill scans)
- `.parasite-skill/` — the central registry (registry.json, refs, wikis, custom sets)
- `.github/workflows/ci.yml` — validates the repo on every push

## Structure

```
.
├── skills/                # installed skill dirs (one per skill)
│   └── parasite-skill/      # the router skill itself
├── .parasite-skill/
│   ├── registry.json      # scan output (84+ skills)
│   ├── sets.custom.json   # your custom skill-sets (sets --new/--add/--remove)
│   └── refs/ wikis/       # generated docs
└── .github/workflows/ci.yml
```

## CI

The included workflow validates the repo: `bun test` + spec check on every push.

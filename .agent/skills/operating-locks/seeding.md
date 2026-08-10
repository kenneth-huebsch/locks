# Seeding Locks Data

## Seed Scripts

| Script | Command | What It Does |
|---|---|---|
| `seed-foundation.ts` | `npm run seed` | **Offseason recovery only.** Writes the dummy foundation Week 1 game. Not run on publish. |
| `seed-active-week.ts` | `npx tsx scripts/seed-active-week.ts` | Seeds active week metadata + a fake game slate (idempotent) |
| `seed-week.ts` | `npx tsx scripts/seed-week.ts` | Seeds a fake game slate for a specific week (idempotent) |

All seed scripts use `PutItem` with no condition — they overwrite if the item
exists. Safe to re-run.

## Running Seeds

Seeding is a mutation. Use `locks-publish` profile and get explicit approval:

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks

# Account guard
account="$(AWS_PROFILE=locks-publish aws sts get-caller-identity --query Account --output text)"
test "$account" = "580956784928" || { echo "Wrong account" >&2; exit 1; }

# Foundation game (canonical Week 1)
AWS_PROFILE=locks-publish npm run seed

# Active week + fake game slate
AWS_PROFILE=locks-publish npx tsx scripts/seed-active-week.ts

# Specific week fake slate
AWS_PROFILE=locks-publish npx tsx scripts/seed-week.ts
```

## What's Currently Seeded

- One foundation Week 1 game (dummy data for offseason validation)
- Active season and week metadata

## When to Re-Seed

- After a table recreation (should never happen — destroy policy)
- When the season starts and real game data is needed (via odds sync, not
  manual seeding)
- When testing new API endpoints that need game data

## Inspecting Current Data

Read-only — safe to run anytime:

```bash
# Scan a few items
AWS_PROFILE=coding-agent aws dynamodb scan \
  --table-name locks --max-items 10 --output json

# Query the active season
AWS_PROFILE=coding-agent aws dynamodb query \
  --table-name locks \
  --key-condition-expression 'pk = :pk' \
  --expression-attribute-values '{":pk":{"S":"ACTIVE_SEASON"}}' \
  --output json
```


## Publish path

`npm run deploy:app` no longer runs foundation seed. Live slates come from
`sync-odds` (and optional operator seed scripts). Prefer deleting any leftover
`GAME#foundation-week-1-game` item after a real odds sync.

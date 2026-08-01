# DynamoDB Data Model

This document defines the single-table key design for the `locks` DynamoDB table.
All Phase 2+ application code must use these patterns. Phase 1 seeded a foundation
game under `WEEK#2026#01`; that item is replaced when odds sync writes the first
real week partition using the `W` prefix documented below.

## Table

| Property | Value |
|---|---|
| Table name | `locks` |
| Partition key | `PK` (String) |
| Sort key | `SK` (String) |
| Billing | Pay per request |
| Encryption | AWS-managed |
| TTL attribute | `ttl` (Number, Unix epoch seconds) |

## Timestamp format

All application timestamps are ISO 8601 UTC strings with millisecond precision:

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

Example: `2026-09-10T00:20:00.000Z`

DynamoDB TTL uses a **Number** attribute (`ttl`) holding Unix epoch **seconds**.

## Access patterns

| Pattern | Query |
|---|---|
| Get all games for the active week | `Query` on `PK = WEEK#<year>#W<week>`, `SK begins_with GAME#` |
| Get all picks for the active week (all players) | `Query` on GSI1 where `GSI1PK = WEEK#<year>#W<week>` |
| Get a specific player's picks for the active week | `Query` on `PK = PLAYER#<cognitoSub>`, `SK begins_with PICK#<year>#W<week>#` |
| Get weekly pick count for a player | `GetItem` on `PK = PLAYER#<cognitoSub>`, `SK = COUNTER#<year>#W<week>` |
| Get quota/API usage records | `Query` on `PK = QUOTA#ODDS_API`, `SK` sorted by ISO timestamp |
| Get the active season and week metadata | `GetItem` on `PK = SEASON#ACTIVE`, `SK = META`; then `GetItem` on the week partition |

## Key patterns

Week numbers are zero-padded to two digits. The season-week token is
`<year>#W<week>` (for example `2026#W01`).

### Active season pointer

Points at the current NFL season year. Updated when operators advance seasons.

| Attribute | Value |
|---|---|
| PK | `SEASON#ACTIVE` |
| SK | `META` |
| season | Number — active season year (e.g. `2026`) |
| updatedAt | String — ISO UTC timestamp |

### Week metadata

One item per NFL week. Holds slate status for grading workflows.

| Attribute | Value |
|---|---|
| PK | `WEEK#<year>#W<week>` |
| SK | `META` |
| season | Number |
| week | Number (1–18) |
| status | String — `open`, `grading`, or `complete` |
| seasonWeek | String — `<year>#W<week>` |
| oddsUpdatedAt | String or null — ISO UTC of last successful odds sync |

### Games

Cached NFL slate from The Odds API. One item per event in a week partition.

| Attribute | Value |
|---|---|
| PK | `WEEK#<year>#W<week>` |
| SK | `GAME#<eventId>` |
| id | String — vendor event ID |
| awayTeam | String — full display name |
| homeTeam | String — full display name |
| awayAbbr | String — 2–3 letter code |
| homeAbbr | String — 2–3 letter code |
| commenceTime | String — ISO UTC kickoff |
| awaySpread | Number — spread for away side at cache time |
| homeSpread | Number — spread for home side at cache time |
| awayScore | Number or null — set when final |
| homeScore | Number or null — set when final |
| status | String — `scheduled`, `in_progress`, or `final` |
| bookmaker | String — e.g. `draftkings` |
| oddsUpdatedAt | String — ISO UTC when this game row was last written |

Games are upserted by odds sync. Sync must not modify pick items or player counters.

### Picks

Immutable player selections. Player identity is the Cognito `sub` from the JWT;
never trust a client-supplied player ID.

| Attribute | Value |
|---|---|
| PK | `PLAYER#<cognitoSub>` |
| SK | `PICK#<year>#W<week>#GAME#<eventId>` |
| GSI1PK | `WEEK#<year>#W<week>` |
| GSI1SK | `PICK#<cognitoSub>#GAME#<eventId>` |
| playerId | String — Cognito `sub` |
| gameId | String — vendor event ID |
| seasonWeek | String — `<year>#W<week>` |
| pickedTeam | String — full team name or abbreviation at submission |
| spreadAtPick | Number — locked spread for the picked side |
| submittedAt | String — ISO UTC |
| result | String — `pending`, `win`, `loss`, or `push` |

Only the grading Lambda may change `result` from `pending`. No player-facing
update or delete paths exist.

### Weekly pick counter

Denormalized count for enforcing the three-pick weekly maximum.

| Attribute | Value |
|---|---|
| PK | `PLAYER#<cognitoSub>` |
| SK | `COUNTER#<year>#W<week>` |
| count | Number — picks submitted this week (0–3) |
| seasonWeek | String — `<year>#W<week>` |
| updatedAt | String — ISO UTC |

Created on first pick with `count = 1`. Incremented atomically on each subsequent pick.

### Quota records

Diagnostic log of metered Odds API responses. Short-lived via TTL.

| Attribute | Value |
|---|---|
| PK | `QUOTA#ODDS_API` |
| SK | `<ISO UTC timestamp>` — same format as above, used as sort key |
| timestamp | String — ISO UTC (duplicate of SK for API convenience) |
| endpoint | String — e.g. `/v4/sports/americanfootball_nfl/odds` |
| creditsUsed | Number |
| creditsRemaining | Number |
| ttl | Number — Unix epoch seconds, **30 days** after write |

## Global secondary index: GSI1

| Property | Value |
|---|---|
| Index name | `GSI1` |
| Partition key | `GSI1PK` (String) |
| Sort key | `GSI1SK` (String) |
| Projection | All attributes |

Applied to **Pick items only**:

- `GSI1PK = WEEK#<year>#W<week>`
- `GSI1SK = PICK#<cognitoSub>#GAME#<eventId>`

Serves the “all picks for a week” access pattern for the picks board and
`GET /api/week/current`.

## Transaction boundaries

### Pick submission (`POST /api/picks`)

Use a single `TransactWriteItems` call with up to three operations:

1. **Condition-check the game** (`Get` is not transactional; use `ConditionCheck` on the game item):
   - Item exists: `PK = WEEK#<year>#W<week>`, `SK = GAME#<eventId>`.
   - `commenceTime > :now` (game has not started).
   - `awaySpread` / `homeSpread` match the submitted team and `spreadAtPick`.

2. **Put pick** (conditional insert):
   - `attribute_not_exists(PK)` — no duplicate pick for this player/game/week.

3. **Update counter** (conditional increment):
   - `PK = PLAYER#<cognitoSub>`, `SK = COUNTER#<year>#W<week>`.
   - If counter exists: `count < 3` and `ADD count :one`.
   - If counter does not exist: create with `count = 1` and
     `attribute_not_exists(PK)`.

All three must succeed or the transaction rolls back. Map conditional failures:

| Condition failure | API error code |
|---|---|
| Game missing | `GAME_NOT_FOUND` |
| `commenceTime <= now` | `GAME_STARTED` |
| Spread/team mismatch | `STALE_LINES` |
| Pick already exists | `DUPLICATE_PICK` |
| `count >= 3` | `WEEKLY_LIMIT` |

### Odds sync

Use individual `PutItem` / `UpdateItem` calls per game (not a transaction with picks).
Sync may batch writes but must never delete or overwrite pick or counter items.

### Grading (Phase 3)

Update game scores/status and pick `result` fields in separate writes. Grading does
not use the pick-submission transaction.

## Conditional expressions (summary)

| Operation | Expression |
|---|---|
| Insert pick | `attribute_not_exists(PK)` |
| Increment counter | `attribute_not_exists(PK) OR count < :max` with `:max = 3` |
| Check game not started | `commenceTime > :now` |
| Check spread snapshot | `awaySpread = :spread OR homeSpread = :spread` (combined with picked-team logic in application code before submit) |

## TTL strategy

| Item type | TTL |
|---|---|
| Quota records | Yes — `ttl` set to 30 days after write |
| Picks | No |
| Games | No |
| Week/season metadata | No |
| Player counters | No |

TTL is for diagnostic quota history only. Picks and games are retained for the
season; archival or deletion is an explicit future operator decision.

## Foundation migration

Phase 1 wrote one game at:

```text
PK = WEEK#2026#01
SK = GAME#foundation-week-1-game
```

Phase 2 odds sync writes the canonical partition `WEEK#2026#W01`. The seed script
and current-week Lambda are updated in later phases to read `SEASON#ACTIVE` and the
`W`-prefixed week key. The old foundation item may be deleted after the first
successful sync or left orphaned; it is not read once consumers migrate.

# CloudKit Schema

`schema.ckdb` is the canonical record-type + index definition for the
`iCloud.com.hexrain.app` container. It lives in source control so schema
changes go through code review and PR diffs make schema drift visible.

## Workflow

```sh
# One-time auth — paste a management token from CloudKit Console.
xcrun cktool save-token --type management

# Pull the live schema from the dev environment.
xcrun cktool export-schema \
  --team-id T495W5MP96 \
  --container-id iCloud.com.hexrain.app \
  --environment development \
  --output-file cloudkit/schema.ckdb

# Edit. Commit.

# Push the local schema back to dev.
xcrun cktool import-schema \
  --team-id T495W5MP96 \
  --container-id iCloud.com.hexrain.app \
  --environment development \
  --file cloudkit/schema.ckdb
```

`cktool` re-sorts record types alphabetically on export, so after an
edit-then-import cycle you may want to re-export to canonicalise the
file — that's what keeps PR diffs clean.

## Promoting to production

When a release is ready, push the same file at the production
environment (after the App Store build is approved and live):

```sh
xcrun cktool import-schema \
  --team-id T495W5MP96 \
  --container-id iCloud.com.hexrain.app \
  --environment production \
  --file cloudkit/schema.ckdb
```

CloudKit will reject any change that would lose data or break a record
type's contract — read the diff in the import output before answering
the prompt. New fields are always safe; removed fields, type changes,
and dropped indexes are not.

## Migrations

After deploying a `Score` schema change that adds a `challengeKey` /
`challengeVersion` field, run the moderator backfill so historical rows
populate the new fields and stay queryable:

```sh
node scripts/moderator.mjs backfill-score-keys --dry-run
node scripts/moderator.mjs backfill-score-keys
```

## What's defined here

| Record type         | DB      | Purpose |
| ---                 | ---     | --- |
| `Progress`          | Private | Per-user `ChallengeProgress` blob (single record, name `progress`). |
| `CustomChallenge`   | Private | Per-user mirror of `hexrain.customChallenges.v1`. |
| `PublishedChallenge`| Public  | A community-published custom challenge. |
| `Score`             | Public  | One row per (player, challenge, version); the player's best score + total attempts. Capped at top 10 per (challengeKey, challengeVersion). |
| `Upvote`            | Public  | One row per (player, challenge) like. |
| `Report`            | Public  | One row per (reporter, challenge) report; consumed by `scripts/moderator.mjs`. |
| `Users`             | Public  | CloudKit auto-managed user record; `roles` is reserved for future moderator marking. |

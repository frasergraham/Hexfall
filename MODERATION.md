# Community Moderation

HexRain ships custom challenges to a public CloudKit container
(`iCloud.com.hexrain.app`). Players can publish, browse, install,
upvote, and report community challenges. Moderation is manual: when a
report comes in, you review it and either hide the challenge or leave
it.

## Two-line summary

- **Players** flag bad content via the `⚑` button on each community
  card. Reports go into the `Report` record type.
- **You** review the queue with `node scripts/moderator.mjs list-reports`
  and hide or unhide challenges. Hidden records vanish from the public
  list because the client filters on `status == "approved"`.

## One-time setup

1. **Create a server-to-server key.**
   Open the [CloudKit Console](https://icloud.developer.apple.com/),
   pick the `iCloud.com.hexrain.app` container, then:
   *Tokens & Keys → Server-to-Server Keys → +*. Save the generated
   private key PEM and copy the Key ID.

2. **Drop credentials into the config file.** The script looks for
   `~/.config/hexrain/moderator-token.json` by default
   (override with `HEXRAIN_MOD_TOKEN_PATH`):

   ```json
   {
     "container": "iCloud.com.hexrain.app",
     "keyId": "PASTE_KEY_ID_HERE",
     "privateKeyPem": "-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"
   }
   ```

   Newlines inside `privateKeyPem` must be literal `\n` escapes (or use
   a real multi-line JSON value if your shell tolerates it).

3. **Pick the environment.** Defaults to `development`. Set
   `HEXRAIN_MOD_ENV=production` once the schema is deployed and the app
   ships against the production container.

## Daily workflow

```sh
# What's been reported in the last week?
node scripts/moderator.mjs list-reports --since 7d

# Hide an offending challenge.
node scripts/moderator.mjs hide pub-abcd1234-ef567890

# Realise it was a false-positive — bring it back.
node scripts/moderator.mjs unhide pub-abcd1234-ef567890

# Upvote count drifted (denormalised on PublishedChallenge,
# authoritative count lives in Upvote rows).
node scripts/moderator.mjs recount-upvotes pub-abcd1234-ef567890
```

## Score maintenance

`Score` rows are pinned to a `(challengeKey, challengeVersion)` tuple
so a content change (community re-publish, official wave-list edit)
makes old rows invisible to the client immediately. They linger in
CloudKit until the purge job sweeps them up.

```sh
# One-time: backfill challengeKey/challengeVersion onto rows written
# before the schema migration. Idempotent — already-current rows are
# skipped.
node scripts/moderator.mjs backfill-score-keys --dry-run
node scripts/moderator.mjs backfill-score-keys

# Periodic (e.g. weekly cron): delete Score rows whose version no
# longer matches the current published version (community) or the
# current content hash (official). Also enforces the per-(key,version)
# top-10 cap.
node scripts/moderator.mjs purge-stale-scores --dry-run
node scripts/moderator.mjs purge-stale-scores
```

Official challenge versions are read from `scripts/official-versions.json`,
which is written by the prebuild step (`tsx scripts/build-official-versions.ts`).
After bumping a wave list in `src/challenges.ts`, run `npm run build`
to refresh the file before running `purge-stale-scores`.

The `recordName` in each command is shown in the `list-reports` output
(it starts with `pub-`).

## What players see when you hide

The community list filters on `status == "approved"`, so a hidden
challenge stops showing up on subsequent refreshes. Players who already
installed the challenge keep their local copy — the live update
subscription does not delete records, only patches authored content
on re-publish. If you want a hidden challenge gone from installed
players' devices too, that's a manual delete (use the CloudKit Dashboard
or extend the script with a `delete <recordName>` subcommand).

## Ad-hoc edits

For one-off fixes you can use the [CloudKit Dashboard](https://icloud.developer.apple.com/)
directly — the script is just a faster surface for the routine
list/hide/unhide/recount path.

## Threat model

This system is appropriate for a small game with a manageable abuse
volume. It is not a content firewall:

- The client-side bad-words filter (`src/moderation.ts`) catches casual
  abuse at publish time but a determined user can leetspeak around it.
- There is no rate-limit on publishing; if abuse becomes a real problem,
  the next step is a server-side function that gates publish behind a
  CK-side count check.
- Reports are user-driven. Plan to do a routine sweep (e.g. weekly) in
  addition to acting on incoming pings.

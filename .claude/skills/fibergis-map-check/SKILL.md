---
name: fibergis-map-check
description: Runs a read-only health check on FiberGIS network data and explains the problems in plain words. Use whenever someone asks to check the map, audit mapping or data quality, find wrong connections, missing links or duplicates, see what needs fixing before going live, after an import or a big cleanup, or asks "is my network mapped correctly", even if they do not say "check" or name this tool.
---

# Map check

Finds mistakes in saved network data. It only reads, and changes nothing.

## Run it

From the project root:

```
node .claude/skills/fibergis-map-check/scripts/check_network.mjs
```

This reads `http://localhost:5000/api/v1/network`. Options:

| Option | Use |
|---|---|
| A URL | Check another server |
| A file path | Check a backup file |
| `--json` | Machine-readable list |
| `--limit 50` | Show more examples per problem |

Exit codes: 0 no errors, 1 errors found, 2 could not load data.

If it cannot connect, the server is probably off. Say so, and do not start or change anything unless asked.

## Reporting results

Lead with the verdict. Then:

1. **Must fix:** broken data. Group similar problems, and give counts plus one example
2. **Check these:** may be fine, but a person should look
3. **Good to know:** only mention if useful

Use plain words and say what the problem means on the street: "24 customers point to a house wire that was never drawn, so their path cannot be traced." Offer fixes, but do not change data unless asked. Deleting or editing real records needs the owner's clear approval and a backup first.

Always include the limit: **passing this check does not prove the map matches the street.** A wrong choice that looks valid passes every check. Only photos and site visits catch those.

## What it cannot see

- Whether light actually reaches a customer, because it does not follow splices
- Whether readings are real. It flags 0 dBm, but cannot otherwise separate estimates from measurements, since the app stores both in one field
- Loss budgets across a whole path
- Cable TV levels, because the data does not exist yet

Rule meanings, evidence and how to add rules: `references/rules.md`.

## Changing the checker

Add a test to `scripts/check_network.test.mjs` for every rule change, then run:

```
node --test .claude/skills/fibergis-map-check/scripts/check_network.test.mjs
```

Use a blocking error only for physical impossibilities and broken data. Everything else is a warning, as `fibergis-data-truth` explains. Keep limits in `DEFAULT_LIMITS`, and update the reference file with the source.

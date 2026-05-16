# Staging Workflow — Vercel Preview + Supabase Branches

Established May 17, 2026. Owner: Abhay.

This is **Option B**: every PR or non-main commit gets its own ephemeral Vercel Preview deploy AND its own Supabase branch (separate Postgres). No risk to production data. No risk to other team members' work on `main`.

## How it works

```
git checkout -b feat/my-change
git push origin feat/my-change
   │
   ├─▶ Vercel detects push → builds Preview at https://nexus-bi-git-feat-my-change-...vercel.app
   │
   └─▶ Supabase detects push → spins up branch DB at jlgstbucwawuntatrgvy-feat-my-change.supabase.co
        ├── seeded from current production schema
        ├── runs any new migrations in /migrations/
        └── isolated row-level data
```

When the PR is merged to `main`:
- Vercel Preview becomes the canonical Production deploy.
- Supabase branch's migrations are auto-applied to the production project.
- The branch is deleted.

## One-time setup (must be done in Supabase Dashboard — no API)

1. Go to https://supabase.com/dashboard/project/jlgstbucwawuntatrgvy
2. Left nav → **Branches** (under "Database")
3. Click **Enable branching**
4. When prompted for GitHub repo: select `boardinfinity/nexus`
5. **Production branch**: keep `main`
6. **Migrations directory**: enter `migrations`  (matches our repo layout)
7. Click **Enable branching** to confirm.

After this, every Vercel Preview gets paired with a Supabase branch automatically.

### Vercel side (already configured)

Vercel Preview deploys already work for every push. Once Supabase branching is on, Vercel will receive the branch DB's connection string via the Supabase ↔ Vercel integration. If not already linked:
1. Vercel dashboard → Project `nexus-bi` → Integrations → Supabase
2. Authorize → select the `jlgstbucwawuntatrgvy` project
3. Done — connection strings flow automatically.

## Cost

Supabase branching: free for the first 2 branches on Pro plan (we have Pro). Each extra branch = $0.32/day. Plan to keep ≤2 live branches at a time; delete merged ones.

## Daily workflow

```bash
# Start a new feature
git checkout -b feat/new-thing
# ... edit code, write a migration in migrations/045_new_thing.sql
git push origin feat/new-thing

# A Preview URL + a branch DB are now live.
# Test against the Preview URL — production is untouched.

# When ready, open a PR → merge → main.
# Migration auto-applies to production DB.
```

## Safety rails

- **Never** run `apply_migration` against the production project (`jlgstbucwawuntatrgvy`) from local code while a branch exists for that migration — let the merge handle it.
- Production credentials in `.env.production` remain pointed at the prod project. Vercel Preview env vars override them with branch DB URLs automatically via the integration.
- If a branch's migration fails on merge, the merge is blocked — fix the migration in the branch first.

## Reference

- Supabase branching docs: https://supabase.com/docs/guides/platform/branching
- Vercel + Supabase integration: https://vercel.com/integrations/supabase

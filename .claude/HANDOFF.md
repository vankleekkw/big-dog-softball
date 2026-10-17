# Handoff — Big Dog Gotta Eat Softball website

Updated 2026-10-17.

## Where we left off

Planning is done and approved. Full plan: `/Users/VanKleek/.claude/plans/effervescent-gliding-pancake.md` — read that file for architecture, data model, decisions, and open items. Don't re-derive any of it; it's all there.

## Next action

Start the build-cycle **Branch** step in this directory (`/Users/VanKleek/GitHub/softball-stats`, not yet a git repo — `git init` here, this folder already has `scrape.py` and the logo). Then build per the plan: D1 schema → historical migration (adapt `scrape.py`) → Cloudflare Pages/Functions site → admin panel → Cloudflare Access auth.

## Watch out for

- Don't scrape slowpitchstats.com seasonID `21416` (current season, "2026 Fall AHeights") until Kris confirms it's final.
- Admin auth must gate the Pages Functions API routes themselves, not just the `/admin` HTML page.
- Season-close record/playoff snapshot must be scrape-then-admin-confirm, never scrape-and-trust.
- `is_main_player` (bio page) auto-seeds at career AB ≥ 100, then is manually toggled in admin — don't hardcode the threshold as a permanent rule.
- Two open items, both non-blocking: recovered historical content from the dead webs.com/wix.com sites (Kris still chasing), and writing the actual bio text/photos for qualifying players.

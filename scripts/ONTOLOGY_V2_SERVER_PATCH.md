# Ontology v2 — Server-Side Migration Patch (PR 4)

This document is the **integration kit** for switching the data-server Python pipeline (`/home/admin/clawd/scripts/`) from emitting V1 method-family slugs (`vla_core`, `flow_matching`, `agentic_coding`, ...) to emitting V2 slugs (`vla.foundation.vla_generalist`, `vla.action.flow_matching`, `ai.coding.agentic_coding`, ...).

**Prerequisite:** PRs 0–3.5 already shipped on `main`. The site reads V1 slugs from `field-state-*.json` and alias-resolves them at render time. PR 4 makes the Python pipeline emit V2 natively so we can drop the read-time aliasing in PR 5.

**Risk:** medium. Each touched script is on a daily/weekly cron; bad code = silent paper drop. Validation steps inline.

---

## 0. One-time setup on the data server

```bash
# Pull the auto-generated Python ontology module from this repo:
cd /home/admin/clawd/scripts
curl -fsSL -o _ontology_v2.py \
  https://raw.githubusercontent.com/sou350121/pulsar-web/main/scripts/_ontology_v2.py
python3.11 _ontology_v2.py  # smoke
# Expected:
#   ONTOLOGY: 106 nodes
#   LEAVES: 78
#   CATCH_ALL: 2 (['vla.efficiency.async_inference', 'vla.efficiency.vla_acceleration'])
#   ALIAS_V1_TO_V2: 26 entries (1 retired)
```

Add a cron job (or `crontab -e` entry, or extend an existing watchdog) to re-curl this file weekly so the data server stays in sync with main:

```cron
# 02:00 every Mon — refresh ontology Python module from pulsar-web main
0 2 * * 1 cd /home/admin/clawd/scripts && curl -fsSL -o _ontology_v2.py.tmp https://raw.githubusercontent.com/sou350121/pulsar-web/main/scripts/_ontology_v2.py && mv _ontology_v2.py.tmp _ontology_v2.py
```

(The atomic `tmp + mv` mirrors the talent-embeddings re-bake pattern from PR 3.)

---

## 1. `_vla_method_families.py`

**Current state (per CLAUDE.md memory):** holds a `METHOD_FAMILIES` constant that drives the LLM keyword filter in `vla-rss-collect.py`. Adding a new method to this file makes the RSS routing follow.

**Migration:** replace the hand-curated list with one derived from `_ontology_v2.LEAVES`. Filter to VLA-domain slugs only.

```python
# OLD (V1):
METHOD_FAMILIES = [
    "vla_core",
    "flow_matching",
    "diffusion_policy",
    # … ~18 hand-curated entries
]

# NEW (V2):
from _ontology_v2 import LEAVES, KEYWORDS, DISPLAY_NAMES

METHOD_FAMILIES = [s for s in LEAVES if s.startswith("vla.")]
# Optional: expose display name + keyword list to LLM prompt
METHOD_FAMILY_LABELS = {s: DISPLAY_NAMES.get(s, s) for s in METHOD_FAMILIES}
METHOD_FAMILY_KEYWORDS = {s: KEYWORDS[s] for s in METHOD_FAMILIES}
```

**Acceptance test:**
```bash
python3.11 -c "from _vla_method_families import METHOD_FAMILIES; print(len(METHOD_FAMILIES), METHOD_FAMILIES[:5])"
# Expect: 45 ['vla.foundation.vla_generalist', 'vla.foundation.cross_embodiment_fm', ...]
```

**Cron impact:** `vla-rss-collect.py` (09:05). Run once manually after the patch (`python3.11 vla-rss-collect.py --dry-run` if it supports it; otherwise just observe the next 09:05 run for paper-count regression — should be ≤10% drop, NOT 50%+).

---

## 2. `compute-field-state.py` — DUAL-WRITE phase

**Current state:** emits `field-state-YYYY-MM-DD.json` with `method_trends[].family` as a V1 slug.

**Migration strategy:** dual-write — emit BOTH V1 (existing field) and V2 (new field `family_v2`) for one week. This lets `loadSubdirections` keep reading the V1 field (no site-side change yet) while building a V2-flavored shadow you can validate against. Then switch the site to read `family_v2` (PR 5), at which point you can drop the V1 emit.

```python
# Add to imports at top of compute-field-state.py:
from _ontology_v2 import rank_method_families, ALIAS_V1_TO_V2

# Existing per-family aggregation loop — wherever it constructs:
#   trend = {"family": v1_slug, "count_7d": ..., ...}
# add the V2 field:
trend = {
    "family":     v1_slug,                                          # keep V1 for now
    "family_v2":  ALIAS_V1_TO_V2.get(v1_slug, v1_slug) or v1_slug,  # NEW
    "count_7d":   ...,
    ...
}
```

**Alternative (cleaner once you're confident):** route papers through `rank_method_families` instead of the legacy V1 routing entirely. This produces a different cardinality (V2 has 45 VLA leaves vs V1's 16). Defer until after the dual-write week shows the V2 distribution is healthy.

**Acceptance test:**
```bash
python3.11 compute-field-state.py  # or manually trigger next 09:56 cron
jq '.method_trends[0]' /home/admin/clawd/memory/field-state-$(date +%F).json
# Expect both fields present: "family": "flow_matching", "family_v2": "vla.action.flow_matching"
```

**Cron impact:** 09:56. Watchdog #25 (see §4 below) catches the case where V2 field is missing.

---

## 3. `compute-gh-adoption.py`

**Current state (per memory):** Fri 13:00, tags GH issue adoption signals per family. Writes `gh-adoption.json` (path on data server; check `/home/admin/clawd/memory/`).

**Migration:** same dual-write pattern as field-state. Wherever a record carries `family: "vla_core"`, add `family_v2: "vla.foundation.vla_generalist"`.

```python
from _ontology_v2 import ALIAS_V1_TO_V2, rank_method_families

# At every record-emit site:
record["family_v2"] = ALIAS_V1_TO_V2.get(record["family"], record["family"]) or record["family"]
```

If the script does its own title-based family routing (likely, since adoption is keyword-matched), prefer `rank_method_families(titles)` over the legacy router. The output is V2-native.

**Acceptance test:**
```bash
python3.11 compute-gh-adoption.py
jq 'to_entries[0:3]' /home/admin/clawd/memory/gh-adoption.json
# Confirm family_v2 appears alongside family
```

**Cron impact:** Fri 13:00. Weekly. Lower urgency than #2.

---

## 4. Watchdog v13 — add Check #25

Existing watchdog asserts pipeline freshness/completeness. Add an ontology-consistency check:

```python
# In the watchdog (e.g. watchdog-v13.py):
def check_25_ontology_v2_present():
    """The latest field-state file must contain ≥1 family resolvable via V2."""
    from _ontology_v2 import ONTOLOGY, ALIAS_V1_TO_V2
    # Find newest field-state-*.json
    import glob, json, os
    files = sorted(glob.glob("/home/admin/clawd/memory/field-state-*.json"), reverse=True)
    if not files:
        return False, "no field-state-*.json found"
    data = json.load(open(files[0]))
    trends = data.get("method_trends", [])
    if not trends:
        return False, f"field-state {files[0]} has empty method_trends"
    resolved = 0
    for t in trends:
        # Accept either V1 (resolvable via alias) or V2 (direct)
        f = t.get("family_v2") or t.get("family")
        if f in ONTOLOGY or ALIAS_V1_TO_V2.get(f) in ONTOLOGY:
            resolved += 1
    if resolved < 1:
        return False, f"0/{len(trends)} families resolvable in V2 ontology"
    return True, f"ok ({resolved}/{len(trends)} resolvable)"
```

Wire into the existing 24-check loop. Status becomes 25/25 (or 26/26 if there's already drift in count).

---

## 5. After ALL three Python scripts ship + watchdog #25 is green for 7 days

That's the criterion for advancing to **PR 5** (drop V1 alias-resolution from `loadSubdirections`, delete `METHOD_FAMILY_KEYWORDS` / `METHOD_FAMILY_LABELS` / `rankMethodFamilies` / `familyDisplay` from `talent.ts`).

---

## Rollback

Everything in this patch is **additive**:
- `_ontology_v2.py` is a new file
- `family_v2` is a new field in JSON (V1 `family` unchanged)
- Watchdog #25 is a new check

Roll back by:
- `rm /home/admin/clawd/scripts/_ontology_v2.py`
- Revert each Python script's diff
- Remove the cron entry

No data is destroyed; the site continues to read V1 with the read-time alias map. Time to roll back: ~5 minutes.

---

## Suggested execution order on the data server

```bash
# 1. Pull ontology module
cd /home/admin/clawd/scripts
curl -fsSL -o _ontology_v2.py https://raw.githubusercontent.com/sou350121/pulsar-web/main/scripts/_ontology_v2.py
python3.11 _ontology_v2.py  # sanity

# 2. Patch _vla_method_families.py (smallest blast radius — touches RSS routing only)
$EDITOR _vla_method_families.py
# Apply §1 above
python3.11 -c "from _vla_method_families import METHOD_FAMILIES; print(len(METHOD_FAMILIES))"

# 3. Patch compute-field-state.py (dual-write)
$EDITOR compute-field-state.py
# Apply §2 above
python3.11 compute-field-state.py
jq '.method_trends[0]' /home/admin/clawd/memory/field-state-$(date +%F).json

# 4. Patch compute-gh-adoption.py
$EDITOR compute-gh-adoption.py
# Apply §3 above
# (run manually only if you want to test; otherwise wait for Fri 13:00)

# 5. Patch watchdog with check #25
$EDITOR watchdog-*.py
# Apply §4 above
python3.11 watchdog-*.py  # smoke

# 6. Set up the weekly ontology-refresh cron
crontab -e
# Add the entry from §0

# 7. Monitor for 7 days. If green → ready for PR 5.
```

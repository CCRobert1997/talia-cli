# Talia CLI (`talia`)

Build an **interactive film** from the command line — or let an AI do it for you: create nodes, wire branches, attach videos, configure interactions, publish. One command (or one sentence) at a time. **It runs on the same engine and the same invariants as [editor.taliaapp.com](https://editor.taliaapp.com)**, so whatever the CLI builds is identical to what you'd hand-build in the editor — it can never produce "publishes but won't play" bad data.

> **Good for:** batch-building trees, one-shot generation from an outline, scriptable/reproducible authoring, letting an AI do the work.
> **Not for (still use the editor):** **producing video** (the CLI generates no media), **fine placement** (tap/hotspot exact positions and on-screen button composition are better dragged against a real frame), **final eyeball preview**.
> **Best workflow = CLI for the skeleton + editor for the polish.**

---

## 1. Install & log in

```bash
# One-line install from the public repo (recommended — no npm account needed):
npm i -g github:CCRobert1997/talia-cli
# then just:
talia <command>

# Inside the monorepo (internal/dev):
npm run cli -- <command>
```
> Requires Node 20+. Examples below are written as `talia <command>`.

Log in with your Talia creator account (the same one as the web app):
```bash
talia login you@example.com
talia whoami        # confirm you're logged in
```
You can only read/write **your own** projects (same permissions as the web app).

> **Which database:** with no env vars set, the CLI talks to Talia production (the built-in project URL + anon publishable key are public by design; RLS scopes every write to the logged-in owner). To point at a self-hosted / other instance, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` (or write `~/.talia/config.json`).
>
> **For agents:** add `--json` to any command — read commands (`whoami` / `projects` / `choices` / `vars` / `achs` / `assets` / `validate` …) print one JSON line (the rows); write commands print `{"ok":true,"id":"…"}`. More reliable than parsing the human text. (`validate` still exits 2 when there's an error-severity issue.)

---

## 2. Make a demo in five minutes (videos already prepared)

Say you have 3 clips and want an "elevator encounter → report / stay silent → ending" branching demo.

**① Write the story as an outline file `story.md`:**
```markdown
# Elevator encounter
- Report her -> Report path
- Pretend you saw nothing -> Silent path
# Report path
- Continue -> Ending
# Silent path
- Continue -> Ending
# Ending
```
Rules: `#` heading = one node; `- text -> Target node title` = one choice (wired by title). **The first node is auto-set as Start.**

**② Build the whole tree at once:**
```bash
talia project new "Elevator Demo"      # note the returned <projectId>
talia import-outline <projectId> story.md
# ✓ Imported 4 nodes, 4 choices, Start = "Elevator encounter"
```

**③ Upload video and attach it to a node:**
```bash
talia asset upload <projectId> elevator.mp4   # returns a https://videos.taliaapp.com/... link
talia choices <someNodeId>                     # use the list commands when you forget a node/choice id
talia node set <nodeId> video <the link from above>
```
> Node ids: visible when you open the project in the editor; or run `talia import-outline` then `talia choices` / check the project page.

**④ (Optional) add an interaction**, e.g. turn a choice into a "find the hotspot":
```bash
talia choice interaction <choiceId> '{"template":"hotspot_collect","hitGoto":"<targetNodeId>","defaultGoto":"<targetNodeId>"}'
# hotspots are pre-seeded and publish-validation guarantees it's playable; drag exact positions in the editor
```

**⑤ Validate + publish:**
```bash
talia validate <projectId>    # runs the same 13 publish checks as the editor, lists issues
talia publish <projectId>     # publishes once it passes; players can see it
```

**⑥ Polish in the editor**: open the project at `editor.taliaapp.com`, drag hotspots against real frames, tune choice skin/position, eyeball-check with Preview.

---

## 3. Outline format (`import-outline`)

```markdown
# Node title
- Choice text -> Target node title
- Another choice -> Another node
# Another node
...
```
- `#`…`######` heading → one node (the heading is the node name).
- `- text -> Target title` → a choice out of the current node, wired to the node whose title matches.
- The first node → auto-set as the project Start.
- Unknown target title → that choice is left unset + a warning is printed (not an error — handy for sketching the skeleton first).

---

## 4. Command reference

| Group | Commands |
|---|---|
| Account | `login [email] [password]` · `whoami` · `logout` |
| Project | `projects` · `project new <title>` · `project rm <id>` · `project theme <id> <preset\|clear\|custom>` |
| Project · theme bg | `project theme <id> warm_dark` (6 presets) · `project theme <id> clear` · `project theme <id> custom "#RRGGBB,#RRGGBB" [dark]` (2–5 colors) |
| Node | `node add <project>` · `node set <node> <title\|video\|image\|auto> <value>` · `node start <project> <node>` |
| Choice | `choice add <node> [text] [target]` · `choice set <choice> <label\|target> <value>` · `choice rm <choice>` · `choices <node>` |
| Choice · presentation | `choice present <choice> '{"skin":"preset:gilded","size":"l","font":"playfair"}'` |
| Choice · gesture | `choice tap <choice> <x> <y> <w> <h> [hint]` (normalized 0..1) |
| Choice · advanced | `choice interaction <choice> '{"template":"hotspot_collect",...}'` |
| Variable | `var add <project> <name> <bool\|int> [default]` · `vars <project>` · `var rm <id>` |
| Achievement | `ach add <project> <name> <emoji> [description]` · `achs <project>` · `ach rm <id>` |
| Asset | `asset upload <project> <file>` · `assets <project>` · `asset rm <id>` |
| Build tree | `import-outline <project> <file.md>` |
| Publish | `validate <project>` · `publish <project>` |

**Global flag:** `--json` on any command (see §1).

**Advanced interaction templates** (`choice interaction`'s `template`): `hotspot_collect` (find the hotspot) / `bullet_time` (timed dodge) / `combo_rated` (combo) / `wipe_reveal` (wipe to reveal) / `roaming_reticle` (roaming aim) / `timing_meter` (rhythm bar). Fields: `hitGoto` / `missGoto` / `defaultGoto` (node ids), `params` (template params, e.g. `{"needK":3}`).

**Skins** (`choice present`'s `skin`): `default` / `preset:outline` / `preset:gilded` / `preset:film` / `preset:romance` / `image:<r2 link>`. Fonts: `modak` / `playfair` / `bebas` / `oswald` / `pacifico` / `anton` / `noto_sans_sc` / `noto_serif_sc` / `ma_shan_zheng` / `long_cang` / `cairo`. Sizes: `s` / `m` / `l`.

---

## 5. Let an AI drive it

A human can type these commands — **so can an AI/agent**. You can tell a tool like Claude:

> "Turn these 5 clips into a three-branch interactive demo where the lead decides, in an elevator, whether to report her."

and let it **generate the outline + run the commands above + upload the assets + configure the interactions + validate & publish**. You go from "clicking through the editor" to "describing what you want." The `--json` flag makes every command's output easy to parse.

---

## 6. Notes & caveats

- **Permissions:** everything runs under your own account; you can only touch your own projects (same as the web app).
- **Don't experiment on live work:** `project rm` cascades. Test on a fresh throwaway project and delete it when done.
- **Publish validation is the main guard:** `validate` with any error blocks publishing (e.g. empty hotspot, a choice with no target); follow the hints to fix.
- **Video/images:** `asset upload` sends them to Talia's CDN and registers them; `node set video <link>` attaches to a node.
- **Fine visuals belong in the editor:** the CLI is great for structure and rough config; tap/hotspot exact positions are better dragged against a real frame.

Questions or want a new command? Reach out to the Talia team.

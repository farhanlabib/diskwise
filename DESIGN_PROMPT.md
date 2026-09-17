# Claude Design prompt — MacSweep local web UI

Paste everything below the line into Claude Design.

---

Design the web UI for **MacSweep**. It runs locally in the user's browser: the `macsweep ui` command serves it from `127.0.0.1`. It isn't a hosted website, so there's no login, marketing, or account pages. It's an open-source disk cleanup tool that **explains where disk space went** and **only deletes what is provably safe**. It's for developers and power users who've seen macOS "System Data" take 80 GB with no explanation and don't trust "one-click clean" utilities.

## Product personality
- A **measuring instrument, not a cleaner**. It should feel calm, precise and honest, closer to Activity Monitor, Linear or a good profiler than to CleanMyMac.
- No scare tactics. No red "Your Mac is at risk!", no giant pulsing "Clean" button, no mascots, no confetti.
- The explanation is the product. Every item answers three questions: **what is it, why is it safe, what does it cost to get back.**
- Honest about uncertainty: numbers that can't be measured are shown as "Unmeasured", never hidden.

## Platform & visual direction
- It's a browser page, but it should **feel like a native macOS app**: left sidebar + top toolbar layout, system font stack (`-apple-system` / SF Pro, `ui-monospace` / SF Mono for paths, sizes and commands), a subtle translucent-looking sidebar, 8-pt grid, 6–10 px radii. No web-fonts, no external images or CDNs (everything is served offline).
- Top bar shows a small "Local · 127.0.0.1" indicator and a "Stop server" action; when the server stops, show a friendly "MacSweep has stopped. Run `macsweep ui` again" page.
- Design **light and dark** mode for every screen.
- Responsive browser viewport: design at 1280×800, and also at a minimum of 960 wide, where the sidebar collapses to icons. Follow the system light/dark preference (`prefers-color-scheme`).
- Sizes are always right-aligned, tabular numerals, one decimal ("16.2 GB"). When apparent and allocated sizes differ, show both: "2.7 GB used · 228 GB apparent".
- Accessibility: WCAG AA contrast. Tiers are never shown by color alone; always use label + icon shape too. Full keyboard navigation (↑↓ to move, Space to toggle, ⌘↩ to continue).

## Safety tier system (core visual language)
Four tiers appear everywhere as a small pill badge with a distinct shape and a muted color:
| Tier | Label | Meaning | Suggested treatment |
|---|---|---|---|
| 0 | Regenerates | Rebuilt locally, no user data | green-teal, circle icon |
| 1 | Re-download | No user data, costs network/time | blue, down-arrow icon |
| 2 | Your data | Real user data, goes to Trash | amber, person/document icon |
| 3 | Protected | Explained only, never actionable | gray, lock icon |

Special badges: **Needs root** (terminal icon; the item becomes a "copy this command" card, the app never asks for a password), **Permanent only** (can't go to Trash), **App running** (blocked until the app quits).

## Screens to design

### 1. Permissions onboarding (first launch)
- Explains why Full Disk Access is needed. Without it, parts of Mail, Messages and Safari are unreadable and get reported as "Unreadable".
- Because MacSweep runs inside the terminal, access is granted to **the terminal app** that launched it. Show the detected one with its name ("Grant Full Disk Access to **iTerm2**").
- Step-by-step: "Open System Settings → Privacy & Security → Full Disk Access → enable iTerm2 → quit and re-run `macsweep ui`". Include a copy button for the command and a status indicator ("Limited / Granted").
- Secondary action: "Continue with limited access".
- Short privacy promise: "Runs only on this Mac. No outbound network. No telemetry. Nothing is deleted without your confirmation."

### 2. Scanning
- Progress: current path in monospace (truncated in the middle), entries scanned, elapsed time, and a Cancel button.
- Buckets fill in live as they complete (skeleton rows turning into real rows).

### 3. Overview (home)
- Headline: **"38.4 GB reclaimable"**, with a subline breaking it down by tier: "12.1 GB regenerates · 24.9 GB re-download · 1.4 GB your data".
- One wide **segmented disk bar** for the 494 GB container: Apps · Developer · Caches · Your data · System (protected) · Unmeasured (hatched) · Purgeable · Free. Include a legend with sizes, and hovering a segment shows its detail.
- "Largest wins" card list, top 5: e.g. "iOS 26.1 simulator runtime — 16.0 GB — unused for 94 days — Tier 1".
- A **trap card**: "Docker.raw looks like 228 GB in Finder. It actually uses 2.7 GB (sparse file). Nothing to do." Style it as reassurance, not a warning.
- Small permissions status chip in the corner (Full Disk Access: on / limited).

### 4. System Data explainer
- Title: "What macOS calls 'System Data'" with the total, e.g. 78.2 GB.
- A treemap or stacked horizontal bars of named sub-buckets, each with plain-English text and a tier badge:
  - CoreSimulator runtimes & devices — 39.1 GB — Tier 1
  - /private/var (swap, databases, temp) — 7.7 GB — Tier 3 Protected
  - Homebrew (/opt/homebrew) — 5.0 GB — mixed
  - Chrome on-device AI model — 4.0 GB — Tier 1, "Chrome will re-download unless disabled"
  - Local Time Machine snapshots — 3 snapshots — "size not measurable without root" + copy-command card
  - **Unmeasured (protected / needs root)** — 11.6 GB — hatched pattern, with an explanation of why
- Selecting a bucket opens a right-side detail panel: what it is, why it exists, whether and how it's safe to reclaim, and a link to "Show in Finder" / "Review in Cleanup".

### 5. Apps
- A searchable, sortable list of installed apps. Columns: icon · name + version · last used ("3 days ago" / "unknown") · running dot · **Caches** size · **App data** size · total. Default sort is reclaimable caches, largest first.
- Filter chips: All · Has caches to clean · Running · Not used in 90+ days · **Orphaned data** (apps already uninstalled, shown with a generic app icon and their bundle id).
- Selecting an app opens the detail view (full-width, or right panel at wide sizes):
  - Header: big icon, name, version, bundle id in monospace, last used, and a "Running" state with a **Quit app** button.
  - Location groups as cards, each with size, tier badge and plain-English explanation:
    - **Caches**: 1.8 GB, Tier 0: "Slack rebuilds these when it opens. You stay signed in." Expand to see individual folders (Cache, Code Cache, GPUCache, Service Worker) with paths.
    - **Logs**: 120 MB, Tier 1: "Diagnostic history only."
    - **Sign-in & site data**: 64 MB, Tier 2, report-only: "Deleting this would sign you out." No checkbox.
    - **App data**: 2.4 GB, Tier 2, report-only: "Your messages, downloads and workspaces." No checkbox; "Show in Finder".
    - **Settings**: 12 KB, Tier 3 Protected.
  - Primary button **"Clean caches · 1.9 GB"**, which opens the same Review sheet as screen 7. If the app is running, the button reads "Quit Slack to clean" and the Quit action sits next to it.
  - A small label showing the knowledge source: "Known app profile" or "Generic rule (standard cache folders only)".
- Example apps: Slack (1.8 GB caches, running), Discord (1.2 GB), Visual Studio Code (940 MB), Microsoft Teams (2.6 GB), Spotify (3.1 GB, which includes an offline songs cache marked Tier 1 "re-downloads offline songs"), Figma (610 MB), Zoom (220 MB), and an orphaned "com.tinyspeck.old-app" (400 MB).
- Empty state: "No app caches over 50 MB."

### 6. Cleanup
- Three-pane layout. **Left:** filter by tier and category (Developer, System, Browser, Your data). **Center:** grouped list by tier with section headers showing the live selected total. **Right:** detail panel.
- Row: checkbox · title · detail text in monospace-muted ("iOS 26.1 (23B86), unused") · size · tier badge · extra badges.
- Detail panel sections: **Why it's safe**, **Cost to get back**, **Exact action** (e.g. `xcrun simctl runtime delete 3F2A…` in a code block), **Paths** (list of paths with a Reveal button).
- States to show: item blocked because the app is running ("Quit Google Chrome to clean this", with a Quit button); needs-root item as a copy-command card with a Copy button instead of a checkbox; Tier 3 items visible but with no checkbox; a Tier 2 row marked "Moves to Trash".
- Sticky footer bar: "7 items selected · 21.3 GB · Dry run preview" with a primary button **"Review plan…"**. The primary action is never "Clean now".
- Example rows:
  - Xcode DerivedData — 8.4 GB — Tier 0
  - Homebrew download cache — 1.9 GB — Tier 1
  - node_modules in 41 projects untouched 14+ days — 7.2 GB — Tier 1 (expandable to per-project rows)
  - iOS 26.1 simulator runtime — 16.0 GB — Tier 1
  - Docker build cache — 3.1 GB — Tier 0 — "Docker is running" blocked state
  - Docker volumes (4) — 2.2 GB — Tier 3 "Databases live here — review in Docker"
  - iOS device backups — 1.4 GB — Tier 2
  - Simulator dyld cache — 2.3 GB — Needs root

### 7. Review & confirm (modal sheet)
- Summary grouped by tier with totals. Clear wording per group: "Deleted permanently (rebuilds automatically)", "Deleted permanently (re-downloads when needed)", "Moved to Trash (you can undo)".
- For Tier 2 or permanent-only items: a **typed confirmation field** ("Type `ios.backups` to confirm"). Keep the confirm button disabled until it matches.
- Buttons: Cancel · **Clean 21.3 GB**.

### 8. Running & result
- Per-item progress list with statuses: queued, running, done (with bytes actually freed), skipped (with reason), failed (with error).
- Result summary: "Freed 20.8 GB (planned 21.3 GB)". Explain the gap honestly ("Docker.raw shrinks gradually"). Buttons: "View in History", "Undo trash moves".

### 9. History
- Timeline list of runs: date, freed amount, number of items, and a badge for whether it can be undone.
- Run detail: each action with before/after bytes, whether it's restorable, and an **Undo** button for items still in the Trash. Items that can't be restored are shown greyed with a reason ("Trash was emptied", "Rebuilds automatically, nothing to restore").

### 10. Settings (small)
- Scan scope (home only / full disk), node_modules age threshold (days), excluded folders list, "Redact usernames in exported reports", Export report (Markdown/JSON).
- Local server section: address (`127.0.0.1:52814`), uptime, and a **Stop server** button.
- About section: open source, MIT, version, and "No outbound network. No telemetry." stated as a fact.

### 11. Session pages (small, centered, minimal)
- **Server stopped**: "MacSweep has stopped." plus a copyable `macsweep ui` command to start it again.
- **Invalid or expired link** (missing token): "Open MacSweep from your terminal: run `macsweep ui`." Don't include any technical token details.
- **Reconnecting**: shown briefly if the progress stream drops during a scan.

## Components to include in the design system sheet
App row, app location group card, Quit-app inline action, tier badge (4 tiers × light/dark), special badges, segmented disk bar (with hatched Unmeasured segment), finding row (default, hover, selected, checked, blocked, root-command, protected), detail panel, copy-command card, trap/reassurance card, typed-confirmation field, sticky selection footer, empty states ("Nothing to clean in this tier — nice."), error state (scan failed / permission denied subtree shown as "Unreadable: 3.2 GB").

## Deliverables
1. All 11 screens in light mode, and screens 3–7 (Overview, System Data, Apps, Cleanup, Review) also in dark mode. Show Overview and Apps at the 960-wide collapsed-sidebar size too.
2. Component sheet with states, including the app row (default, running, orphaned) and location group card.
3. A clickable prototype flow: Onboarding → Scanning → Overview → System Data → Apps → Slack detail → Review → Running → Result → History. Include a second path: Overview → Cleanup → Review.

Sidebar order: Overview · System Data · Apps · Cleanup · History · Settings.

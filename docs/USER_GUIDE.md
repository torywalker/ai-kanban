# AI Kanban User Guide

AI Kanban is a desktop Kanban board where every card is a prompt. You can use it as a prompt library you copy from. You can also treat it as a control room for many Claude Code agents working at once, each on its own card, in its own git worktree, with its own cost, transcript, and build status.

This guide covers how to think about the app, how to set it up, and what every feature does.

---

## 1. The mental model

### A card is a unit of work

A card has three parts:

- **The prompt**: the instruction you would give Claude.
- **The context it runs in**: which repo, which model, whether it gets a worktree, and which engine runs it.
- **The record of what happened**: transcript or terminal, cost, comments, ship history, CI status.

Write each card the way you would scope a pull request: one clear outcome. Small, focused cards run faster, cost less, merge cleanly, and are easy to throw away when they go wrong.

### Lists are your workflow

The app does not enforce a workflow. Lists are just columns, and you move cards between them yourself. The default board starts with **Waiting**, **In Flight**, and **Done**, which fits the usual flow:

| Column | Meaning |
| --- | --- |
| Waiting | Prompts you have written but not started. Your backlog. |
| In Flight | Cards whose agent is running, needs you, or is waiting to be reviewed and shipped. |
| Done | Shipped or abandoned. |

The app treats any list whose name contains the word **Done**, **Finished**, or **Completed** as a done column. Dropping a card there fires confetti, closes the card's terminal if it has one, and (if enabled) offers to delete its worktree.

Rename or add lists to match how you work: "Review", "Blocked", "Ideas", "Ship today", and so on.

### Boards are projects or contexts

Use one board per repo or project. Each board has its own default repo, scratchpad, terminals, spend total, and Ship conflict prompt. That way a card created on the board already knows where it should run.

### You are the reviewer, not the typist

Agent work happens in the background. The app tells you when a card finishes or needs input, with a sound, a desktop notification, and an unread dot. A good rhythm:

1. Write several cards in **Waiting**.
2. Run them, so they work in parallel in separate worktrees.
3. Do something else until a notification arrives.
4. Open the card, review the transcript and diff, reply or approve.
5. **Ship** it, then move it to **Done**.

### Your data stays on your machine

Boards, lists, and cards live in one JSON file on your disk. Nothing syncs to a server. You can back the file up, keep it in a synced folder, or put it under version control.

---

## 2. Getting started

### Requirements

Install these before your first run:

| Tool | Why | Check it works |
| --- | --- | --- |
| **Claude Code CLI** ([install](https://docs.anthropic.com/en/docs/claude-code)), signed in | Runs every agent. The default engine launches your `claude` command directly. | `claude --version` in a new terminal |
| **Git** | Worktrees and Ship | `git --version` |
| **GitHub CLI** ([install](https://cli.github.com)), signed in with `gh auth login` | Build status on cards | `gh auth status` |

Without the Claude Code CLI you can still use the board, the prompt library, and copying, but nothing will run. Without the GitHub CLI everything works except build status.

Terminal sessions are not available on Windows yet, so Windows uses the built-in engine. Everything else works on macOS, Windows, and Linux.

### First launch

The app asks where to keep your board file:

- **Use default location** creates `~/Documents/ai-kanban/kanban.json` with one starter board.
- **Choose a location** lets you pick any path, for example a Dropbox or iCloud folder.
- **Open an existing file** loads a board file you already have.

### Five-minute setup

1. **Set the board's default repo.** Click **Set default repo…** next to the board name and pick your project folder. Every card on the board runs there unless it overrides it.
2. **Open Settings (⌘⇧S) → Agent sessions.**
   - Choose a **default model**.
   - Choose **tool approval**: *Ask every time* while you learn the app, *Smart auto* once you trust it.
   - Turn on **Run cards in git worktrees** if you plan to run more than one card at a time against the same repo. This is recommended.
   - The **session engine** defaults to Terminal (Claude CLI). Switch to Built-in if you prefer a structured transcript (see [Session engines](#session-engines)).
3. **Create a card** with ⌘N, write a prompt, save with ⌘⏎.
4. **Open the card and click Run.**

---

## 3. Boards and lists

- **Create a board** from the sidebar. Right-click a board to rename or archive it. Archived boards are hidden but stay in the file, and you can restore them from Settings → Boards.
- **Pick an emoji** for a board. It shows next to the name and replaces the initial when the sidebar is collapsed (⌘B).
- **Switch boards** with ⌘⌥↑ / ⌘⌥↓.
- **Rename a board** by clicking its name in the header.
- **Add a list** with the column at the far right. Drag a list's handle to reorder it. Each list's options menu can archive every card in the list or delete the list.
- **Unread dots** on a board in the sidebar mean one of its cards has news you have not seen.

### Board header

| Control | What it does |
| --- | --- |
| Default repo | Folder every card on this board runs in unless the card overrides it. |
| Show / Hide archived | Shows archived cards in place so you can restore them. |
| Scratchpad | Free-form notes for this board, saved as you type (⌘⇧P). |
| Spend | Daily spend chart for this board over a date range you pick. |
| Terminals | Plain shell tabs for this board (⌘⇧T). See [General terminals](#general-terminals). |
| Total cost | What every agent session on this board has cost. Hover for the breakdown. |
| Bell | Mutes or unmutes notification sounds and desktop notifications. |

### Finding cards

- **Filter bar**: type to filter the current board by title, prompt, notes, or tag. Click tag chips to narrow further. A card must have every selected tag to show.
- **⌘K**: search every card on every board.

---

## 4. Cards

### Creating cards

- **⌘N** opens the composer for the current board.
- **⌘⌥N** works from anywhere on your system, even when the app is in the background. It opens a small floating window, and the card lands in the first column of the board you pick. Use it to capture an idea the moment you have it.

### Card fields

| Field | Purpose |
| --- | --- |
| Title | Short name shown on the board. |
| Prompt | The text you copy or run. Supports `{{variables}}` and `/snippets`. |
| Priority | Low, Medium, High, or Critical, shown as an icon on the card. |
| Color | Tints the card so it stands out. Visual only. |
| Due date | A calendar day. |
| Tags | Labels you create inline. Manage their names and colors in Settings → Tags. |
| Notes | Your private notes: outcome, what to try next time. Never copied or sent to the agent. |
| Link | A URL, such as a ticket or a doc. Opens from the card face. |
| Images | Paste or drop screenshots. They are sent with the prompt when it runs. Click a thumbnail to see the full image. |

**Overrides** (collapsed in the composer) change where and how this one card runs:

| Override | Default |
| --- | --- |
| Working directory | The board's default repo |
| Model | Settings → Default model |
| Git worktree | Settings → Run cards in git worktrees |
| Engine | Settings → Session engine |

### Variables

Write `{{name}}` anywhere in a prompt:

```
Add a {{feature}} endpoint to the {{service}} service and cover it with tests.
```

When you copy or run the card, the app asks you to fill in each variable. Use variables to turn a card into a reusable template.

### Slash snippets

Store phrases you type often in **Settings → Prompt snippets**. Typing `/trigger` in a prompt expands it to the stored text. For example, `/grill-me` could expand to "Use the /grill-me skill to ask me questions before you start." **Comment snippets** work the same way inside card comments.

### Working with cards on the board

- **Click** a card to open it.
- **Shift-click** to select several cards, then drag them together.
- **Drag** to move or reorder. Undo (⌘Z) and redo (⌘⇧Z) cover board edits.
- **Copy** the prompt from the card face, or with **Fill & copy** when the prompt has variables. The app counts how often each prompt is copied.
- **Right-click** for Edit, Run, Close terminal, Pause/Resume, Mark unread, Move to board…, and Archive.

**Pause** marks a card as parked. It shows a pause icon and disables its controls. It does not stop or delete anything.

**Archive** hides a card without deleting it. Use **Show archived** to find it again. **Delete** (in the composer) removes the card, its images, its session, and its worktree for good.

### Comments

Each card has a timestamped comment log (⌘J in the card view). Use it as a status diary: what you tried, what the agent got wrong, what is left to do. Comments are never sent to the agent.

---

## 5. Running agents

### Session engines

The app can run a card two ways. **Terminal (Claude CLI) is the default** on macOS and Linux. Windows uses Built-in. Change the default in Settings and override it per card.

| | Terminal (Claude CLI), default | Built-in (Agent SDK) |
| --- | --- | --- |
| What you see | A real terminal running your own `claude` CLI with the prompt already submitted | A structured transcript with tool calls, a checklist on the card, and Approve/Deny buttons |
| Best for | Getting the full Claude CLI: your settings, slash commands, skills, and plugins | Watching progress at a glance and reviewing many cards quickly |
| Replying | Type into the terminal | The reply box under the transcript |
| Platforms | macOS and Linux | All |

If your `claude` is not on your login shell's `PATH`, set **Claude CLI path** in Settings.

### Running a card

Open the card and click **Run** (⌘⇧R), or right-click it on the board and pick **Run**. If the prompt has variables, you fill them in first.

Sessions run in a background **session daemon**, not in the window. You can close the card, switch boards, or quit the app, and the agent keeps working. When you come back, the card reconnects to it.

### Session status

The badge on a card tells you what its agent is doing:

| Status | Meaning |
| --- | --- |
| Working (spinning) | The agent is mid-turn. |
| Waiting on input | The agent asked a question or needs a tool approved. Open the card. |
| Done | The turn finished. Review and reply, or ship. |
| Failed | The turn ended with an error, shown in the transcript. |
| Interrupted | The turn stopped before finishing. Reply or Run again to continue. |
| Disconnected | The app lost the session. Re-connect (⌘⇧R) to continue. |
| Background | A command the agent started in the background is still running. |
| Paused | You parked this card. |

You get a chime and a desktop notification when a card finishes or needs input. Clicking the notification opens the card.

### Talking to the agent (Built-in engine)

- **Reply**: type in the box under the transcript and press Enter (Shift+Enter adds a new line). You can attach images to a reply.
- **Stop** ends the current turn.
- **Approve / Deny**: in *Ask every time* mode, each tool call waits for you. You cannot send a reply while a request is pending.
- **Questions**: when the agent asks you a multiple-choice question, it shows as a form in the transcript. Pick an answer and submit.
- **Run again** starts a fresh conversation from the card's prompt. It does not continue the old one.

### Tool approval

| Mode | Behavior |
| --- | --- |
| Ask every time | Every tool call (reading, editing, running commands) waits for your Approve or Deny. The safest mode, and the slowest. |
| Smart auto | Matches the Claude CLI's Auto Mode. A hosted classifier approves or denies almost every action, including edits, commands, and network access. You are trusting the classifier's judgment. |

Start with *Ask every time* to learn what agents do. Switch to *Smart auto* when you want cards to run unattended.

### Models

Choose Opus, Sonnet, Haiku, Fable, or a custom model ID. Set a default in Settings and override it per card. Use a cheaper model for routine cards and a stronger one for hard ones. The cost shows up on the card and in the Spend dashboard either way.

### Cost tracking

- Each card shows what its sessions have cost.
- Each board header shows the board total. Hover for the breakdown.
- **Spend** shows daily spend for the board over any date range.

---

## 6. Worktrees and Ship

This is what lets you run many agents against one repo safely.

### Why worktrees

Without worktrees, every card edits your real checkout, so two running cards trip over each other. With **Run cards in git worktrees** on (globally or per card), each run gets its own git worktree on a branch named `kanban/<card-id>`. Your main checkout stays untouched until you decide to ship.

A badge on the card shows when it has a worktree.

### Shipping

When you are happy with a card's work, click **Ship** in the card view. Ship merges the card's branch into a branch in your real checkout:

- If your checkout is still on the branch the card started from, Ship merges straight into it.
- If you have switched branches since, Ship asks which branch to merge into.
- If several cards ship at once, they queue and merge one at a time. The card shows what it is waiting behind.
- Ship waits until Claude finishes its current turn.

**Merge conflicts** are resolved inside the card's worktree, not in your checkout. The agent gets a conflict-resolution prompt, fixes the files, and the app commits the result. You can edit that prompt per board. If the agent cannot resolve the conflict after two tries, the merge is abandoned and your branch is left as it was.

Ship merges locally. **It does not push.** Push when you are ready.

After shipping, the button becomes **Delete worktree**. Moving a card to a done list can also offer to delete its worktree (Settings → *Offer to delete the worktree when a card is done*). Anything you have not shipped is lost when the worktree is deleted.

---

## 7. Build status

If the GitHub CLI is installed and signed in, cards show the CI status of their work:

- **Open PR**: if the card's branch has a pull request, the card shows its checks.
- **Shipped and pushed**: after you ship and push, the card follows the CI run for that commit on the target branch.

| Badge | Meaning |
| --- | --- |
| Not pushed yet | Shipped locally, so push to start a build. |
| Waiting for a build / checks | Pushed, but nothing has started yet. |
| Build running | Checks are in progress. |
| Build passed | Every check passed. |
| Build failed | At least one check failed. Hover to see which. |
| No builds ran | Pushed, but no workflow matched this commit. |

Click the badge to open the PR or run on GitHub. You are notified on the first failure and when everything passes. If `gh` is missing or signed out, a banner says build status is paused, with a **Retry** button.

---

## 8. General terminals

**Terminals** (⌘⇧T) opens plain shell tabs that belong to the board, not to a card. Use them for running the dev server, tests, or git commands next to your agents. Each tab remembers its directory across restarts.

| Shortcut | Action |
| --- | --- |
| ⌘T | New tab |
| ⌘1–9 | Jump to a tab |
| ⌘⌥← / ⌘⌥→ | Previous / next tab |
| ⌘W | Hide terminals |
| ⌘F | Find in the terminal |

---

## 9. Settings reference

Open with ⌘⇧S.

| Section | Settings |
| --- | --- |
| Data file | Move the file, back it up, open another, recent files. |
| Agent sessions | Session engine, Claude CLI path, tool approval, default model, worktrees, worktree cleanup on done, notification sounds, daemon status, close idle terminals, restart daemon. |
| Tags | Rename tags and change their colors. |
| Boards | Edit boards and unarchive them. |
| Prompt / Comment snippets | Your `/trigger` library. |

**Restart Daemon** fixes a card whose session looks stuck. It interrupts in-progress work, and cards reconnect once the new daemon starts. Open terminals are closed.

---

## 10. Keyboard shortcuts

Press **⌘?** in the app for the live list. On Windows and Linux, use Ctrl where this says ⌘.

**General**

| Shortcut | Action |
| --- | --- |
| ⌘N | New card |
| ⌘⌥N | New prompt from anywhere |
| ⌘K | Search cards |
| ⌘B | Toggle sidebar |
| ⌘⌥↑ / ⌘⌥↓ | Switch board |
| ⌘⇧P | Board scratchpad |
| ⌘⇧S | Settings |
| ⌘Z / ⌘⇧Z | Undo / redo |
| ⌘⏎ | Save card |
| ⌘? | Show shortcuts |

**While viewing a card**

| Shortcut | Action |
| --- | --- |
| ⌘E | Edit card |
| ⌘⇧R | Run, or re-connect |
| ⌘C | Copy prompt |
| ⌘J | Show or hide comments |
| ⌘A | Archive or restore |
| ⌘W | Close a terminal card |

---

## 11. Tips for working well

- **One outcome per card.** "Add rate limiting to the login endpoint" beats "improve auth".
- **Put the acceptance criteria in the prompt.** Say which tests should pass, which files are off limits, and what done looks like. The agent cannot read your mind, and your reviews get faster.
- **Turn repeat work into templates.** A card with `{{variables}}` plus a few snippets covers most recurring tasks. Keep a "Templates" list and copy from it.
- **Use Notes to learn.** Write down what worked and what didn't on the card. Next time, improve the prompt before you run it again.
- **Parallelize with worktrees, then ship one at a time.** Run several independent cards, then ship them in order. The ship queue handles collisions.
- **Use Run again instead of arguing.** If a session went down the wrong path, edit the prompt and run fresh. That is often cheaper than steering it back.
- **Watch the Spend dashboard.** If a kind of card is always expensive, try a smaller model for it or split it.
- **Capture first, triage later.** Use ⌘⌥N for ideas as they come. Use priority, tags, and color when you plan.

---

## 12. Data, privacy, and troubleshooting

### Where your data lives

| What | Where |
| --- | --- |
| Board file | The path you chose. Default: `~/Documents/ai-kanban/kanban.json` |
| Card images | `kanban.assets/` next to the board file |
| App settings, daemon, usage ledger, worktrees | The app's user-data folder |

The user-data folder is `~/Library/Application Support/ai-kanban` on macOS, `%APPDATA%\ai-kanban` on Windows, and `~/.config/ai-kanban` on Linux.

The board file is readable JSON, and the app writes it safely: it writes a temp file and renames it into place. If you edit the file in another program, the app asks whether to reload it or keep the copy you have open. It never overwrites a file it could not parse. A file written by a newer version of the app will not open in an older one.

Prompts you **run** go to Claude through your own Claude Code sign-in, under your own account's terms. The app itself sends nothing anywhere else.

### Troubleshooting

| Problem | Try |
| --- | --- |
| A card looks stuck | Re-connect (⌘⇧R). If that fails, Settings → Restart Daemon. |
| Terminal engine can't find `claude` | Set Settings → Claude CLI path. |
| "Build status paused" banner | Run `gh auth login`, then click Retry. |
| Ship says "Nothing to ship" | The agent made no commits in its worktree. |
| Ship says the original branch is gone | Check out a branch in your repo, then ship again. |
| Agents keep running after quitting | That is by design: the daemon outlives the window. Use Restart Daemon, or stop it from the command line (see the README). |

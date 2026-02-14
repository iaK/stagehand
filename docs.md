# Stagehand

**AI Development Workflow Orchestrator**

Stagehand is a Mac desktop application that structures AI-assisted software development into configurable workflow stages. Instead of ad-hoc prompting, tasks flow through a repeatable pipeline — Research, Approaches, Planning, Implementation, Security Review, PR Preparation — with each stage powered by Claude Code CLI, streaming output in real time, and requiring explicit developer approval before advancing.

---

## The Problem

Modern AI-assisted development suffers from a structural gap. Developers interact with AI through freeform conversations — copy-pasting context, re-explaining decisions, losing track of what was reviewed and what wasn't. The result is inconsistent quality, skipped security checks, and no audit trail.

Specifically:

- **No repeatable process.** Every task starts from scratch. There's no enforced sequence of research-before-implementation or security-review-before-merge.
- **Context gets lost.** Output from one AI interaction doesn't automatically feed into the next. Developers manually shuttle information between prompts.
- **No approval gates.** AI output goes directly into code without structured review points. There's no mechanism to require that a security checklist is fully reviewed before proceeding.
- **No history.** Previous attempts, alternative approaches considered, and the reasoning behind decisions disappear after the conversation ends.
- **Tool access is uncontrolled.** AI assistants either have full tool access or none. There's no way to give the research stage read-only access while giving the implementation stage full write access.

## The Solution

Stagehand replaces ad-hoc AI prompting with a structured pipeline. Each task moves through defined stages, each with its own prompt template, tool permissions, output format, and approval gate. The developer controls progression — approving results, choosing between approaches, reviewing checklists, or requesting redos with feedback.

Key properties:

- **Pipeline model.** Tasks progress linearly through stages. Each stage has a specific purpose, prompt template, and expected output format.
- **Approval gates.** Every stage requires explicit developer action before advancing. Gates are type-specific: simple approval for text, selection for options, checkbox completion for checklists, field validation for structured output.
- **Context continuity.** Output from each stage automatically feeds into the next stage's prompt via template variables. Redo attempts preserve Claude Code's conversation history via `--session-id`.
- **Controlled tool access.** Each stage defines which Claude Code tools are available. Research gets read-only access. Implementation gets full access. Security review goes back to read-only.
- **Persistent history.** Every execution attempt is stored in SQLite — the rendered prompt, raw output, parsed result, user decision, timestamps, and session ID.
- **No API costs.** Stagehand uses Claude Code CLI (`claude -p`), which runs against your existing Claude subscription. No separate API keys or billing.

---

## How It Works

### Workflow

1. **Create a project** — point Stagehand at a local directory. Seven default stages are created automatically.
2. **Create a task** — describe what needs to be done.
3. **Run the first stage** — Stagehand renders the prompt template with your task description, spawns Claude Code, and streams output to the terminal panel.
4. **Review and approve** — the output appears in a format-specific renderer (markdown, option cards, checklist, or form fields). Approve to advance, or redo with feedback.
5. **Repeat** — each subsequent stage receives the previous stage's approved output as context. The pipeline advances until all stages are complete.

### Default Pipeline

| # | Stage | Input | Output Format | Gate Rule | Tool Access |
|---|-------|-------|---------------|-----------|-------------|
| 1 | **Research** | User description | Markdown text | Approve | Read, Glob, Grep, WebSearch, WebFetch |
| 2 | **High-Level Approaches** | Research output | Selectable option cards | Select one | Read, Glob, Grep |
| 3 | **Planning** | Selected approach | Markdown text | Approve | Read, Glob, Grep |
| 4 | **Implementation** | Plan | Markdown text | Approve | All tools |
| 5 | **Refinement** | Implementation + user feedback | Markdown text | Approve | All tools |
| 6 | **Security Review** | Refinement output | Severity-colored checklist | Check all items | Read, Glob, Grep |
| 7 | **PR Preparation** | Review output | Editable form (title, description, test plan) | Fill required fields | Read, Glob, Grep |

Every aspect of every stage is editable — prompt templates, output formats, gate rules, tool permissions, and stage ordering.

---

## Architecture

### Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop framework | Tauri 2.0 (Rust) | Native performance, small binary, system-level process control |
| Frontend | React 19 + TypeScript | Component model, type safety |
| Styling | Tailwind CSS 4 (Vite plugin) | Utility-first, dark theme |
| State management | Zustand | Minimal boilerplate, no providers |
| Database | SQLite (via tauri-plugin-sql) | Embedded, no server, per-project isolation |
| AI backend | Claude Code CLI (`claude -p`) | Uses existing subscription, no API costs |
| Process management | Tokio (async Rust) | Full control over spawn/stream/kill lifecycle |
| IPC streaming | Tauri Channels | Ordered, fast, tied to specific invocation |

### Why These Choices

**Claude Code CLI over API.** The CLI handles authentication, tool execution, and conversation management. Using it means Stagehand doesn't need API keys, doesn't incur per-token costs beyond the existing subscription, and gets all of Claude Code's built-in tools (file read/write, shell execution, web search) for free.

**Tauri over Electron.** Tauri produces smaller binaries, uses less memory, and gives direct access to Rust's `tokio::process` for spawning and managing child processes — critical for streaming Claude Code's output in real time.

**SQLite per project.** Each project gets its own database file (`~/.devflow/data/{project_id}.db`). This provides complete isolation, makes backup/migration trivial (copy a file), and eliminates the need for a database server.

**Zustand over Redux/Context.** Three small stores (project, task, process) with no boilerplate. Actions are async functions that call repositories directly.

**Pipeline model over kanban/chat.** A linear pipeline enforces sequencing (research before implementation), makes approval gates natural, and uses screen space efficiently for single-task focus.

---

## Data Model

### Storage Layout

```
~/.devflow/
├── app.db                    # Project registry
└── data/
    ├── {project_id_1}.db     # Tasks, stage templates, executions
    └── {project_id_2}.db
```

### Entity Relationships

```
Project (app.db)
  └── has many StageTemplates (project.db)
  └── has many Tasks (project.db)
       └── has many StageExecutions (project.db)
            └── references StageTemplate
```

### Projects Table (app.db)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| name | TEXT | Display name |
| path | TEXT | Filesystem path to project directory |
| created_at | TEXT | ISO 8601 timestamp |
| updated_at | TEXT | ISO 8601 timestamp |

### Stage Templates Table (project.db)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT | Owner project |
| name | TEXT | Display name (e.g., "Research") |
| description | TEXT | Purpose description |
| sort_order | INTEGER | Pipeline position (0-indexed) |
| prompt_template | TEXT | Template with `{{variable}}` placeholders |
| input_source | TEXT | `"user"` / `"previous_stage"` / `"both"` |
| output_format | TEXT | `"text"` / `"options"` / `"checklist"` / `"structured"` |
| output_schema | TEXT? | JSON Schema for structured/options formats |
| gate_rules | TEXT | JSON-serialized gate rule |
| persona_name | TEXT? | Custom AI persona name (v2) |
| persona_system_prompt | TEXT? | Custom system prompt (v2) |
| persona_model | TEXT? | Model override (v2) |
| preparation_prompt | TEXT? | Pre-execution refinement prompt (v2) |
| allowed_tools | TEXT? | JSON array of permitted Claude Code tools |
| created_at | TEXT | ISO 8601 timestamp |
| updated_at | TEXT | ISO 8601 timestamp |

### Tasks Table (project.db)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT | Owner project |
| title | TEXT | Short task name |
| description | TEXT | Detailed description for prompts |
| current_stage_id | TEXT? | Active stage template ID |
| status | TEXT | `"pending"` / `"in_progress"` / `"completed"` / `"failed"` |
| created_at | TEXT | ISO 8601 timestamp |
| updated_at | TEXT | ISO 8601 timestamp |

### Stage Executions Table (project.db)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| task_id | TEXT FK | Parent task |
| stage_template_id | TEXT FK | Which stage was executed |
| attempt_number | INTEGER | 1-indexed retry counter |
| status | TEXT | `"pending"` / `"running"` / `"awaiting_user"` / `"approved"` / `"failed"` |
| input_prompt | TEXT | Fully rendered prompt sent to Claude |
| raw_output | TEXT? | Complete stdout from Claude process |
| parsed_output | TEXT? | Extracted/cleaned result text or JSON |
| user_decision | TEXT? | JSON-serialized user approval/selection |
| session_id | TEXT? | Claude Code session ID for conversation continuity |
| error_message | TEXT? | Error details if status is "failed" |
| started_at | TEXT | Execution start time |
| completed_at | TEXT? | Execution end time |

---

## Prompt Template System

Each stage has a prompt template with variable substitution and conditional blocks.

### Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `{{task_description}}` | Task.description | The developer's task description |
| `{{previous_output}}` | Previous stage's parsed_output | Approved output from the prior stage |
| `{{user_input}}` | User text input | Additional context entered by the developer |
| `{{user_decision}}` | Previous stage's user_decision | The developer's selection/approval from the prior stage |

### Conditional Blocks

```
{{#if user_input}}
Additional context from the developer:
{{user_input}}
{{/if}}
```

Blocks are removed entirely when the variable is empty or undefined.

### Example: Research Stage Template

```
You are a senior software engineer researching a task.
Analyze the following task thoroughly.

Task: {{task_description}}

{{#if user_input}}
Additional context from the developer:
{{user_input}}
{{/if}}

Provide a comprehensive analysis including:
1. Understanding of the problem
2. Key technical considerations
3. Relevant existing code/patterns to be aware of
4. Potential challenges and risks
5. Questions that should be answered before proceeding
```

---

## Gate Rules

Gates control when a stage can be approved and the pipeline can advance.

### Types

| Gate | Behavior | Use Case |
|------|----------|----------|
| `require_approval` | Developer clicks "Approve & Continue" | Text output stages |
| `require_selection` | Developer selects min..max options from a list | Approach selection |
| `require_all_checked` | All checklist items must be checked | Security review |
| `require_fields` | Named fields must be non-empty | PR preparation |

### JSON Format

```json
// Simple approval
{"type": "require_approval"}

// Select exactly one option
{"type": "require_selection", "min": 1, "max": 1}

// All items must be reviewed
{"type": "require_all_checked"}

// Title and description are required
{"type": "require_fields", "fields": ["title", "description"]}
```

---

## Output Renderers

Each output format has a dedicated React component.

### Text (`TextOutput`)

Renders markdown with GitHub Flavored Markdown support (tables, strikethrough, task lists, autolinks) using `react-markdown` and `remark-gfm`. Styled with Tailwind's prose classes in dark theme.

### Options (`OptionsOutput`)

Displays option cards with:
- Title and description
- Pros list (green)
- Cons list (red)
- Click-to-select (single selection enforced)
- "Select Approach" button disabled until a selection is made

### Checklist (`ChecklistOutput`)

Displays items with:
- Severity badges: critical (red), warning (amber), info (blue)
- Checkbox per item
- Notes input field per item
- "All Items Reviewed" button disabled until every item is checked

### Structured (`StructuredOutput`)

Displays an editable form:
- Auto-generates labels from field keys (underscores → spaces, title case)
- Short values → text input, long values → textarea
- Required fields marked with red asterisk
- "Approve & Continue" disabled until required fields are filled

---

## Process Management

### Claude Code CLI Flags

| Flag | Purpose |
|------|---------|
| `-p "<prompt>"` | Non-interactive mode |
| `--output-format stream-json` | Real-time NDJSON streaming |
| `--session-id <uuid>` | Conversation continuity across retries |
| `--append-system-prompt "<text>"` | Stage/persona instructions |
| `--json-schema '<schema>'` | Enforce structured output |
| `--no-session-persistence` | Throwaway executions |
| `--allowedTools "Read" "Glob" ...` | Per-stage tool restrictions |
| `.current_dir(path)` | Run in project directory |

### Process Lifecycle

```
spawn claude CLI
  → register kill channel in ProcessManager
  → spawn stdout reader task (streams lines via Tauri Channel)
  → spawn stderr reader task (streams lines via Tauri Channel)
  → wait task: select! { child.wait() | kill_rx }
  → send Completed event
  → remove from ProcessManager
```

### Stream Event Types

```typescript
type ClaudeStreamEvent =
  | { type: "started"; process_id: string; session_id: string | null }
  | { type: "stdout_line"; line: string }
  | { type: "stderr_line"; line: string }
  | { type: "completed"; process_id: string; exit_code: number | null }
  | { type: "error"; process_id: string; message: string };
```

The frontend parses stdout lines as NDJSON, extracting text from Claude's stream-json format:
- `{type: "assistant", message: {content: [{type: "text", text: "..."}]}}` — incremental output
- `{type: "result", result: "..."}` — final result
- `{type: "content_block_delta", delta: {text: "..."}}` — streaming deltas

---

## Session Continuity

When a developer redoes a stage, Stagehand reuses the same `--session-id`. This means Claude Code retains the full conversation history from previous attempts, enabling multi-turn refinement:

1. **First attempt:** New session ID generated. Claude sees the prompt cold.
2. **Redo with feedback:** Same session ID. Claude sees its previous response plus the developer's feedback, enabling it to iterate rather than start over.
3. **Subsequent redos:** Same session ID. Full conversation history accumulates.

The `attempt_number` field tracks how many times a stage has been run. All attempts are stored in the database.

---

## Project Structure

```
stagehand/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── src/
│   ├── main.tsx                          # React entry point
│   ├── App.tsx                           # Root component, Claude availability check
│   ├── index.css                         # Tailwind import
│   ├── vite-env.d.ts
│   ├── lib/
│   │   ├── types.ts                      # All TypeScript interfaces and type unions
│   │   ├── db.ts                         # SQLite connections and schema initialization
│   │   ├── repositories.ts              # CRUD functions for all entities
│   │   ├── seed.ts                       # Default stage template definitions
│   │   ├── claude.ts                     # Frontend bindings for Claude process commands
│   │   └── prompt.ts                     # Template variable substitution engine
│   ├── stores/
│   │   ├── projectStore.ts              # Project list and active project state
│   │   ├── taskStore.ts                 # Tasks, templates, executions state
│   │   └── processStore.ts             # Terminal output and running process state
│   ├── hooks/
│   │   ├── useStageExecution.ts         # Core orchestration: run, approve, redo, kill
│   │   └── useKeyboardShortcuts.ts      # Cmd+N (new task), Cmd+Enter (run stage)
│   └── components/
│       ├── layout/
│       │   ├── Layout.tsx               # Root layout: sidebar + pipeline + terminal
│       │   └── Sidebar.tsx              # Project selector, task list, settings
│       ├── pipeline/
│       │   ├── PipelineView.tsx         # Stepper + stage content container
│       │   ├── PipelineStepper.tsx      # Horizontal stage progress indicator
│       │   ├── StageView.tsx            # Stage executor: input, actions, output
│       │   ├── StageOutput.tsx          # Output format dispatcher
│       │   ├── StageHistory.tsx         # Collapsible completed stages panel
│       │   └── TerminalView.tsx         # Live process output with auto-scroll
│       ├── output/
│       │   ├── TextOutput.tsx           # Markdown renderer
│       │   ├── OptionsOutput.tsx        # Selectable approach cards
│       │   ├── ChecklistOutput.tsx      # Severity-colored checklist
│       │   └── StructuredOutput.tsx     # Editable form fields
│       ├── task/
│       │   ├── TaskList.tsx             # Task sidebar items
│       │   └── TaskCreate.tsx           # New task modal
│       └── project/
│           ├── ProjectCreate.tsx        # New project modal with directory picker
│           └── StageTemplateEditor.tsx  # Edit prompt templates and stage config
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/
    │   └── default.json                 # Tauri permission grants
    └── src/
        ├── main.rs                      # Rust entry point
        ├── lib.rs                       # Tauri app setup, plugin registration, commands
        ├── events.rs                    # ClaudeStreamEvent enum (serde-tagged)
        ├── process_manager.rs           # Arc<Mutex<HashMap>> process registry
        └── commands/
            ├── mod.rs
            └── process.rs               # spawn_claude, kill_process, list_processes, check_claude_available
```

---

## UI Design

### Layout

The interface is a three-panel layout with a dark theme (zinc-950 background):

- **Left sidebar** (256px fixed) — Project dropdown selector, task list with status dots, "Stage Templates" settings link.
- **Main area** (flexible) — Pipeline stepper at top showing all stages as colored pills connected by lines. Below that, the active stage's content: input area, action buttons, and output renderer.
- **Bottom terminal** (192px, collapsible) — Monospace output stream with color-coded lines. Green pulsing dot when a process is running. Auto-expands when a process starts.
- **Right panel** (320px, toggleable) — Completed stage outputs for reference during later stages.

### Color System

| Element | Color | Tailwind Class |
|---------|-------|----------------|
| Background | Near-black | zinc-950 |
| Sidebar | Dark gray | zinc-900 |
| Borders | Subtle gray | zinc-800 |
| Primary text | White | zinc-100 |
| Secondary text | Gray | zinc-400/500 |
| Primary action | Blue | blue-600 |
| Success / Approved | Green | emerald-500 |
| Warning / Awaiting | Amber | amber-500 |
| Error / Critical | Red | red-500 |
| Running indicator | Blue pulse | blue-400 animate-pulse |

### Stage Status Indicators

The pipeline stepper shows each stage as a pill with a numbered circle:

- **Completed** — Green background, white checkmark icon
- **Running** — Blue background, pulsing animation
- **Awaiting user** — Amber background
- **Current** — Gray background, white number
- **Future** — Dark background, muted number

---

## Running the App

### Prerequisites

- **macOS** (Tauri desktop target)
- **Node.js** 18+ and npm
- **Rust** toolchain (via rustup)
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)

### Development

```bash
cd /Users/i/Projects/stagehand
npm run tauri dev
```

This starts the Vite dev server on port 1420 and opens the Tauri window with hot module replacement.

### Production Build

```bash
npm run tauri build
```

Produces a native `.app` bundle at `src-tauri/target/release/bundle/macos/stagehand.app`.

### Runtime Data

On first project creation, Stagehand creates:

```
~/.devflow/
├── app.db          # Created on first getAppDb() call
└── data/           # Created in Tauri setup hook
    └── *.db        # Created per-project
```

---

## Extending Stagehand

### Adding a New Stage

Edit the stage templates through the UI (Sidebar → Stage Templates), or modify `src/lib/seed.ts` to change the defaults for new projects. Key fields to configure:

- **prompt_template** — Use `{{task_description}}`, `{{previous_output}}`, `{{user_input}}`, `{{user_decision}}` variables.
- **input_source** — Set to `"user"` if the stage needs direct developer input, `"previous_stage"` if it only needs prior output, or `"both"` for refinement stages.
- **output_format** — Choose the renderer: `"text"` for markdown, `"options"` for approach selection, `"checklist"` for review items, `"structured"` for form fields.
- **gate_rules** — JSON defining what the developer must do before advancing.
- **allowed_tools** — JSON array of Claude Code tool names. Set to `null` for unrestricted access.

### Adding a New Output Format

1. Create a new component in `src/components/output/`.
2. Add the format string to the `OutputFormat` type in `src/lib/types.ts`.
3. Add a case to the switch in `src/components/pipeline/StageOutput.tsx`.

### Custom Tool Restrictions

Each stage's `allowed_tools` field accepts a JSON array of Claude Code tool names:

```json
["Read", "Glob", "Grep"]           // Read-only access
["Read", "Glob", "Grep", "Write", "Edit", "Bash"]  // Full access
null                                // Unrestricted (all tools)
```

---

## Future Work

Architecture-ready but not yet wired in the UI:

- **Persona support** — `persona_name`, `persona_system_prompt`, `persona_model` columns exist on stage templates. These map to `--append-system-prompt` and could support different AI personas per stage.
- **Preparation agents** — `preparation_prompt` column exists. This would run a quick `claude -p --output-format json --no-session-persistence` call to refine inputs before the main stage execution.
- **Output schema validation** — `output_schema` column stores JSON Schema. Currently used to pass `--json-schema` to Claude but not validated on the frontend.

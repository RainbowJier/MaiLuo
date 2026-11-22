# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MaiLuo** (脉络) is an Electron desktop tool for visualizing Vue + Spring Boot application request chains. Select a Vue component → tool analyzes the complete call path: Vue event → API wrapper → HTTP request → Controller → Service → Repository → SQL, displaying it as an interactive chain graph.

**Core design**: Analyze full request chains end-to-end from the user's perspective (what happens when they click a button), not by technical layer decomposition.

## Development Commands

```bash
# Install dependencies (Node.js 20+; requires 'claude' CLI installed locally)
npm install

# Development mode (Vite HMR for renderer + Electron main process reload)
npm run dev

# Build to out/ (transpiles main/preload/renderer, generates app binary)
npm run build

# Run the built binary
npm run preview

# Smoke test (sanity check for build artifacts)
npm run smoke
```

**Prerequisites**: 
- Node.js 20+
- Local `claude` CLI installed and authenticated (`claude --version` must work)
- Electron 33 (declared in package.json)

## Architecture

### High-Level Flow

1. **User Input**: Select a Vue menu (component) in the sidebar; each menu owns exactly one session
2. **Native Terminal**: Main process spawns the local `claude` TUI in a PTY (node-pty/ConPTY) with
   `--session-id <uuid> --dangerously-skip-permissions`, rendered in xterm.js — slash commands,
   `/model`, keybindings are all native Claude Code
3. **Analysis Trigger**: "分析" injects the analysis prompt into the TUI (bracketed paste so
   multi-line text does not submit early)
4. **Side-channel Extraction**: terminal-host tails `~/.claude/projects/<munged-cwd>/<session-id>.jsonl`,
   waits for the assistant `end_turn` after injection, extracts the ```json contract
5. **Rendering**: Renderer displays chain graph (ECharts), tabs for each function, side panels with details

### Directory Structure

```
electron/
  main/
    index.mjs         Window lifecycle, IPC handlers, dev eval harness, session management
    analyzer.mjs      Prompt building, JSON extraction/normalization
    terminal-host.mjs PTY host: native claude TUI + session-jsonl watcher + analysis orchestration
    project.mjs       Project root detection, Vue file scanning, backend directory inference
    persist.mjs       JSON file read/write for config, sessions, layouts
  preload/
    index.mjs         contextBridge API exposed to renderer

src/
  main.js             Vite entry point, Vue app bootstrap
  App.vue             Three-pane layout: Sidebar | DetailPanel | AgentTerminal
  store.js            Global state (sessions, active chain, analysis progress, layouts)
  session-key.js      Per-component session identity (canonicalize/merge on load)
  chain.js            Data model normalization, color mapping by node type
  components/
    Sidebar.vue       Project cards, grouped component menus, project settings
    ChainCard.vue     Collapsible function details (parameters, logic points, branches)
    ChainGraph.vue    ECharts graph visualization with layout persistence
    DetailPanel.vue   Center pane showing full chain data for selected function
    AgentTerminal.vue Native terminal shell (current-menu name, status, analyze button)
    ClaudeTerminal.vue xterm.js embed of the native claude TUI (one PTY per active menu)
    ConfigModal.vue   Project root + backend path editor

.verify/              Development utilities
  eval.js            Write here to execute arbitrary code in renderer (outputs to eval.out)
  renderer.log       Console logs, errors from renderer + preload
  gh-create.mjs      GitHub release automation helper
  smoke.mjs          Post-build sanity checks

samples/demo-app/    Reference Vue + Spring Boot project for testing

SCHEMA.md             Complete JSON data model spec (chains/nodes/edges/branches/transactions)
```

## Key Concepts

### Chain
A complete request path from Vue event to database/external service. Contains:
- **id**: Unique identifier (e.g., `order_create`)
- **name**: Chinese name (e.g., `创建订单`)
- **method/url**: HTTP verb + endpoint
- **frontendAnchor**: Exact source locations in Vue (template selector + script method + API wrapper)
- **nodes**: List of execution points (Vue event → API → HTTP → Controller → Service → Repository → SQL)
- **edges**: Function calls and data flow between nodes
- **branches**: Conditional logic (validation failures, exception handlers)
- **transactions**: @Transactional boundaries with operation lists

### Node Types
- **vue-event**: Vue component event handler (@click, onMounted, etc.)
- **api-wrapper**: API encapsulation layer (api/xxx.js functions)
- **http-request**: HTTP boundary marker (method + path)
- **controller**: Spring @PostMapping/@GetMapping methods
- **service**: Service layer business logic
- **validator**: Validation before business logic
- **repository**: Data access (JPA, Mybatis)
- **sql**: Raw SQL operations (INSERT, UPDATE, SELECT)
- **exception**: Exception nodes in error branches
- **external-service**: Third-party service calls

### Edge Types
- **function-call**: Synchronous function invocation
- **http-request**: HTTP request boundary
- **service-call**: Dependency injection service method call
- **db-query**: Repository → SQL via ORM
- **method-call**: General method invocation

### Branch
Represents conditional logic at a node (validation, business rules, permission checks). Each branch has **paths** (success/failure) with:
- **condition**: Logical description or code snippet
- **nextNode**: Target node ID if condition is true/false
- **exception** (on failure): Exception type, HTTP status, message

### Transaction
@Transactional boundaries within a chain:
- **startNode/endNode**: First/last node in transaction scope
- **operations**: List of SQL operations (type, table, SQL text)
- **isolationLevel**, **propagation**: Spring transaction attributes

## Analysis Process (Main → Renderer)

1. **Prompt Assembly** (`analyzer.mjs::buildPrompt`)
   - Includes component file + backend search path + JSON schema
   - Instructs Claude to trace from Vue events through complete backend

2. **Terminal Host** (`terminal-host.mjs::createTerminalHost`)
   - One live PTY at a time; switching menus stops it and relaunches with the same
     `--session-id` so the native conversation resumes
   - Analysis injects the prompt via bracketed paste (multi-line safe), highest permission

3. **Session Log Watcher** (`terminal-host.mjs`)
   - Polls `~/.claude/projects/<munged-cwd>/<session-id>.jsonl` for appended bytes
   - Settles when an assistant line has `stop_reason === 'end_turn'` and the file goes idle

4. **JSON Extraction & Normalization** (`analyzer.mjs::extractJson`, `chain.js`)
   - Try multiple code blocks (from last to first)
   - Fallback to bare JSON with brace-matching
   - Validate against schema (functions array, required fields)
   - Normalize positions (position.x/y for graph layout)
   - Assign colors by node type
   - Compute statistics (node count, depth, branches, transactions)

5. **Renderer Display**
   - Store normalized chain in Vuex
   - Render tabs for each function in component
   - Display graph using ECharts with saved or auto-computed layout
   - Show details panel on node selection

## Data Persistence

All state saved to `app.userData` directory (Windows: `%APPDATA%\MaiLuo`):

- **config.json**: Project cards (paths, detected backend/frontend subdirs)
- **sessions.json**: Per-component analysis results (chains JSON, metadata)
- **layouts.json**: ECharts node positions per chain (to preserve user arrangement)

On app startup, if old `%APPDATA%\spring-chain-view` exists, migrate these files to new location.

## Important Flows

### Analyzing a Component
1. User clicks "分析" (terminal header) or "开始分析" (detail panel) with a Vue menu active
2. Renderer ensures the session has a CLI uuid (`s.claudeId`) and the PTY is alive
3. `ipcMain.handle('terminal:analyze')` injects the analysis prompt into the TUI
4. terminal-host extracts the JSON contract from the session jsonl on turn end
5. Result stored in `sessions.json`, UI updated with tabs + graph; user can keep chatting natively

### Session Recovery
- Each Vue menu owns exactly one session (one CLI `--session-id` uuid)
- Switching menus stops the current PTY and relaunches the target session's uuid (conversation resumes)
- Prior analysis results reload from `sessions.json`; `src/session-key.js` canonicalizes/merges on load
- Layout state preserved per chain in `layouts.json`

### Graph Rendering
- `ChainGraph.vue` uses ECharts graph with `layout: 'none'`
- Node positions come from `node.position` in chain JSON (or saved layout)
- Colors assigned by `chain.js::getColorByType(nodeType)`
- Hover shows node signature + source file:line
- Click to focus node in detail panel / open source in IDE (via preload API)

## Deployment

```bash
npm run build
# Outputs: out/main/index.mjs, out/preload/index.mjs, out/renderer/**
# Electron infers entry from package.json "main" field
# Ready to distribute via electron-builder or manual packaging
```

## Key Implementation Details

### Native Terminal Integration
- `node-pty` (rebuilt for Electron; `npm run rebuild:pty`) spawns `claude` with a real ConPTY
- The exe is resolved by `terminal-host.mjs::resolveClaudeExecutable` (claude.exe only, never a .cmd wrapper)
- Launched with `--dangerously-skip-permissions` (analysis must not prompt) and a fixed
  `--session-id <uuid>` stored per component session in sessions.json
- All interaction is native Claude Code: slash commands, `/model`, permission behavior, keybindings
- `ELECTRON_RUN_AS_NODE` is stripped from the child env to avoid PTY regressions
- On Windows, `node-pty`'s gyp requires `SpectreMitigation` disabled (scripts/patch-node-pty.mjs,
  wired as npm postinstall) and the rebuild must drop `NoDefaultCurrentDirectoryInExePath` from env

### ESM in Electron
- Main process + preload use ESM (`.mjs` extensions)
- `scripts/dev.mjs` clears `ELECTRON_RUN_AS_NODE` to prevent regression to Node-only mode
- Renderer uses standard Vue 3 + Vite (bundled to CommonJS/ESM by Vite)

### Error Handling
- Claude analysis failures: retry button, full terminal output shown
- JSON parse failures: attempts multiple code block patterns, shows raw text if all fail
- File I/O errors logged to `.verify/renderer.log` (persisted for debugging)

### UI State Management
- `src/store.js`: Vuex-style state (sessions, active chain, layout)
- Sessions keyed by `{projectRoot}#{file}` to disambiguate same component in different projects
- Layout saved per chain to preserve user's manual node repositioning

## Testing

```bash
# Smoke test checks:
npm run smoke
# - Verifies build artifacts exist
# - Checks preload/main/renderer can be loaded
# - Sanity checks for file structure
```

For manual testing:
1. `npm run dev` → opens Electron window
2. Point to a Vue project (use `samples/demo-app` if available)
3. Select a `.vue` file
4. Click "开始分析"
5. Observe terminal output + final chain graph

## Customization Points

### Adding Node Types
1. Update schema in `SCHEMA.md` (nodeType enum)
2. Add color in `src/chain.js::getColorByType()`
3. Update prompt in `analyzer.mjs::buildPrompt()` with new type description
4. Renderer automatically renders new type (generic shape logic)

### Changing Graph Layout
- Modify ECharts config in `ChainGraph.vue` (force-directed, circular, etc.)
- Layout positions saved per chain in `layouts.json`
- User can manually drag nodes; positions persist on save

### Adding Persistence Fields
- Edit structure in `persist.mjs` read/write functions
- Update corresponding state shape in `store.js`
- Renderer will auto-sync on state change

## Common Workflow for Development

1. **Fixing UI bug**: Edit `.vue` file → `npm run dev` auto-reloads renderer
2. **Fixing main process logic**: Edit `.mjs` → Restart app (`Ctrl+R` in Electron)
3. **Testing Claude analysis**: Use eval harness (write test code to `.verify/eval.js`)
4. **Debugging**: Enable Chrome DevTools (`Ctrl+Shift+I` in dev mode)
5. **Building release**: `npm run build` → outputs to `out/`

## External Dependencies

| Package | Role |
|---------|------|
| **electron** | Desktop shell |
| **vue** | UI framework (renderer layer) |
| **vite** | Build tool, HMR in dev |
| **echarts** | Graph visualization |
| **electron-vite** | Unified config for Electron + Vite |

All production dependencies are minimal by design; heavy analysis work offloaded to Claude CLI subprocess.

## Troubleshooting

- **"claude CLI not found"**: Ensure `claude` is in PATH and `claude --version` works
- **Graph not rendering**: Check JSON in renderer console; look for `position.x/y` or layout normalization errors
- **Preload errors**: Check `.verify/renderer.log` for contextBridge binding issues
- **Analysis hangs**: Claude CLI may be waiting for input; ensure `-p` flag used in spawn call
- **Old config not migrating**: Manual intervention may be needed if paths changed; check userData directory

---

## References

- **SCHEMA.md**: Complete JSON contract specification for analysis output
- **README.md**: User-facing feature overview
- **Electron docs**: https://www.electronjs.org/docs
- **Vue 3 docs**: https://vuejs.org/
- **ECharts graph**: https://echarts.apache.org/en/option.html#series-graph

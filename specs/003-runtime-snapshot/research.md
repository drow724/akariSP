# Research: Runtime Snapshot

Builds on 001 (R1–R9) and 002 (S1–S7). Only new decisions are listed.

## P1. Source of each field (no new bookkeeping)

All five values already exist as closure variables inside `createRuntime` (`src/index.ts`) and
are the ones the scheduler itself reads and writes:

| Snapshot field | Existing authoritative state | Written by |
|---|---|---|
| `state` | `let state` | `acquire` (→ broken), `shutdown` (→ closed) |
| `active` | `let running` | `admit` (`running++`), `release` (`running--`, handoff `running++`) |
| `queued` | `queue.length` (`const queue: Leave[]`) | `admit` (`push`), `onAbort` (`splice`), `release` / `drain` (`shift`) |
| `limit` | `limit` (destructured with default 1) | constructor only |
| `queueCapacity` | `queueCapacity` (default 32) | constructor only |

- **Decision**: `snapshot()` returns `{ state, active: running, queued: queue.length, limit,
  queueCapacity }` built from these variables. No counters, no listeners, no copies are kept.
- **Why `running` equals slot ownership**: `running` is incremented only when a slot is granted
  (`admit`, or the handoff inside `release`) and decremented only in `release`, which `end`
  calls after the task session is destroyed (001 FR-009b / 002 FR-105). The slot ownership rule
  and the counter are the same code.
- **Why `queue.length` equals waiting tasks**: every queue entry is one waiting task's `leave`
  function. Entries are removed on every exit path: start (`release`), abort (`onAbort`), broken
  or closed (`drain`). Rejected submissions are never pushed. Lazy streams push nothing until
  their first pull calls `admit`.
- **Alternatives rejected**: separate `active`/`queued` observability counters (duplicate state
  that could drift from the scheduler; excluded by FR-207).

## P2. Observation consistency (queued → active)

- **Decision**: Rely on the existing synchronous transitions. JavaScript runs `release()` to
  completion without interleaving: `running--`, then (if a waiter exists) `running++` and
  `queue.shift()!()` happen in the same synchronous block. `snapshot()` is also synchronous, so
  it runs either entirely before or entirely after that block and can never see a task counted
  in both or in neither. The same holds for `admit` (check + `running++` or `push`), `onAbort`
  (`splice` + reject), and `drain`.
- **Alternatives rejected**: locks or transaction wrappers (no concurrency exists within one
  JS realm turn; adding them would be pure overhead, Principle IV).

## P3. `RuntimeState` type

- **Finding**: The public declaration today is inline: `readonly state: 'ready' | 'broken' |
  'closed'` in `Runtime`. There is no named `RuntimeState` export. Internally the code already
  uses `Runtime['state']`.
- **Options**:
  - (a) Type the snapshot field as `Runtime['state']`: zero new exports and no duplicated
    literal union; the `.d.ts` shows `state: Runtime['state']`.
  - (b) Export `type RuntimeState = 'ready' | 'broken' | 'closed'` and use it in `Runtime` and
    `RuntimeSnapshot`: one more public name, and a declaration change to `Runtime`.
- **Decision**: (a). It reuses the existing public type without growing the API (Principle XII).
  A named alias can be added later without breaking anyone.

## P4. Return value independence

- **Decision**: A fresh object literal per call, containing only primitives. Mutating it cannot
  reach runtime state, and no two calls share an object. No `Object.freeze`, deep freeze, or
  Proxy.
- **Type**: a new exported `RuntimeSnapshot` interface with plain (non-readonly) fields,
  matching how `TaskResult` is declared.

## P5. Placement

- **Decision**: Add `snapshot()` as a method on the object returned by `createRuntime`, next to
  the `state` getter. It is a one-expression arrow over the closure variables. No refactor of
  `admit`, `release`, `drain`, or `shutdown`.

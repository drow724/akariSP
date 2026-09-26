# Data Model: Named Session Templates

Extends 001–003. Scheduler state (`state`, `running`, `queue`, `closer`, `closing`, `idle`) is
unchanged and shared by all templates.

## Base-session registry (internal)

| Field | Type | Notes |
|---|---|---|
| bases | `Map<string \| undefined, Session>` | Built once in `createRuntime`; never mutated. Key `undefined` = unnamed default template |

**Construction rules**

| `templates` | `session` | Default base? | Named bases | Result |
|---|---|---|---|---|
| absent | absent | yes (`create(undefined)`, today's behavior) | – | ok |
| absent | given | yes | – | ok (today's behavior) |
| `{}` | absent | – | – | `TypeError` before any `create()` |
| `{}` | given | yes | – | ok (same as single-session) |
| `{a, b}` | absent | **no** | a, b | ok; tasks must name a template |
| `{a, b}` | given | yes | a, b | ok; unnamed tasks use the default |

If any `create()` rejects, all bases created so far are destroyed and the original error
propagates.

## Task (delta)

| Field | Notes |
|---|---|
| template | Optional per-task option. Resolved by `pick()` before admission (`run`) or at the first pull before admission (`stream`) |

**Resolution**

| Named? | Found in `bases`? | Outcome |
|---|---|---|
| yes | yes | clone that template's base |
| yes | no | `TypeError('unknown template …')`; nothing consumed |
| no | default exists | clone the default base |
| no | no default | `TypeError('template is required …')`; nothing consumed |

## Lifecycle (unchanged except the clone source)

```text
pick(template) → admit (shared queue/slot) → acquire(base) → prompt / promptStreaming
→ destroy task session → release slot
```

Broken: a clone `InvalidStateError` from any base moves the whole runtime to `broken` (001 rules).
Shutdown: … → `idle` → destroy every base in `bases` once.

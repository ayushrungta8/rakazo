# Durable follow-through

Commitments extend the existing scratchpad. A bot records a user-requested
outcome, next action, waiting state, assignee, optional deadline and review time
using `commitment_track`. The originating run is recorded by the server.
Ordinary scratchpad notes do not automatically become commitments.

The worker claims due items transactionally and creates ordinary recoverable
runs. It skips archived bots, removed members and busy conversations. Completed
and deliberately parked items do not wake a bot. Queue publication failure
leaves a durable queued run for the existing reconciler to recover.

User-waiting items continue daily until resolved or paused. Other items receive
at most three automatic reviews before remaining open without further wakeups.
A direct user turn can reset that budget. Proactive turns have a 16-tool limit,
shared with helpers and bounded by any stricter operator limit. They cannot
create replacement commitments, schedules or bots. Consequential actions require
explicit approval under the unattended action policy.

`commitment_update` reconciles replies and results. Model-driven completion
requires recorded evidence of delivery or explicit cancellation; merely reporting
a blocker is insufficient. Evidence is model-supplied and must still be checked.
Users can complete or park items through existing scratchpad controls. The
current summary remains readable in scratchpad notes on all clients.

Standing bot instructions must require capture before delegation and reconciliation
before answering. Semantic memory provides context; it is not the commitment
ledger. Capture, relevance, evidence quality and notification wording still depend
on the selected model. Old history is never automatically converted to obligations.

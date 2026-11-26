/**
 * Agent roster broadcasting (migration 018) — the ADMIN VISIBILITY layer.
 *
 * The admin panel's live roster is driven by the SAME realtime hub as the
 * member's payment popup: every server-side state transition (shift,
 * presence, accept, call start/end, intake step, doctor pick, payment
 * request, completion, hangup, disconnect/crash, cleanup) publishes an
 * `agent-roster:*` event carrying the agent's FULL roster snapshot, so the
 * board updates live without a refresh and never fabricates anything
 * client-side.
 *
 * Audience: admins + agent supervisors (`hub.publishToRoles`). The snapshot
 * is built from the same SQL the REST board uses (repos/agent-ops.js
 * rosterSnapshot) — one source of truth for the poll and the push.
 *
 * Every fire-and-forget here: a roster broadcast must NEVER break the
 * transition that caused it (the 15s poll is the correctness safety net,
 * exactly like the payment popup's 8s poll under its WS events).
 */
'use strict';

const ops = require('./repos/agent-ops');

const ROSTER_ROLES = ['admin', 'agent_supervisor'];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The agent's current roster row (same shape as GET /api/admin/agents items). */
async function snapshotFor(agentId) {
  return ops.rosterSnapshot(agentId, startOfToday());
}

/** Publish the agent's snapshot to the roster audience. Best-effort. */
function broadcastAgent(hub, agentId) {
  if (!hub || typeof hub.publishToRoles !== 'function') return;
  (async () => {
    const agent = await snapshotFor(agentId);
    if (!agent) return;
    hub.publishToRoles(ROSTER_ROLES, { type: 'agent-roster:update', agent });
  })().catch((err) => {
    console.error('[agent-roster] broadcast failed:', err.code || err.constructor?.name);
  });
}

/** Publish the pending-queue depth (waiting count) to the roster audience. */
function broadcastQueue(hub) {
  if (!hub || typeof hub.publishToRoles !== 'function') return;
  (async () => {
    const queueWaiting = await ops.waitingQueueSize();
    hub.publishToRoles(ROSTER_ROLES, { type: 'agent-roster:queue', queueWaiting });
  })().catch((err) => {
    console.error('[agent-roster] queue broadcast failed:', err.code || err.constructor?.name);
  });
}

/** Broadcast snapshots for MANY agents (sweeps) — serialized to keep the
 *  per-agent query load predictable. */
function broadcastAgents(hub, agentIds) {
  for (const id of agentIds) broadcastAgent(hub, id);
}

module.exports = { snapshotFor, broadcastAgent, broadcastAgents, broadcastQueue, ROSTER_ROLES, startOfToday };

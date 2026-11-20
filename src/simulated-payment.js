/**
 * Shared simulated-payment helpers.
 *
 * Single source of truth for the deterministic SIM- transaction identity used
 * by BOTH self-service simulated payments (routes/consultations.js) and the
 * agent-initiated payment requests (routes/assist.js confirm). The format is
 * a load-bearing contract: tests and reconciliation logic derive the same id
 * from an order id, so it must never change shape.
 */
'use strict';

/** Deterministic simulated transaction id — full encoding (no truncation: a
 *  truncated base64 prefix collides across similar order ids). */
function simulatedTransactionId(orderId) {
  return 'SIM-' + Buffer.from(String(orderId)).toString('base64url');
}

/** Provider-shaped retrieve response for an order created on the simulated
 *  path (always completed — the isolation is the authorization, see
 *  config.simulationAllowed). */
function simulatedRetrieveByOrderId(orderId) {
  return {
    reference: orderId,
    transactionId: simulatedTransactionId(orderId),
    amount: null,
    status: 'completed',
    raw: { simulated: true },
  };
}

module.exports = { simulatedTransactionId, simulatedRetrieveByOrderId };

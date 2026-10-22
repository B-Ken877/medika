/** Realtime module — WebSocket hub (legacy /ws protocol) + optional Redis bus. */
'use strict';

module.exports = {
  attachRealtime: require('./hub').attachRealtime,
  RealtimeHub: require('./hub').RealtimeHub,
  messageEnvelope: require('./hub').messageEnvelope,
  createLocalBus: require('./redis-bus').createLocalBus,
  createRedisBus: require('./redis-bus').createRedisBus,
};

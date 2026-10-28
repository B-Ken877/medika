/** Realtime module — WebSocket hub (legacy /ws protocol) + optional Redis bus
 *  + participant presence (local registry or Redis leases). */
'use strict';

module.exports = {
  attachRealtime: require('./hub').attachRealtime,
  RealtimeHub: require('./hub').RealtimeHub,
  messageEnvelope: require('./hub').messageEnvelope,
  createLocalBus: require('./redis-bus').createLocalBus,
  createRedisBus: require('./redis-bus').createRedisBus,
  createPresence: require('./presence').createPresence,
  createLocalPresence: require('./presence').createLocalPresence,
  createRedisPresence: require('./presence').createRedisPresence,
};

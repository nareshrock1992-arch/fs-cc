import { io } from 'socket.io-client';

// Connect to the current page origin — Nginx (prod) and Vite proxy (dev)
// both forward /socket.io to the backend.
export const socket = io('/', {
  path:              import.meta.env.VITE_SOCKET_PATH || '/socket.io',
  autoConnect:       true,
  reconnection:      true,
  reconnectionDelay: 2000,
  transports:        ['websocket', 'polling'],
});

// Authenticate the socket connection as an agent so the backend
// adds this socket to room agent:{agentId} for targeted events.
// The server only sends call/agent events to authenticated sockets, and room
// membership is lost on every reconnect, so the token is remembered (memory only)
// and re-sent on each (re)connect. Pass null on logout.
let agentToken = null;
export function authenticateAgent(token) {
  const hadToken = agentToken;
  agentToken = token || null;
  if (agentToken && socket.connected) socket.emit('agent:authenticate', { token: agentToken });
  // SEC-5: logout → leave the live-event rooms on this open connection.
  if (!agentToken && hadToken && socket.connected) socket.emit('client:deauthenticate');
}
socket.on('connect', () => {
  if (agentToken) socket.emit('agent:authenticate', { token: agentToken });
});

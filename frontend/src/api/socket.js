import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../hooks/useAuth.js';

// Connect to the same origin as the page — no IP or port needed.
//
// Production: browser is at http://192.168.1.x:8000, so Socket.IO connects
//   to http://192.168.1.x:8000/socket.io, which Nginx proxies → backend:4000.
//
// Dev: browser is at http://localhost:5173, Vite proxies /socket.io → localhost:4000.
//
// Either way, no absolute URL or IP is required in this file.
export const socket = io('/', {
  path:             import.meta.env.VITE_SOCKET_PATH || '/socket.io',
  autoConnect:      true,
  reconnection:     true,
  reconnectionDelay: 2000,
  transports:       ['websocket', 'polling'],
});

// Authenticate as a supervisor so this connection joins the private
// `supervisors` room and receives pre-queue monitor events (which are NOT on the
// global broadcast). Re-sent on every (re)connect. Admin/supervisor tokens are
// accepted server-side; others are simply ignored (no room joined).
function authenticateSupervisor() {
  const token = getToken();
  if (token) socket.emit('supervisor:authenticate', { token });
}
socket.on('connect', authenticateSupervisor);
if (socket.connected) authenticateSupervisor();

export function useSocketEvent(eventName, handler) {
  useEffect(() => {
    socket.on(eventName, handler);
    return () => socket.off(eventName, handler);
  }, [eventName, handler]);
}

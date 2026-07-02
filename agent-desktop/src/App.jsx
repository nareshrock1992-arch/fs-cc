import { useEffect } from 'react';
import { useAgentAuth }     from './hooks/useAgentAuth.js';
import { authenticateAgent } from './api/socket.js';
import Login    from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

export default function App() {
  const auth = useAgentAuth();

  // Authenticate the socket connection whenever we have a valid token
  useEffect(() => {
    if (auth.token) authenticateAgent(auth.token);
  }, [auth.token]);

  if (!auth.isAuthenticated) {
    return <Login onLogin={auth.login} />;
  }

  return <Dashboard auth={auth} />;
}

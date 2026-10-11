import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

const { secret } = config.jwt;

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Passes if the user is admin (implicitly all permissions) OR holds the named permission.
export function requirePermission(permission) {
  return function (req, res, next) {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'Authentication required' });
    if (u.role === 'admin') return next();
    const perms = Array.isArray(u.permissions) ? u.permissions : [];
    if (perms.includes(permission)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

// Explicit permission check for field-level reveals (e.g. full caller ID in the
// pre-queue monitor). Unlike requirePermission(), this does NOT grant admins an
// implicit pass — the permission must be explicitly present in the user's
// permissions list (Option B: least privilege, no admin bypass). Used to decide,
// per authenticated user, whether to reveal sensitive data; never weakens the
// route-level auth that still gates access.
export function hasExplicitPermission(user, permission) {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

// Field-level permission check that mirrors the app's standard authorization
// model: admins implicitly hold every permission, otherwise the permission must
// be explicitly present. Used to decide, per authenticated user, whether to
// reveal sensitive data (e.g. the full caller ID in the pre-queue monitor).
export function hasPermission(user, permission) {
  return user?.role === 'admin' || hasExplicitPermission(user, permission);
}

// Passes if the user is a supervisor-class role (admin or supervisor). Used by
// live supervisor-only reads such as the pre-queue monitor. Additive — does not
// change the semantics of any existing route.
export function requireSupervisor(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'supervisor') return next();
  return res.status(403).json({ error: 'Supervisor access required' });
}

// Used by Agent Desktop routes only — tokens carry role:'agent'
export function requireAgentAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, secret);
    if (decoded.role !== 'agent') {
      return res.status(403).json({ error: 'Agent token required' });
    }
    req.agentId      = decoded.agentId;
    req.agentFullName = decoded.fullName;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export { secret as JWT_SECRET };

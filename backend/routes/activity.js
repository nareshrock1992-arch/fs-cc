import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler }      from '../utils/asyncHandler.js';
import { listActivity }      from '../controllers/activityController.js';

// Mounted at /api/activity (behind the global requireAuth in server.js, which already
// refuses Agent Desktop tokens). Owner decision 2026-11-23: admins (implicitly) and
// supervisors granted view_activity_log.
const router = Router();
router.use(requirePermission('view_activity_log'));
router.get('/', asyncHandler(listActivity));

export default router;

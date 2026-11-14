import { Router } from 'express';
import * as calls from '../controllers/callsController.js';
import { forceHangup } from '../controllers/callControlController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireSupervisor } from '../middleware/auth.js';

const router = Router();

// Active calls (waiting in queue + bridged to agent)
router.get('/live', asyncHandler(calls.listLiveCalls));

// Active IVR / pre-queue callers (live, observed, pre-mod_callcenter).
// Supervisor-only; caller identifier is masked by default.
router.get('/prequeue', requireSupervisor, asyncHandler(calls.listPreQueueCalls));

// Live queue snapshot direct from mod_callcenter (bypasses DB)
router.get('/live/:queueName/members', asyncHandler(calls.getQueueMembersLive));

// Supervisor: end a call stuck in FreeSWITCH (audited, BUG-007)
router.post('/:callUuid/force-hangup', requireSupervisor, asyncHandler(forceHangup));

// Recent ended calls
router.get('/recent', asyncHandler(calls.listRecentCalls));

export default router;

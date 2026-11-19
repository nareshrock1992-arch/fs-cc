import { Router } from 'express';
import { requireAgentAuth } from '../middleware/auth.js';
import { asyncHandler }     from '../utils/asyncHandler.js';
import * as desk from '../controllers/agentDeskController.js';
import { createLoginLimiter } from '../middleware/loginLimiter.js';
import { config } from '../config/index.js';
import { modeAllowsWebrtc } from '../utils/telephony.js';
import { createAgentRateLimiter } from '../services/relayTicketStore.js';

const router = Router();

// Public — no JWT required
router.post('/login', createLoginLimiter({ idField: 'agent_id' }), asyncHandler(desk.agentLogin));

// Agent-authenticated routes (require role:'agent' JWT)
router.use(requireAgentAuth);
router.get('/me',          asyncHandler(desk.agentMe));
router.post('/status',     asyncHandler(desk.agentSetStatus));
router.get('/queues',      asyncHandler(desk.agentQueues));
router.get('/calls',       asyncHandler(desk.agentCalls));
router.get('/performance', asyncHandler(desk.agentPerformance));
router.get('/esl-status',  asyncHandler(desk.eslStatus));

// Browser phone (CP3). The route does not exist at all for EXTERNAL_PBX customers.
if (modeAllowsWebrtc(config.telephony?.mode)) {
  router.post('/webrtc/ticket', createAgentRateLimiter({ max: 10, windowMs: 60_000 }),
    asyncHandler(desk.agentWebrtcTicket));
  router.post('/webrtc/page-reload', createAgentRateLimiter({ max: 5, windowMs: 60_000 }),
    asyncHandler(desk.agentWebrtcPageReload));
}

// Break management (agent-facing)
router.get('/break-codes',   asyncHandler(desk.agentBreakCodes));
router.get('/break-history', asyncHandler(desk.agentBreakHistory));

// Call history (agent-scoped — always req.agentId)
router.get('/call-history',           asyncHandler(desk.agentCallHistory));
router.get('/call-history/:callUuid', asyncHandler(desk.agentCallHistoryDetail));

export default router;

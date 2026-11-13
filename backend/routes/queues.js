import { Router } from 'express';
import * as queues from '../controllers/queuesController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import { checkQueueDrift } from '../services/eslService.js';

const router = Router();

// Read-only — requireAuth is applied globally in server.js; no extra guard needed.
router.get('/',           asyncHandler(queues.listQueues));
// UI-1: settings saved in the database but not (yet) running in FreeSWITCH.
router.get('/drift',      asyncHandler(async (_req, res) => res.json(await checkQueueDrift())));
router.get('/:queueName', asyncHandler(queues.getQueue));

// Admin-only mutations
router.post('/',                             requireAdmin, asyncHandler(queues.createQueue));
router.put('/:queueName',                    requireAdmin, asyncHandler(queues.updateQueue));
router.delete('/:queueName',                 requireAdmin, asyncHandler(queues.deleteQueue));
router.post('/:queueName/tiers',             requireAdmin, asyncHandler(queues.addTier));
router.put('/:queueName/tiers/:agentId',     requireAdmin, asyncHandler(queues.setTier));
router.delete('/:queueName/tiers/:agentId',  requireAdmin, asyncHandler(queues.removeTier));

export default router;

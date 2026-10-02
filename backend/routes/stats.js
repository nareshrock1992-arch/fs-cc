import { Router } from 'express';
import { getDashboardStats, getQueueStats, getBusinessDate, getLiveAgents,
         getCallsTrend, getUtilizationToday } from '../controllers/statsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.get('/dashboard',         asyncHandler(getDashboardStats));
router.get('/queues',            asyncHandler(getQueueStats));
router.get('/business-date',     asyncHandler(getBusinessDate));
router.get('/live-agents',       asyncHandler(getLiveAgents));
router.get('/calls-trend',       asyncHandler(getCallsTrend));
router.get('/utilization-today', asyncHandler(getUtilizationToday));

export default router;

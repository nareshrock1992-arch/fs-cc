import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler }      from '../utils/asyncHandler.js';
import * as dispositions     from '../controllers/dispositionCodesController.js';

// Mounted at /api/disposition-codes (behind the global requireAuth in server.js).
// The whole management surface requires manage_dispositions (admins implicitly hold
// every permission). Like break codes, the global requireAuth also accepts agent-desk
// tokens, so this guard keeps agents out; agents read the codes their call may use
// through /api/agent-desk/wrapup.
const router = Router();

router.use(requirePermission('manage_dispositions'));

router.get('/',             asyncHandler(dispositions.listDispositionCodes));
router.post('/',            asyncHandler(dispositions.createDispositionCode));
router.put('/:id',          asyncHandler(dispositions.updateDispositionCode));
router.patch('/:id/status', asyncHandler(dispositions.setDispositionCodeStatus));
router.put('/queues/:queueId', asyncHandler(dispositions.setQueueDispositions));

export default router;

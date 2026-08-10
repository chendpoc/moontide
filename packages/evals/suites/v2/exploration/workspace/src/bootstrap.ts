import { auth } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
export const middleware = [rateLimit, auth];

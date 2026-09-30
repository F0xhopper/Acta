import type { z } from 'zod';
import type { ClaimSchema } from '../contracts.js';
export type Claim = z.infer<typeof ClaimSchema>;

import { executeReview } from './hosted-review.mjs';
export const call = (args, options) => executeReview('ado_get_pull_request', args, options);

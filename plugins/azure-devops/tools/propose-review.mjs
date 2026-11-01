import { executeReview } from './hosted-review.mjs';
export const call = (args, options) => executeReview('ado_propose_review_comment', args, options);

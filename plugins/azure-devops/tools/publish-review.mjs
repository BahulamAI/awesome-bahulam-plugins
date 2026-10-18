import { executeReview } from './hosted-review.mjs';
export const call = (args, options) => executeReview('ado_publish_review_comment', args, options);

import { executeReview } from './hosted-review.mjs';
export const call = (args, options) => executeReview('ado_list_pull_request_threads', args, options);

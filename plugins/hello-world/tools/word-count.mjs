/**
 * word_count — text analytics.
 *
 * Shows how to return a structured object the agent can reason about,
 * and how to validate inputs and return `success: false` on bad calls.
 */

export const name = 'word_count';
export const description = 'Count words, characters, sentences, and paragraphs';

export async function call(args = {}) {
  const text = args.text;
  if (typeof text !== 'string' || !text.trim()) {
    return { success: false, output: 'word_count: `text` must be a non-empty string' };
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const chars = text.length;
  const charsNoSpace = text.replace(/\s+/g, '').length;
  // Sentence split: any run of ., !, or ? followed by whitespace or end.
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const avgWordLen = words.length ? charsNoSpace / words.length : 0;

  return {
    success: true,
    output: {
      words: words.length,
      characters: chars,
      characters_no_spaces: charsNoSpace,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      avg_word_length: Math.round(avgWordLen * 100) / 100,
      longest_word: words.reduce((a, b) => (b.length > a.length ? b : a), ''),
    },
  };
}

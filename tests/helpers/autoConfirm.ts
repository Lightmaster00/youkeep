import { watch } from 'vue';
import { pendingConfirm, answerConfirm } from '../../app/composables/useConfirm';

/**
 * Answers every confirmAction() question with `reply()` (the replacement for
 * stubbing window.confirm). Returns the function that stops answering.
 */
export function autoAnswerConfirms(reply: () => boolean): () => void {
  return watch(pendingConfirm, (req) => {
    if (req) queueMicrotask(() => answerConfirm(reply()));
  }, { flush: 'sync' });
}

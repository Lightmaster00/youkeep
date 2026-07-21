import { ref } from 'vue';

// Module-scope (not inside the exported function) so every import shares
// the same ref — this is what makes "only one card previews at a time"
// work without prop drilling or an event bus.
const activePreviewId = ref<string | null>(null);

export function useVideoPreview() {
  return { activePreviewId };
}

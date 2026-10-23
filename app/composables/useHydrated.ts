import { onMounted, ref } from 'vue';

/**
 * False on the server and during the client's hydration render, true once the
 * component is mounted. Gate anything that only exists on the client (a
 * `server: false` fetch's pending state, storage, viewport) behind it, so the
 * first client render produces exactly the HTML the server sent.
 */
export function useHydrated() {
  const hydrated = ref(false);
  onMounted(() => { hydrated.value = true; });
  return hydrated;
}

import { useMusicPlayer } from './useMusicPlayer';
import type { PlayableTrack } from './useMusicPlayer';

// Play / Shuffle / play-from-here for a whole list of tracks (Liked songs,
// a personal playlist): the playable tracks of the list become the queue.
export function usePlayTrackList() {
  const player = useMusicPlayer();

  const playable = (list: any[]): PlayableTrack[] => list.filter((t) => t?.local_file_path);

  // In list order, from the first track.
  function playAll(list: any[]) {
    const queue = playable(list);
    if (queue.length === 0) return;
    if (player.shuffleOn.value) player.toggleShuffle();
    player.play(queue[0]!, queue);
  }

  // Shuffle on, starting from a random track.
  function shuffleAll(list: any[]) {
    const queue = playable(list);
    if (queue.length === 0) return;
    if (!player.shuffleOn.value) player.toggleShuffle();
    player.play(queue[Math.floor(Math.random() * queue.length)]!, queue);
  }

  function playFrom(track: any, list: any[]) {
    if (!track?.local_file_path) return;
    player.play(track, playable(list));
  }

  return { playAll, shuffleAll, playFrom, currentTrack: player.currentTrack };
}

/**
 * Mounts the automatic republishing of shared tanks - spec 019.
 *
 * A component with no output, matching AutoMediaSync: the driving effects hang
 * off the app's own lifecycle, are torn down with it, and exactly one thing in
 * the tree owns them.
 */
import { useAutoRepublish } from '@/ui/useAutoRepublish';

export default function AutoRepublish() {
  useAutoRepublish();
  return null;
}

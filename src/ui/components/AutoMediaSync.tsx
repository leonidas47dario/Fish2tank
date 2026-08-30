/**
 * Mounts the automatic photo sync - spec 014.
 *
 * A component with no output, so the driving effects hang off the app's own
 * lifecycle and are torn down with it, and so exactly one thing in the tree
 * owns them.
 */
import { useAutoMediaSync } from '@/ui/useAutoMediaSync';

export default function AutoMediaSync() {
  useAutoMediaSync();
  return null;
}

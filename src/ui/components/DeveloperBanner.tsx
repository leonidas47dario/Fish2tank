/**
 * The banner that makes developer mode impossible to forget - spec 013.
 *
 * NOT decoration. Spec 010 built the sign-in gate because a signed-out device
 * worked perfectly while silently accumulating catches, photos and tanks
 * somewhere that would not survive the device: the lost-phone case looked
 * healthy right up until the phone was lost. Developer mode puts the app back
 * into exactly that state on purpose, so the one thing it must never be is
 * quiet.
 *
 * It sits above the app on every route, says what is true - nothing is
 * syncing, this device is the only copy - and offers the way out.
 */
import { useEffect, useRef } from 'react';
import { leaveDeveloperMode } from '@/data/dev-mode';
import { WarningCircleIcon } from './Icons';

export default function DeveloperBanner() {
  const bar = useRef<HTMLDivElement>(null);

  /*
   * Publish the banner's real height as a custom property.
   *
   * The profile button (FR-A10) is `position: fixed` at the top right, so a
   * sticky banner lands on top of it and takes away the one control that used
   * to be seven cards down Settings. Offsetting it needs the banner's height,
   * and that height is not a constant: this text wraps to two lines on a
   * phone and one on a laptop. So it is measured rather than guessed, and the
   * property disappears with the banner.
   */
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const publish = () => {
      document.documentElement.style.setProperty('--devbar-height', `${node.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--devbar-height');
    };
  }, []);

  return (
    <div className="devbar" role="status" ref={bar}>
      <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
      <p className="devbar__text">
        <strong>Developer mode.</strong> Signed out — nothing is syncing, and this device
        holds the only copy of anything you add.
      </p>
      <button type="button" className="devbar__exit" onClick={leaveDeveloperMode}>
        Leave
      </button>
    </div>
  );
}

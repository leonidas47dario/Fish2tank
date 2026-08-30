/**
 * Jump-to navigation for Settings - spec 018.
 *
 * ONE DOM, TWO SHAPES. This renders the same list whatever the viewport;
 * `.settings-nav` turns it into a sticky horizontal chip row on a phone and a
 * left rail from 900px up. Rendering two different trees and hiding one would
 * put the same five buttons in the accessibility tree twice.
 *
 * BUTTONS, NOT LINKS. The app runs on `HashRouter`, so the URL hash is the
 * route - an `<a href="#account">` would navigate to a route called `account`
 * rather than scrolling to a section. Jumping is scripted for that reason and
 * not by preference.
 *
 * There is deliberately no scroll-spy. With four of five sections collapsed
 * the whole screen is roughly one screenful, so a "currently viewing"
 * highlight would flicker between sections that are all visible at once, for
 * an IntersectionObserver's worth of code.
 */
import { SETTINGS_SECTIONS } from '@/ui/screens/settings-sections';

export default function SettingsNav({ onJump }: { onJump: (id: string) => void }) {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <ul className="settings-nav__list">
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className="settings-nav__item"
              onClick={() => onJump(section.id)}
            >
              {section.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

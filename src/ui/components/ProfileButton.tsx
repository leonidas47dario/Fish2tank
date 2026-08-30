/**
 * The profile affordance - spec 010 FR-A10.
 *
 * Sign-in shipped inside Settings, below the theme pickers, the scene pickers
 * and the motion toggles: the most consequential control in the app was the
 * seventh card down a settings page. PRD 3.2's navigation model has five
 * bottom destinations and no header, so there was nowhere else for it to go.
 * Top right is empty, is where every other app puts this, and disturbs no
 * existing structure.
 *
 * A LINK, NOT A MENU. A dropdown would be a second navigation model competing
 * with the five destinations, for one destination. If it ever earns more items
 * it can become one.
 */
import { NavLink } from 'react-router-dom';
import { useObservable } from 'dexie-react-hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { LOCAL_PROFILE_ID } from '@/data/profile';
import { UserCircleIcon } from './Icons';

/** First letter of the name the keeper chose, else of the account email. */
function initialFor(displayName: string | undefined, email: string | undefined): string | undefined {
  const source = displayName?.trim() || email?.trim();
  return source ? source[0]?.toUpperCase() : undefined;
}

export default function ProfileButton() {
  const user = useObservable(db.cloud.currentUser);
  const profile = useLiveQuery(() => db.users.get(LOCAL_PROFILE_ID));

  const initial = initialFor(profile?.displayName, user?.email);
  // NFR-06: the accessible name says who, not just "profile". A screen reader
  // user gets the same information the initial gives everyone else.
  const who = profile?.displayName?.trim() || user?.email || 'your account';

  return (
    <NavLink to="/settings" className="profile" aria-label={`Settings, signed in as ${who}`}>
      {initial ? (
        <span aria-hidden="true">{initial}</span>
      ) : (
        <UserCircleIcon size={22} weight="regular" aria-hidden="true" />
      )}
    </NavLink>
  );
}

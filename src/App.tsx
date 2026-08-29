import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { ScrollMemory } from './ui/ScrollMemory';
import Home from './ui/screens/Home';
import Catalog from './ui/screens/Catalog';
import SpeciesDetail from './ui/screens/SpeciesDetail';
import CatchScreen from './ui/screens/CatchScreen';
import IdentifyFlow from './ui/screens/IdentifyFlow';
import Tanks from './ui/screens/Tanks';
import TankDetail from './ui/screens/TankDetail';
import Journal from './ui/screens/Journal';
import SpecimenDetail from './ui/screens/SpecimenDetail';
import Settings from './ui/screens/Settings';
import {
  CameraIcon, DropIcon, HouseIcon, NotePencilIcon, SquaresFourIcon,
} from './ui/components/Icons';

/**
 * PRD 3.2 navigation model. Catch is the central action.
 *
 * The glyphs used to be typed characters - `⌂ ◈ ◉ ▤ ✎` - which render at a
 * different weight and baseline in every system font, and which two of the
 * five platforms have no glyph for at all. One icon family, one weight.
 */
const DESTINATIONS = [
  { to: '/', Icon: HouseIcon, label: 'Home', end: true },
  { to: '/catalog', Icon: SquaresFourIcon, label: 'Catalog', end: false },
  { to: '/catch', Icon: CameraIcon, label: 'Catch', end: false },
  { to: '/tanks', Icon: DropIcon, label: 'Tanks', end: false },
  { to: '/journal', Icon: NotePencilIcon, label: 'Journal', end: false },
];

export default function App() {
  return (
    <>
      <ScrollMemory />
      <main className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalog" element={<Catalog />} />
          {/* /collection kept as a redirect: it was the nav item for three
              releases and may be bookmarked or linked from a story. */}
          <Route path="/collection" element={<Navigate to="/catalog" replace />} />
          <Route path="/species/:id" element={<SpeciesDetail />} />
          <Route path="/catch" element={<CatchScreen />} />
          {/* The guided identify + reveal step, entered straight from a capture. */}
          <Route path="/catch/:specimenId/identify" element={<IdentifyFlow />} />
          <Route path="/tanks" element={<Tanks />} />
          {/* A single tank, in the viewer mode you can hand to a guest. */}
          <Route path="/tanks/:id" element={<TankDetail />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/specimen/:id" element={<SpecimenDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <nav className="nav" aria-label="Main">
        {DESTINATIONS.map(({ to, Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} className={label === 'Catch' ? 'nav__catch' : undefined}>
            {({ isActive }) => (
              <>
                <span className="nav__glyph">
                  {/* Filled when you are on it. The weight change carries the
                      current-page state as well as the colour does, which the
                      colour alone would not in greyscale (NFR-06). */}
                  <Icon size={22} weight={isActive || label === 'Catch' ? 'fill' : 'regular'} aria-hidden="true" />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

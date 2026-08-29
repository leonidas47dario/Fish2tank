import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import Home from './ui/screens/Home';
import Catalog from './ui/screens/Catalog';
import SpeciesDetail from './ui/screens/SpeciesDetail';
import CatchScreen from './ui/screens/CatchScreen';
import IdentifyFlow from './ui/screens/IdentifyFlow';
import Tanks from './ui/screens/Tanks';
import Journal from './ui/screens/Journal';
import SpecimenDetail from './ui/screens/SpecimenDetail';
import Settings from './ui/screens/Settings';

/** PRD 3.2 navigation model. Catch is the central action. */
const DESTINATIONS = [
  { to: '/', glyph: '⌂', label: 'Home', end: true },
  { to: '/catalog', glyph: '◈', label: 'Catalog', end: false },
  { to: '/catch', glyph: '◉', label: 'Catch', end: false },
  { to: '/tanks', glyph: '▤', label: 'Tanks', end: false },
  { to: '/journal', glyph: '✎', label: 'Journal', end: false },
];

export default function App() {
  return (
    <>
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
          <Route path="/journal" element={<Journal />} />
          <Route path="/specimen/:id" element={<SpecimenDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <nav className="nav" aria-label="Main">
        {DESTINATIONS.map((d) => (
          <NavLink key={d.to} to={d.to} end={d.end} className={d.label === 'Catch' ? 'nav__catch' : undefined}>
            <span className="nav__glyph" aria-hidden="true">{d.glyph}</span>
            {d.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

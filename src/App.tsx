import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './ui/screens/Home';
import Collection from './ui/screens/Collection';
import CatchScreen from './ui/screens/CatchScreen';
import Tanks from './ui/screens/Tanks';
import Journal from './ui/screens/Journal';
import SpecimenDetail from './ui/screens/SpecimenDetail';
import Settings from './ui/screens/Settings';

/** PRD 3.2 navigation model. Catch is the central action. */
const DESTINATIONS = [
  { to: '/', glyph: '⌂', label: 'Home', end: true },
  { to: '/collection', glyph: '◈', label: 'Collection', end: false },
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
          <Route path="/collection" element={<Collection />} />
          <Route path="/catch" element={<CatchScreen />} />
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

/**
 * Status and rarity cues.
 *
 * NFR-06 requires non-colour cues throughout. Each badge renders a glyph AND a
 * word alongside its hue, and the CSS varies border style per severity, so the
 * meaning survives greyscale, colour blindness and a monochrome screenshot.
 */
import type { DiscoveryTier, Verdict } from '@/domain/types';
import { SCARCITY_LABELS, type MarketScarcityBand } from '@/engine/rarity/market-scarcity';

const VERDICT_TEXT: Record<Verdict, { glyph: string; label: string }> = {
  suitable: { glyph: '✓', label: 'Suitable' },
  conditional: { glyph: '!', label: 'Conditional' },
  'high-risk': { glyph: '▲', label: 'High risk' },
  'extreme-risk': { glyph: '■', label: 'Extreme risk' },
  'insufficient-data': { glyph: '?', label: 'Not enough data' },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { glyph, label } = VERDICT_TEXT[verdict];
  return (
    <span className={`badge badge--${verdict}`}>
      <span className="badge__glyph" aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}

const TIER_GLYPH: Record<DiscoveryTier, string> = {
  familiar: '·',
  uncommon: '◇',
  rare: '◆',
  epic: '✦',
  legendary: '★',
};

export function TierBadge({ tier, golden }: { tier: DiscoveryTier; golden?: boolean }) {
  return (
    <span className="row" style={{ gap: 'var(--space-2)' }}>
      <span className={`tier tier--${tier}`}>
        <span aria-hidden="true">{TIER_GLYPH[tier]}</span>
        {tier}
      </span>
      {golden && (
        <span className="tier tier--legendary" title="A personal mark. It does not change the score.">
          <span aria-hidden="true">✧</span>
          Golden
        </span>
      )}
    </span>
  );
}

const IDENTITY_TEXT = {
  unknown: { glyph: '?', label: 'Unknown' },
  provisional: { glyph: '~', label: 'Provisional' },
  'user-confirmed': { glyph: '✓', label: 'You confirmed this' },
} as const;

export function IdentityBadge({ status }: { status: keyof typeof IDENTITY_TEXT }) {
  const { glyph, label } = IDENTITY_TEXT[status];
  const tone = status === 'user-confirmed' ? 'suitable' : status === 'provisional' ? 'conditional' : 'insufficient-data';
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__glyph" aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}

const SCARCITY_GLYPH: Record<MarketScarcityBand, string> = {
  'widely-available': '▪',
  available: '▫',
  uncommon: '◇',
  scarce: '◆',
  'rarely-listed': '✦',
};

/**
 * Market scarcity, shown alongside — never merged into — the personal tier.
 * Non-colour cues per NFR-06: glyph and word, not hue alone.
 */
export function ScarcityBadge({ band }: { band: MarketScarcityBand }) {
  const tone =
    band === 'rarely-listed' || band === 'scarce' ? 'tier--legendary'
    : band === 'uncommon' ? 'tier--rare'
    : 'tier--familiar';
  return (
    // Borrows the tier pill's styling, but carries its own marker class: a
    // scarcity badge is not a Discovery tier, and anything selecting ".tier"
    // must be able to tell them apart. FR-P05 in the DOM, not just in prose.
    <span className={`tier scarcity ${tone}`} title="How likely you are to find this on a shelf">
      <span aria-hidden="true">{SCARCITY_GLYPH[band]}</span>
      {SCARCITY_LABELS[band]}
    </span>
  );
}

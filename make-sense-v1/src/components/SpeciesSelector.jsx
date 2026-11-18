import { useState } from 'react'
import { SPECIES_CATALOG } from '../config.js'

function CheckMark({ on, color }) {
  return (
    <span
      className={`bird-card__check${on ? ' is-on' : ''}`}
      style={on ? { backgroundColor: color, borderColor: color } : undefined}
      aria-hidden="true"
    >
      {on && (
        <svg viewBox="0 0 16 16">
          <path
            d="M3.2 8.2 6.4 11.4 12.8 4.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

/**
 * Species cards. More info expands a compact row into a full card.
 * Several birds can stay open at once and are read by scrolling.
 * At least one species stays selected.
 */
export default function SpeciesSelector({
  selectedIds,
  onToggle,
  followId = null,
  onFollowToggle,
  disabled = false,
}) {
  const [expandedIds, setExpandedIds] = useState(() => [SPECIES_CATALOG[0].id])

  const expand = (id) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  const toggle = (id, checked) => {
    if (disabled) return
    if (checked && selectedIds.length === 1) return
    onToggle(id)
  }

  return (
    <div className="species-selector" role="group" aria-label="Species">
      {SPECIES_CATALOG.map((species) => {
        const on = selectedIds.includes(species.id)
        const locked = disabled || (on && selectedIds.length === 1)
        const following = followId === species.id

        if (expandedIds.includes(species.id)) {
          return (
            <article
              key={species.id}
              className="bird-card bird-card--feature"
            >
              <header className="bird-card__head">
                <div>
                  <h2>{species.commonName}</h2>
                  <p>
                    <em>{species.scientificName}</em>
                  </p>
                </div>
                <button
                  type="button"
                  className="bird-card__toggle"
                  aria-pressed={on}
                  aria-label={
                    on
                      ? `${species.commonName}, selected`
                      : `Select ${species.commonName}`
                  }
                  disabled={locked}
                  onClick={() => toggle(species.id, on)}
                >
                  <CheckMark on={on} color={species.color} />
                </button>
              </header>
              {species.imageUrl && (
                <button
                  type="button"
                  className={`bird-card__follow${following ? ' is-following' : ''}`}
                  aria-pressed={following}
                  aria-label={
                    following
                      ? `Stop following ${species.commonName}`
                      : `Follow ${species.commonName}`
                  }
                  onClick={() => onFollowToggle?.(species.id)}
                >
                  <img
                    className="bird-card__photo"
                    src={species.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="bird-card__follow-label">
                    {following ? 'Click to stop following' : 'Click to follow'}
                  </span>
                </button>
              )}
              {species.blurb && (
                <p className="bird-card__blurb">{species.blurb}</p>
              )}
            </article>
          )
        }

        return (
          <div
            key={species.id}
            className={`bird-card bird-card--compact${on ? ' is-on' : ''}`}
          >
            <button
              type="button"
              className="bird-card__select"
              aria-pressed={on}
              disabled={locked}
              onClick={() => toggle(species.id, on)}
            >
              {species.imageUrl && (
                <img className="bird-card__icon" src={species.imageUrl} alt="" />
              )}
              <span className="bird-card__name">{species.commonName}</span>
            </button>
            <button
              type="button"
              className="bird-card__more"
              onClick={() => expand(species.id)}
            >
              More info
            </button>
            <button
              type="button"
              className="bird-card__toggle"
              aria-pressed={on}
              aria-label={
                on
                  ? `${species.commonName}, selected`
                  : `Select ${species.commonName}`
              }
              disabled={locked}
              onClick={() => toggle(species.id, on)}
            >
              <CheckMark on={on} color={species.color} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

import { SPECIES_CATALOG } from '../config.js'

/**
 * Switch between local GBIF occurrence datasets.
 */
export default function SpeciesSelector({
  speciesId,
  onSpeciesChange,
  disabled = false,
}) {
  return (
    <div className="species-selector" role="group" aria-label="Species">
      <label className="species-selector__label" htmlFor="species-select">
        Species
      </label>
      <select
        id="species-select"
        className="species-selector__select"
        value={speciesId}
        disabled={disabled}
        onChange={(e) => onSpeciesChange(e.target.value)}
      >
        {SPECIES_CATALOG.map((s) => (
          <option key={s.id} value={s.id}>
            {s.commonName} ({s.scientificName})
          </option>
        ))}
      </select>
    </div>
  )
}

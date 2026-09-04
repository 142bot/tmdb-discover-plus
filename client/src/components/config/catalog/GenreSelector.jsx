import { memo } from 'react';
import { Check, X } from 'lucide-react';
import { Skeleton } from '../../layout/Skeleton';
import { SmoothExpand } from '../../layout/SmoothExpand';

export const GenreSelector = memo(function GenreSelector({
  genres,
  selectedGenres,
  excludedGenres,
  genreMatchMode,
  onInclude,
  onExclude,
  onClear,
  onSetMatchMode,
  loading,
  onRefresh,
  showMatchMode = true,
  showLegend = true,
}) {
  const getGenreState = (id) => {
    if (selectedGenres.includes(id)) return 'include';
    if (excludedGenres.includes(id)) return 'exclude';
    return 'neutral';
  };

  const handleTriStateClick = (id) => {
    const currentState = getGenreState(id);
    if (currentState === 'neutral') {
      onInclude(id);
    } else if (currentState === 'include') {
      onExclude(id);
    } else {
      onClear(id);
    }
  };

  if (loading) {
    return (
      <div className="genre-grid tristate">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} width="100%" height={36} borderRadius="var(--radius-full)" />
        ))}
      </div>
    );
  }

  if (!genres || genres.length === 0) {
    return (
      <div className="error-box">
        <p>Genres not available.</p>
        <div className="mt-2">
          <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
            Retry loading genres
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {showLegend && (
        <div className="genre-instructions">
          <span className="genre-instruction-item">
            <span className="genre-dot neutral"></span> Click to include
          </span>
          <span className="genre-instruction-item">
            <span className="genre-dot include"></span> Click again to exclude
          </span>
          <span className="genre-instruction-item">
            <span className="genre-dot exclude"></span> Click again to clear
          </span>
        </div>
      )}

      <SmoothExpand show={showMatchMode}>
        <div className={`genre-match-mode-box`}>
          <div className="genre-match-mode-label">How should multiple genres be matched?</div>
          <div
            className={`genre-match-mode-toggle ${selectedGenres.length < 2 ? 'disabled' : ''}`}
            role="radiogroup"
          >
            <div className={`genre-match-mode-indicator pos-${genreMatchMode}`} />
            <button
              type="button"
              role="radio"
              aria-checked={genreMatchMode === 'any'}
              disabled={selectedGenres.length < 2}
              className={`genre-match-mode-toggle-btn ${genreMatchMode === 'any' ? 'active' : ''}`}
              onClick={() => onSetMatchMode('any')}
            >
              ANY
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={genreMatchMode === 'all'}
              disabled={selectedGenres.length < 2}
              className={`genre-match-mode-toggle-btn ${genreMatchMode === 'all' ? 'active' : ''}`}
              onClick={() => onSetMatchMode('all')}
            >
              ALL
            </button>
          </div>
        </div>
      </SmoothExpand>

      <div className="genre-grid tristate" role="group" aria-label="Genre filter">
        {[...genres]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((genre) => {
            const state = getGenreState(genre.id);
            const ariaPressed =
              state === 'include' ? 'true' : state === 'exclude' ? 'mixed' : 'false';
            return (
              <button
                key={genre.id}
                type="button"
                className={`genre-chip tristate ${state}`}
                onClick={() => handleTriStateClick(genre.id)}
                aria-pressed={ariaPressed}
                aria-label={`${genre.name}: ${state === 'neutral' ? 'not selected' : state === 'include' ? 'included' : 'excluded'}`}
                title={
                  state === 'neutral'
                    ? 'Click to include'
                    : state === 'include'
                      ? 'Click to exclude'
                      : 'Click to clear'
                }
              >
                <span className="genre-chip-label">{genre.name}</span>
                <span className="genre-chip-icon-wrapper">
                  <Check size={14} className="genre-icon include-icon" aria-hidden="true" />
                  <X size={14} className="genre-icon exclude-icon" aria-hidden="true" />
                </span>
              </button>
            );
          })}
      </div>

      <SmoothExpand show={selectedGenres.length > 0 || excludedGenres.length > 0}>
        <div className="genre-summary" role="status" aria-live="polite">
          {selectedGenres.length > 0 && (
            <div className="genre-summary-row include">
              <Check size={14} />
              <span>
                Including:{' '}
                {selectedGenres
                  .map((id) => {
                    const g = genres.find((g) => g.id === id);
                    return g?.name || id;
                  })
                  .join(', ')}
              </span>
            </div>
          )}
          {excludedGenres.length > 0 && (
            <div className="genre-summary-row exclude">
              <X size={14} />
              <span>
                Excluding:{' '}
                {excludedGenres
                  .map((id) => {
                    const g = genres.find((g) => g.id === id);
                    return g?.name || id;
                  })
                  .join(', ')}
              </span>
            </div>
          )}
        </div>
      </SmoothExpand>
    </>
  );
});

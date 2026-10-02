import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, BookOpen, ChevronRight, Info } from 'lucide-react';
import { MaterialItem } from '../lib/store';
import { MaterialCard } from './MaterialCard';
import { fetchSuggestedMaterials, fetchStudentCourseCodes, SuggestedMaterial } from '../lib/suggestions';
import { fx } from '../lib/motion';

interface SuggestedMaterialsProps {
  currentUser: {
    id: string;
    department: string;
    faculty: string;
    level: string;
  };
  onReadOnline: (material: MaterialItem) => void;
  onAskAi?: (material: MaterialItem) => void;
}

export function SuggestedMaterialsSection({ currentUser, onReadOnline, onAskAi }: SuggestedMaterialsProps) {
  const [suggested, setSuggested] = useState<SuggestedMaterial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser.department && !currentUser.faculty) {
      setSuggested([]);
      return;
    }
    setError(null);
    setSuggested(null);
    try {
      const courseCodes = await fetchStudentCourseCodes();
      const items = await fetchSuggestedMaterials(
        {
          department: currentUser.department,
          faculty: currentUser.faculty,
          level: currentUser.level,
          courseCodes
        },
        8
      );
      setSuggested(items);
    } catch {
      setSuggested([]);
      setError('Suggestions are temporarily unavailable.');
    }
  }, [currentUser.department, currentUser.faculty, currentUser.level]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasSuggestions = (suggested ?? []).length > 0;
  const isLoading = suggested === null;

  return (
    <section className="suggested-section" aria-label="Suggested materials for you">
      <div className="section-head">
        <div>
          <p className="kicker">SUGGESTED FOR YOU</p>
          <h2>Suggested Materials</h2>
        </div>
        <Link to="/library">
          Browse library <ChevronRight size={16} />
        </Link>
      </div>

      {error && (
        <div className="suggested-note suggested-note-warn">
          <Info size={15} />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="suggested-grid suggested-loading" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="suggested-skeleton" key={i}>
              <span />
            </div>
          ))}
        </div>
      ) : hasSuggestions ? (
        <div className={`suggested-grid ${fx.fadeIn}`}>
          {suggested!.map(({ material, reason }) => (
            <div className="suggested-card" key={material.id}>
              <div className="suggested-reason">
                <Sparkles size={12} />
                <span>{reason.label}</span>
              </div>
              <MaterialCard material={material} onReadOnline={onReadOnline} onAskAi={onAskAi} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state card-empty suggested-empty">
          <BookOpen size={40} />
          <b>No suggestions yet</b>
          <span>
            Once materials for your courses, department, or faculty are published, they will appear here. You can also
            register your courses under <Link to="/student/courses">My courses</Link> to refine recommendations.
          </span>
        </div>
      )}
    </section>
  );
}
import { supabase } from './supabase';
import { fetchStudentCourseCodes } from './suggestions';
import { fetchMaterials } from './materials';
import type { MaterialItem } from './store';
import { fetchAccommodationProperties, AccommodationProperty } from './accommodation';

export interface CampusRecommendation {
  id: string;
  category: 'material' | 'marketplace' | 'accommodation' | 'event' | 'deck';
  title: string;
  subtitle: string;
  url: string;
  reason: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RecommendationUserProfile {
  id?: string;
  department?: string | null;
  faculty?: string | null;
  level?: string | null;
}

const DISMISSED_RECS_KEY = 'fuw_dismissed_recommendations_v1';

export function getDismissedRecommendationIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_RECS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function dismissRecommendation(id: string): void {
  try {
    const existing = getDismissedRecommendationIds();
    if (!existing.includes(id)) {
      localStorage.setItem(DISMISSED_RECS_KEY, JSON.stringify([...existing, id]));
    }
  } catch {
    // Ignore storage issues
  }
}

export function clearDismissedRecommendations(): void {
  try {
    localStorage.removeItem(DISMISSED_RECS_KEY);
  } catch {
    // Ignore storage issues
  }
}

/**
 * Generates explainable multi-domain campus recommendations based on permitted student signals.
 */
export async function fetchCampusRecommendations(
  userProfile?: RecommendationUserProfile,
  limit = 8
): Promise<CampusRecommendation[]> {
  const recommendations: CampusRecommendation[] = [];
  const dismissed = new Set(getDismissedRecommendationIds());

  try {
    const courseCodes = await fetchStudentCourseCodes().catch(() => [] as string[]);
    const department = userProfile?.department?.trim();
    const faculty = userProfile?.faculty?.trim();

    // 1. Recommend E-Library Materials (Priority 1)
    const materialPromises: Promise<{ items: MaterialItem[] }>[] = [];
    for (const code of courseCodes.slice(0, 4)) {
      materialPromises.push(fetchMaterials({ status: 'approved', courseCode: code }, {}, 0, 3));
    }
    const userLevel = userProfile?.level?.trim();
    if (department) {
      materialPromises.push(fetchMaterials({ status: 'approved', department, level: userLevel || undefined }, {}, 0, 4));
    }

    const materialResults = await Promise.allSettled(materialPromises);
    const seenMaterialIds = new Set<string>();

    for (const res of materialResults) {
      if (res.status === 'fulfilled') {
        for (const item of res.value.items) {
          if (!seenMaterialIds.has(item.id) && !dismissed.has(`mat_${item.id}`)) {
            const isCourseMatch = courseCodes.includes((item.course || '').toUpperCase());
            const matLevel = item.level?.trim();
            // Restrict level: don't recommend materials from other levels unless student explicitly registered that course
            if (userLevel && matLevel && matLevel.toLowerCase() !== userLevel.toLowerCase() && !isCourseMatch) {
              continue;
            }

            seenMaterialIds.add(item.id);
            recommendations.push({
              id: `mat_${item.id}`,
              category: 'material',
              title: item.title,
              subtitle: `${item.course || item.department || 'E-Library'} · ${item.type}`,
              url: `/materials/${item.id}`,
              reason: isCourseMatch
                ? `Recommended for your course ${item.course}`
                : `Popular in your department (${item.department})`,
              score: isCourseMatch ? 95 : 75,
              metadata: {
                downloads: item.downloads,
                materialType: item.type
              }
            });
          }
        }
      }
    }

    // 2. Recommend Accommodations (Verified Student Lodges)
    try {
      const lodges = await fetchAccommodationProperties({
        availabilityStatus: 'available'
      });
      for (const lodge of (lodges || []).slice(0, 3)) {
        if (!dismissed.has(`acc_${lodge.id}`)) {
          recommendations.push({
            id: `acc_${lodge.id}`,
            category: 'accommodation',
            title: lodge.title,
            subtitle: `${lodge.location_area} · ₦${Number(lodge.price_annual).toLocaleString()}/yr`,
            url: `/accommodation/${lodge.slug}`,
            reason: lodge.is_verified ? 'Verified student lodge with open units' : 'Available lodge in student hub',
            score: lodge.is_verified ? 70 : 60,
            metadata: {
              location: lodge.location_area,
              price: lodge.price_annual,
              thumbnail: lodge.images?.[0]
            }
          });
        }
      }
    } catch {
      // Non-blocking
    }

    // 3. Recommend Upcoming Campus Events
    if (supabase) {
      try {
        const { data: events } = await supabase
          .from('events')
          .select('id, title, category, venue, starts_at')
          .eq('status', 'published')
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(3);

        for (const ev of events || []) {
          if (!dismissed.has(`ev_${ev.id}`)) {
            recommendations.push({
              id: `ev_${ev.id}`,
              category: 'event',
              title: ev.title,
              subtitle: `${ev.category} · ${ev.venue}`,
              url: '/student/events',
              reason: 'Upcoming campus event on your university schedule',
              score: 65,
              metadata: {
                startsAt: ev.starts_at,
                venue: ev.venue
              }
            });
          }
        }
      } catch {
        // Non-blocking
      }
    }
  } catch (err) {
    console.warn('Could not generate full recommendations:', err);
  }

  // Sort by calculated relevance score
  recommendations.sort((a, b) => b.score - a.score);
  return recommendations.slice(0, limit);
}

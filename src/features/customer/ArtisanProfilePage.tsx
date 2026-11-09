import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Image as ImageIcon, Star } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, AppHeader, Button, Card, EmptyState, StatusPill } from '../../components/ui';
import { serviceLabel } from '../../lib/catalog';
import type { ArtisanPortfolioItem, ArtisanProfile, ServiceCategory } from '../../lib/types';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';

interface ReviewRow { rating: number; review: string; created_at: string; }
interface Props {
  supabase: SupabaseClient;
  artisan: ArtisanProfile;
  onBack: () => void;
  onRequestService: (artisan: ArtisanProfile) => void;
}

export function ArtisanProfilePage({ supabase, artisan, onBack, onRequestService }: Props) {
  const [reviewCount, setReviewCount] = useState(0);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [portfolio, setPortfolio] = useState<Array<ArtisanPortfolioItem & { url: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadGeneration = useRef(0);

  async function load(background = false) {
    const generation = ++loadGeneration.current;
    if (!background) setLoading(true);
    setError('');
    const [summaryResult, reviewResult, portfolioResult] = await Promise.all([
      supabase.rpc('fixmate_public_artisan_review_summary', { p_artisan_id: artisan.user_id }),
      supabase.rpc('fixmate_public_artisan_reviews', { p_artisan_id: artisan.user_id }),
      supabase.from('artisan_portfolio_items').select('id, artisan_id, storage_path, caption, created_at')
        .eq('artisan_id', artisan.user_id).order('created_at', { ascending: false }).limit(12),
    ]);
    const queryError = summaryResult.error ?? reviewResult.error ?? portfolioResult.error;
    if (queryError && background) {
      if (generation === loadGeneration.current) { setError('Profile information could not be refreshed. Existing data is still shown.'); setLoading(false); }
      return;
    }
    const summary = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
    const nextReviews = (reviewResult.data ?? []) as ReviewRow[];
    const items = (portfolioResult.data ?? []) as ArtisanPortfolioItem[];
    const signed = await Promise.all(items.map(async (item) => {
      const { data } = await supabase.storage.from('fixmate-marketplace-media').createSignedUrl(item.storage_path, 300);
      return { ...item, url: data?.signedUrl ?? '' };
    }));
    if (generation !== loadGeneration.current) return;
    if (queryError) setError('Some profile information could not be refreshed. Retry to see current reviews and work photos.');
    setReviewCount(Number(summary?.review_count ?? 0));
    setAverageRating(summary?.average_rating == null ? null : Number(summary.average_rating));
    setReviews(nextReviews);
    setPortfolio(signed.filter((item) => item.url));
    setLoading(false);
  }

  useRealtimeRefresh({
    supabase,
    identity: artisan.user_id,
    scope: 'artisan-public-profile',
    tables: [
      { table: 'artisan_profiles', filter: `user_id=eq.${artisan.user_id}` },
      { table: 'artisan_portfolio_items', filter: `artisan_id=eq.${artisan.user_id}` },
    ],
    onChange: () => load(true),
  });

  useEffect(() => { void load(); }, [supabase, artisan.user_id]);

  return <section className="artisan-profile-page">
    <Button variant="quiet" onClick={onBack}><ArrowLeft size={16} /> Back to artisans</Button>
    <AppHeader eyebrow="FIXMATE-VERIFIED ARTISAN" title={artisan.display_name || 'Verified artisan'} detail={artisan.bio?.trim() || 'A FixMate-verified service provider.'} action={<Button disabled={!artisan.is_available} onClick={() => onRequestService(artisan)}>{artisan.is_available ? 'Request Service' : 'Not available now'}</Button>} />
    {error && <Alert>{error}</Alert>}
    <Card className="card-pad artisan-profile-summary">
      <div className="list-card__top"><div><p className="eyebrow">SERVICES</p><div className="service-tags">{artisan.service_categories.map((category: ServiceCategory) => <span className="tag" key={category}>{serviceLabel(category)}</span>)}</div></div><StatusPill status={artisan.is_available ? 'available' : 'not taking requests'} /></div>
      <div className="artisan-rating-summary"><Star size={18} fill="currentColor" /><strong>{averageRating == null ? 'No ratings yet' : averageRating.toFixed(1)}</strong><span>{reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}</span></div>
      {!artisan.is_available && <p className="field__hint">This artisan is not accepting new requests right now. The Request Service action will be available when they are.</p>}
    </Card>
    <section className="dashboard-section">
      <div className="section-heading"><div><p className="eyebrow">WORK & ACHIEVEMENTS</p><h2>Portfolio</h2></div><ImageIcon size={18} color="#5d8a72" /></div>
      {loading ? <p className="muted">Loading profile…</p> : portfolio.length ? <div className="portfolio-grid">{portfolio.map((item) => <figure key={item.id}><img src={item.url} alt={item.caption || `Work by ${artisan.display_name || 'this artisan'}`} loading="lazy" />{item.caption && <figcaption>{item.caption}</figcaption>}</figure>)}</div> : <EmptyState title="No work photos yet" detail="This artisan has not added portfolio photos." />}
    </section>
    <section className="dashboard-section">
      <div className="section-heading"><div><p className="eyebrow">CUSTOMER FEEDBACK</p><h2>Ratings & reviews</h2></div><Star size={18} color="#b5791e" /></div>
      {loading ? <p className="muted">Loading reviews…</p> : reviews.length ? <div className="list-stack">{reviews.map((review, index) => <Card className="card-pad review-card" key={`${review.created_at}-${index}`}><div className="list-card__top"><strong>{'★'.repeat(Math.max(0, Math.min(5, review.rating)))}{'☆'.repeat(5 - Math.max(0, Math.min(5, review.rating)))}</strong><time dateTime={review.created_at}>{new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(review.created_at))}</time></div>{review.review && <p className="list-card__body">{review.review}</p>}</Card>)}</div> : <EmptyState title="No reviews yet" detail="Genuine reviews from completed FixMate jobs will appear here." />}
    </section>
    <p className="field__hint artisan-profile-footnote">Only approved service categories are shown. Exact service-zone details and private contact information are not displayed on this profile.</p>
    <div className="artisan-profile-bottom-cta"><Button disabled={!artisan.is_available} onClick={() => onRequestService(artisan)}>{artisan.is_available ? 'Request Service' : 'Currently unavailable'}</Button></div>
  </section>;
}

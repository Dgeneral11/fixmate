import { useEffect, useState, type FormEvent } from 'react';
import { FileCheck2, FileImage, FileUp, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppHeader, Alert, Button, Card, Field, LoadingState, StatusPill } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { WorkspaceShell, type WorkspaceNavItem } from '../../components/WorkspaceShell';
import { cleanWhatsAppNumber, CUSTOMER_REVIEW_STATUSES } from '../../lib/catalog';
import type { CustomerAlternativeIdType, CustomerVerificationSubmission, Profile } from '../../lib/types';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';

interface Props {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

const navItems: ReadonlyArray<WorkspaceNavItem<'verification'>> = [
  { id: 'verification', label: 'Verification', icon: ShieldCheck },
];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ID_OPTIONS: ReadonlyArray<{ value: CustomerAlternativeIdType; label: string }> = [
  { value: 'nin', label: 'National Identification Number (NIN) document' },
  { value: 'passport', label: 'International passport' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'voters_card', label: "Voter's card" },
  { value: 'other_government_id', label: 'Another government-issued ID' },
];

export function CustomerOnboarding({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [submission, setSubmission] = useState<CustomerVerificationSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(profile.display_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [isStudent, setIsStudent] = useState(true);
  const [studentId, setStudentId] = useState<File | null>(null);
  const [alternativeId, setAlternativeId] = useState<File | null>(null);
  const [alternativeIdType, setAlternativeIdType] = useState<CustomerAlternativeIdType>('nin');

  async function loadSubmission(background = false) {
    if (!background) setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('customer_verification_submissions')
      .select('id, customer_id, profile_photo_path, student_id_path, is_student, alternative_id_type, alternative_id_path, status, submitted_at, created_at')
      .eq('customer_id', profile.id)
      .maybeSingle();
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }
    else if (data) {
      const next = data as CustomerVerificationSubmission;
      setSubmission(next);
      setIsStudent(next.is_student);
      if (next.alternative_id_type) setAlternativeIdType(next.alternative_id_type);
    } else setSubmission(null);
    setLoading(false);
  }

  const liveStatus = useRealtimeRefresh({
    supabase,
    identity: profile.id,
    scope: 'customer-verification',
    tables: [{ table: 'customer_verification_submissions', filter: `customer_id=eq.${profile.id}` }],
    onChange: () => loadSubmission(true),
  });

  useEffect(() => { void loadSubmission(); }, [profile.id]);

  function validateFile(file: File, kind: 'photo' | 'id'): string | null {
    const allowed = kind === 'photo'
      ? ['image/jpeg', 'image/png']
      : ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) return kind === 'photo' ? 'Use a JPG or PNG photo.' : 'Use a PDF, JPG, or PNG ID image.';
    if (file.size > MAX_FILE_BYTES) return 'Each file must be 8 MB or smaller.';
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const cleanPhone = cleanWhatsAppNumber(phone);
    if (!name.trim()) { setError('Enter your name.'); return; }
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) { setError('Enter a WhatsApp contact number with 10–15 digits.'); return; }
    if (!photo && !submission?.profile_photo_path) { setError('Upload a profile photo.'); return; }
    if (isStudent && !studentId && !submission?.student_id_path) { setError('Upload your student ID.'); return; }
    if (!isStudent && !alternativeId && !submission?.alternative_id_path) { setError('Upload one alternative government-issued ID.'); return; }
    if (photo) {
      const fileError = validateFile(photo, 'photo');
      if (fileError) { setError(fileError); return; }
    }
    if (studentId) {
      const fileError = validateFile(studentId, 'id');
      if (fileError) { setError(fileError); return; }
    }
    if (alternativeId) {
      const fileError = validateFile(alternativeId, 'id');
      if (fileError) { setError(fileError); return; }
    }

    setBusy(true);
    try {
      const { error: profileError } = await supabase.from('profiles')
        .update({ display_name: name.trim(), phone: cleanPhone })
        .eq('id', profile.id);
      if (profileError) throw profileError;

      let current = submission;
      if (!current) {
        const { data, error: createError } = await supabase.from('customer_verification_submissions')
          .insert({ customer_id: profile.id, status: 'draft' })
          .select('id, customer_id, profile_photo_path, student_id_path, is_student, alternative_id_type, alternative_id_path, status, submitted_at, created_at')
          .single();
        if (createError) throw createError;
        current = data as CustomerVerificationSubmission;
      }
      if (!['draft', 'needs_more_info'].includes(current.status)) {
        throw new Error('This submission is already with an administrator. Contact FixMate if you need to add information.');
      }

      let photoPath = current.profile_photo_path;
      let studentIdPath = isStudent ? current.student_id_path : null;
      let alternativeIdPath = isStudent ? null : current.alternative_id_path;
      if (photo) photoPath = await uploadPrivateFile(supabase, profile.id, current.id, photo, 'customer-photo');
      if (isStudent && studentId) studentIdPath = await uploadPrivateFile(supabase, profile.id, current.id, studentId, 'student-id');
      if (!isStudent && alternativeId) alternativeIdPath = await uploadPrivateFile(supabase, profile.id, current.id, alternativeId, `alternative-id-${alternativeIdType}`);
      if (!photoPath || (isStudent && !studentIdPath) || (!isStudent && (!alternativeIdPath || !alternativeIdType))) {
        throw new Error('Upload your profile photo and the ID that applies to your student status.');
      }

      const { data, error: submitError } = await supabase.from('customer_verification_submissions')
        .update({
          profile_photo_path: photoPath,
          student_id_path: studentIdPath,
          is_student: isStudent,
          alternative_id_type: isStudent ? null : alternativeIdType,
          alternative_id_path: alternativeIdPath,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', current.id)
        .select('id, customer_id, profile_photo_path, student_id_path, is_student, alternative_id_type, alternative_id_path, status, submitted_at, created_at')
        .single();
      if (submitError) throw submitError;
      setSubmission(data as CustomerVerificationSubmission);
      setPhoto(null);
      setStudentId(null);
      setAlternativeId(null);
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'We could not submit your documents. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading your private verification status…" />;
  const status = submission?.status;
  const canSubmit = !status || status === 'draft' || status === 'needs_more_info';
  const pending = status === 'submitted' || status === 'in_review';
  const rejected = status === 'rejected';
  const reviewLabel = status ? CUSTOMER_REVIEW_STATUSES[status] : 'Not submitted';
  const existingId = submission?.is_student ? submission.student_id_path : submission?.alternative_id_path;

  return (
    <WorkspaceShell profile={profile} roleLabel="Customer · pending approval" navItems={navItems} activeTab="verification" liveStatus={liveStatus} onTabChange={() => undefined} onSignOut={onSignOut}>
      <AppHeader eyebrow="CUSTOMER ACCOUNT" title={rejected ? 'Application not approved' : 'Verify your customer account'} detail="Customer accounts need administrator approval before using FixMate services." action={<Button variant="quiet" onClick={onSignOut}>Sign out</Button>} />
      {error && <Alert>{error}</Alert>}
      {status && <div className="status-banner"><div><strong>Review status · {reviewLabel}</strong><p>{status === 'needs_more_info' ? 'Please add the requested information and resubmit.' : pending ? 'Review is expected within 12 hours. If there is no update after 12 hours, contact FixMate support/admin.' : rejected ? 'Your submission was not approved. Contact FixMate if you need clarification.' : 'Complete the required private document submission.'}</p></div><StatusPill status={status} /></div>}
      {canSubmit ? (
        <Card className="card-pad onboarding-card">
          <div className="card-heading"><div><p className="eyebrow">PRIVATE DOCUMENT REVIEW</p><h2>Submit your details</h2><p>Only an authorized FixMate administrator can review these documents.</p></div><span className="onboarding-shield"><LockKeyhole size={21} /></span></div>
          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Full name"><input required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
              <Field label="WhatsApp contact" hint="Private account contact; not used to log in."><input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0812 345 6789" /></Field>
            </div>
            <Field label="Are you a student?">
              <select value={isStudent ? 'student' : 'non_student'} onChange={(event) => setIsStudent(event.target.value === 'student')}>
                <option value="student">Yes — I am a student</option>
                <option value="non_student">No — I am not a student</option>
              </select>
            </Field>
            <Field label="Profile photo" hint={`JPG or PNG · maximum 8 MB${submission?.profile_photo_path ? ' · a photo is already on file; choose a new one only to replace it' : ''}`}>
              <input type="file" accept="image/png,image/jpeg" required={!submission?.profile_photo_path} onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
            </Field>
            {isStudent ? (
              <Field label="Student ID" hint={`PDF, JPG, or PNG · maximum 8 MB${submission?.student_id_path ? ' · a student ID is already on file; choose a new one only to replace it' : ''}`}>
                <input type="file" accept="application/pdf,image/png,image/jpeg" required={!submission?.student_id_path} onChange={(event) => setStudentId(event.target.files?.[0] ?? null)} />
              </Field>
            ) : (
              <div className="form-grid">
                <Field label="Alternative ID type">
                  <select value={alternativeIdType} onChange={(event) => setAlternativeIdType(event.target.value as CustomerAlternativeIdType)}>
                    {ID_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Alternative ID" hint={`PDF, JPG, or PNG · maximum 8 MB${submission?.alternative_id_path ? ' · an ID is already on file; choose a new one only to replace it' : ''}`}>
                  <input type="file" accept="application/pdf,image/png,image/jpeg" required={!submission?.alternative_id_path} onChange={(event) => setAlternativeId(event.target.files?.[0] ?? null)} />
                </Field>
              </div>
            )}
            {(photo || studentId || alternativeId || existingId) && <div className="file-selection"><span><FileImage size={15} /> {photo?.name ?? (submission?.profile_photo_path ? 'Profile photo on file' : 'Choose profile photo')}</span><span><FileCheck2 size={15} /> {studentId?.name ?? alternativeId?.name ?? (existingId ? 'ID on file' : 'Choose the applicable ID')}</span></div>}
            <div className="privacy-notice"><LockKeyhole size={17} /><p>IDs are stored privately for administrator review. NIN is one optional alternative for non-students; it is not required of everyone. Never send an ID over WhatsApp.</p></div>
            <Button type="submit" disabled={busy}>{busy ? 'Uploading privately…' : <><FileUp size={17} /> Submit for administrator review</>}</Button>
          </form>
        </Card>
      ) : pending ? (
        <Card className="card-pad"><span className="onboarding-shield"><ShieldCheck size={22} /></span><h2>Thanks — your account is under review</h2><p className="muted">Review is expected within 12 hours. If you have not received an update after 12 hours, contact FixMate support/admin. Marketplace access stays locked until approval.</p><WhatsAppSupport supabase={supabase} /></Card>
      ) : (
        <Card className="card-pad"><span className="onboarding-shield"><ShieldCheck size={22} /></span><h2>{rejected ? 'Please contact FixMate' : 'Your details are on file'}</h2><p className="muted">The customer account cannot use the marketplace until administrator review is complete.</p><WhatsAppSupport supabase={supabase} /></Card>
      )}
    </WorkspaceShell>
  );
}

async function uploadPrivateFile(supabase: SupabaseClient, userId: string, submissionId: string, file: File, label: string): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${userId}/${submissionId}/${label}-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('fixmate-verification').upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw error;
  return path;
}

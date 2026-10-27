import { useEffect, useState, type FormEvent } from 'react';
import { FileCheck2, FileImage, FileUp, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppHeader, Alert, Button, Card, Field, LoadingState, StatusPill } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { WorkspaceShell, type WorkspaceNavItem } from '../../components/WorkspaceShell';
import { cleanWhatsAppNumber, CUSTOMER_REVIEW_STATUSES } from '../../lib/catalog';
import type { CustomerVerificationSubmission, Profile } from '../../lib/types';

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

export function CustomerOnboarding({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [submission, setSubmission] = useState<CustomerVerificationSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(profile.display_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [studentId, setStudentId] = useState<File | null>(null);

  async function loadSubmission() {
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('customer_verification_submissions')
      .select('id, customer_id, profile_photo_path, student_id_path, status, submitted_at, created_at')
      .eq('customer_id', profile.id)
      .maybeSingle();
    if (queryError) setError(queryError.message);
    else setSubmission(data as CustomerVerificationSubmission | null);
    setLoading(false);
  }

  useEffect(() => { void loadSubmission(); }, [profile.id]);

  function validateFile(file: File, kind: 'photo' | 'id'): string | null {
    const allowed = kind === 'photo'
      ? ['image/jpeg', 'image/png']
      : ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) return kind === 'photo' ? 'Use a JPG or PNG photo.' : 'Use a PDF, JPG, or PNG student ID image.';
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
    if (!studentId && !submission?.student_id_path) { setError('Upload your ABU student ID.'); return; }
    if (photo) {
      const fileError = validateFile(photo, 'photo');
      if (fileError) { setError(fileError); return; }
    }
    if (studentId) {
      const fileError = validateFile(studentId, 'id');
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
          .select('id, customer_id, profile_photo_path, student_id_path, status, submitted_at, created_at')
          .single();
        if (createError) throw createError;
        current = data as CustomerVerificationSubmission;
      }
      if (!['draft', 'needs_more_info'].includes(current.status)) {
        throw new Error('This submission is already with an administrator. Contact FixMate if you need to add information.');
      }

      let photoPath = current.profile_photo_path;
      let idPath = current.student_id_path;
      if (photo) photoPath = await uploadPrivateFile(supabase, profile.id, current.id, photo, 'customer-photo');
      if (studentId) idPath = await uploadPrivateFile(supabase, profile.id, current.id, studentId, 'abu-student-id');
      if (!photoPath || !idPath) throw new Error('Both required documents must be present before submission.');

      const { data, error: submitError } = await supabase.from('customer_verification_submissions')
        .update({
          profile_photo_path: photoPath,
          student_id_path: idPath,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', current.id)
        .select('id, customer_id, profile_photo_path, student_id_path, status, submitted_at, created_at')
        .single();
      if (submitError) throw submitError;
      setSubmission(data as CustomerVerificationSubmission);
      setPhoto(null);
      setStudentId(null);
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

  return (
    <WorkspaceShell profile={profile} roleLabel="Customer · pending approval" navItems={navItems} activeTab="verification" onTabChange={() => undefined} onSignOut={onSignOut}>
      <AppHeader eyebrow="CUSTOMER ACCOUNT" title={rejected ? 'Application not approved' : 'Verify your student account'} detail="Customer accounts need administrator approval before using FixMate services." action={<Button variant="quiet" onClick={onSignOut}>Sign out</Button>} />
      {error && <Alert>{error}</Alert>}
      {status && <div className="status-banner"><div><strong>Review status · {reviewLabel}</strong><p>{status === 'needs_more_info' ? 'Please add the requested information and resubmit.' : pending ? 'Your documents are with the FixMate administrator. Marketplace access stays locked until approval.' : rejected ? 'Your submission was not approved. Contact FixMate if you need clarification.' : 'Complete the required private document submission.'}</p></div><StatusPill status={status} /></div>}
      {canSubmit ? (
        <Card className="card-pad onboarding-card">
          <div className="card-heading"><div><p className="eyebrow">PRIVATE DOCUMENT REVIEW</p><h2>Submit your details</h2><p>Only an authorized FixMate administrator can review these documents.</p></div><span className="onboarding-shield"><LockKeyhole size={21} /></span></div>
          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Full name"><input required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
              <Field label="WhatsApp contact" hint="Private account contact; not used to log in."><input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0812 345 6789" /></Field>
            </div>
            <Field label="Profile photo" hint={`JPG or PNG · maximum 8 MB${submission?.profile_photo_path ? ' · a photo is already on file; choose a new one only to replace it' : ''}`}>
              <input type="file" accept="image/png,image/jpeg" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
            </Field>
            <Field label="ABU student ID" hint={`PDF, JPG, or PNG · maximum 8 MB${submission?.student_id_path ? ' · an ID is already on file; choose a new one only to replace it' : ''}`}>
              <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setStudentId(event.target.files?.[0] ?? null)} />
            </Field>
            {(photo || studentId) && <div className="file-selection"><span><FileImage size={15} /> {photo?.name ?? 'Photo already on file'}</span><span><FileCheck2 size={15} /> {studentId?.name ?? 'Student ID already on file'}</span></div>}
            <div className="privacy-notice"><LockKeyhole size={17} /><p>Files are stored in FixMate’s private verification bucket. Do not send your student ID over WhatsApp. NIN and date of birth are not required by default.</p></div>
            <Button type="submit" disabled={busy}>{busy ? 'Uploading privately…' : <><FileUp size={17} /> Submit for administrator review</>}</Button>
          </form>
        </Card>
      ) : pending ? (
        <Card className="card-pad"><span className="onboarding-shield"><ShieldCheck size={22} /></span><h2>Thanks — your account is under review</h2><p className="muted">An administrator will review your photo and ABU student ID. Marketplace features become available only after approval. If more details are needed, FixMate may contact you at your saved WhatsApp number.</p><WhatsAppSupport supabase={supabase} /></Card>
      ) : (
        <Card className="card-pad"><span className="onboarding-shield"><ShieldCheck size={22} /></span><h2>{rejected ? 'Please contact FixMate' : 'Your details are on file'}</h2><p className="muted">The customer account cannot use the marketplace until the administrator review is complete.</p><WhatsAppSupport supabase={supabase} /></Card>
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

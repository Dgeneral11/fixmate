export type FixmateRole = 'customer' | 'artisan' | 'administrator';
export type AccountStatus = 'pending_approval' | 'active' | 'rejected' | 'restricted';
export type ServiceCategory = 'electrical_repairs' | 'phone_computer_repair' | 'errands';
export type CustomerReviewStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'needs_more_info'
  | 'approved'
  | 'rejected';
export type ArtisanApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'needs_more_info'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'revoked';
export type RequestStatus = 'open' | 'accepted' | 'completed' | 'cancelled';
export type OfferStatus = 'pending' | 'accepted' | 'declined';
export type ComplaintStatus = 'submitted' | 'in_review' | 'resolved' | 'dismissed';

export interface Profile {
  id: string;
  role: FixmateRole;
  display_name: string;
  email: string | null;
  phone: string | null;
  account_status: AccountStatus;
}

export interface ServiceZone {
  id: string;
  zone_group: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface CustomerVerificationSubmission {
  id: string;
  customer_id: string;
  profile_photo_path: string | null;
  student_id_path: string | null;
  status: CustomerReviewStatus;
  submitted_at: string | null;
  created_at: string;
}

export interface ArtisanProfile {
  user_id: string;
  display_name: string;
  service_categories: ServiceCategory[];
  years_experience: number | null;
  service_area: string | null;
  bio: string | null;
  is_available: boolean;
}

export interface ArtisanApplication {
  id: string;
  artisan_id: string;
  route: 'trade_credential' | 'alternative_assessment';
  status: ArtisanApplicationStatus;
  applicant_notes: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface ArtisanDocument {
  id: string;
  application_id: string;
  uploaded_by: string;
  document_type:
    | 'identity_document'
    | 'trade_credential'
    | 'safety_evidence'
    | 'assessment_evidence'
    | 'in_person_evidence';
  storage_path: string;
  created_at: string;
}

export interface VerificationCheck {
  id: string;
  application_id: string;
  check_type: 'identity' | 'safety' | 'trade_credential' | 'alternative_assessment' | 'in_person';
  status: 'pending' | 'passed' | 'failed' | 'needs_more_info' | 'not_applicable';
  private_notes: string | null;
}

export interface CustomerRequest {
  id: string;
  customer_id: string;
  service_category: ServiceCategory;
  zone_id: string;
  title: string;
  description: string;
  status: RequestStatus;
  created_at: string;
}

export interface ArtisanOffer {
  id: string;
  request_id: string;
  artisan_id: string;
  quote_ngn: number | null;
  message: string;
  status: OfferStatus;
  created_at: string;
}

export interface RequestMessage {
  id: string;
  offer_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface JobReview {
  id: string;
  request_id: string;
  customer_id: string;
  artisan_id: string;
  rating: number;
  review: string;
  created_at: string;
}

export interface UserComplaint {
  id: string;
  request_id: string;
  reporter_id: string;
  subject_user_id: string;
  reason: 'safety' | 'workmanship' | 'communication' | 'conduct' | 'other';
  details: string;
  status: ComplaintStatus;
  created_at: string;
}

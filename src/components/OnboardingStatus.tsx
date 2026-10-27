import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card } from './ui';

export function OnboardingStatus({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return <Card className="card-pad onboarding-status"><span className="onboarding-shield"><ShieldCheck size={22} /></span><h2>{title}</h2><p className="muted">{detail}</p>{children}</Card>;
}

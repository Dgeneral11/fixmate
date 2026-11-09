import { useEffect, useState, type FormEvent } from 'react';
import { MessageCircle, Search, ShieldAlert, UserCheck, UserRoundSearch } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, Card, EmptyState, Field, LoadingState, StatusPill } from '../../components/ui';
import { formatDate, whatsAppLink } from '../../lib/catalog';
import type { AccountStatus, FixmateRole } from '../../lib/types';

interface AccountRow {
  id: string;
  role: FixmateRole;
  display_name: string;
  email: string | null;
  phone: string | null;
  account_status: AccountStatus;
  created_at: string;
}
const PAGE_SIZE = 400;

export function UserDirectory({ supabase, refreshRevision = 0 }: { supabase: SupabaseClient; refreshRevision?: number }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AccountRow[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searched, setSearched] = useState(false);
  const [stale, setStale] = useState(false);
  useEffect(() => { if (searched) setStale(true); }, [refreshRevision]);

  async function fetchAllPages(field?: 'display_name' | 'email' | 'phone', term?: string): Promise<AccountRow[]> {
    const collected: AccountRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let request = supabase.from('profiles').select('id, role, display_name, email, phone, account_status, created_at').order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (field && term) request = request.ilike(field, `%${term}%`);
      const { data, error: queryError } = await request;
      if (queryError) throw queryError;
      const page = (data ?? []) as AccountRow[];
      collected.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return collected;
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    setSearched(true);
    try {
      const term = query.trim().replace(/[%_\\]/g, '');
      const next = term
        ? await Promise.all(['display_name', 'email', 'phone'].map((field) => fetchAllPages(field as 'display_name' | 'email' | 'phone', term))).then((groups) => groups.flat())
        : await fetchAllPages();
      const unique = new Map<string, AccountRow>();
      for (const item of next) unique.set(item.id, item);
      setUsers([...unique.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))); setStale(false);
    } catch (searchError) {
      setUsers([]);
      setError(searchError instanceof Error ? searchError.message : 'Could not search FixMate accounts.');
    } finally {
      setLoading(false);
    }
  }

  async function restrict(user: AccountRow) {
    const reason = reasons[user.id]?.trim() ?? '';
    if (!reason) { setError('Add a reason before restricting the account.'); return; }
    setBusyId(user.id);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('fixmate_admin_set_account_status', {
      p_user_id: user.id,
      p_new_status: 'restricted',
      p_reason: reason,
    });
    if (rpcError) setError(rpcError.message);
    else { setNotice(`Account restricted: ${user.display_name || user.email || user.id}.`); setReasons((current) => ({ ...current, [user.id]: '' })); await runSearch(); }
    setBusyId('');
  }

  async function restore(user: AccountRow) {
    setBusyId(user.id);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('fixmate_admin_restore_account', {
      p_user_id: user.id,
      p_reason: 'Restored by administrator after review',
    });
    if (rpcError) setError(rpcError.message);
    else { setNotice(`Account restore recorded for ${user.display_name || user.email || user.id}.`); await runSearch(); }
    setBusyId('');
  }

  return <section className="admin-section">
    <div className="admin-toolbar"><div><p className="eyebrow">PRIVATE ACCOUNT DIRECTORY</p><h2>Search all users</h2><p className="muted">Searches name, email, and WhatsApp contact. WhatsApp numbers are visible only to authorized administrators.</p></div><UserRoundSearch size={23} color="#00875a" /></div>
    <form className="directory-search" onSubmit={(event) => void runSearch(event)}><Field label="Search every account"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, or WhatsApp number" autoComplete="off" /></Field><Button type="submit" disabled={loading}><Search size={15} /> Search</Button></form>
    {stale && searched && <div className="field__hint" role="status">Account data may have changed. <Button variant="quiet" disabled={loading} onClick={() => void runSearch()}>Search again</Button></div>}{error && <Alert>{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    {loading ? <LoadingState label="Searching accounts…" /> : !users.length ? error ? <EmptyState title="Account search could not complete" detail="A live FixMate query failed. Retry before assuming there are no matching accounts." action={<Button variant="secondary" onClick={() => void runSearch()}>Retry search</Button>} /> : <EmptyState title={searched ? 'No accounts matched' : 'Search FixMate accounts'} detail={searched ? 'No account matched this search in the current FixMate project.' : 'Enter a name, email, or WhatsApp number to search all saved accounts.'} /> : <div className="user-directory-grid">{users.map((user) => <Card key={user.id} className="user-admin-card"><div className="list-card__top"><div><p className="eyebrow">{user.role}</p><h3>{user.display_name || 'No name set'}</h3></div><StatusPill status={user.account_status} /></div><div className="user-admin-meta"><span>{user.email || 'No email saved'}</span><span>{user.phone || 'No WhatsApp contact saved'}</span><small>Created {formatDate(user.created_at)}</small></div>{user.phone && <a className="inline-link" href={whatsAppLink(user.phone, `Hello ${user.display_name || 'there'}, FixMate is contacting you about your account.`)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp draft</a>}{user.role !== 'administrator' && (user.account_status === 'restricted' ? <Button variant="secondary" disabled={busyId === user.id} onClick={() => void restore(user)}><UserCheck size={15} /> Restore account</Button> : <div className="user-restrict-controls"><Field label="Restriction reason"><input value={reasons[user.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [user.id]: event.target.value }))} maxLength={2000} placeholder="Required for audit log" /></Field><Button variant="danger" disabled={busyId === user.id} onClick={() => void restrict(user)}><ShieldAlert size={15} /> Restrict</Button></div>)}</Card>)}</div>}
  </section>;
}

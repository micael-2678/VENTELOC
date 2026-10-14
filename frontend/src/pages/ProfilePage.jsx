import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Download, KeyRound, Loader2, Mail, MailCheck, MailWarning, ShieldCheck, Trash2, UserRound, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { axiosInstance } from '@/App';
import { goBack, homePathFor } from '@/lib/navigation';
import { usePrivateSeo } from '@/lib/seo';
import { BRAND } from '@/lib/brand';
import AppHeader from '@/components/layout/AppHeader';
import PageBar from '@/components/layout/PageBar';
import { KYCStatus, KYCVerificationButton, identityPurpose } from '@/components/KYCVerification';
import EmailVerificationBanner from '@/components/EmailVerificationBanner';
import BuyerProfileFields from '@/components/account/BuyerProfileFields';
import ScoreMeter from '@/components/account/ScoreMeter';
import { apiErrorMessage } from '@/components/account/errors';
import { computeProfileScore, buyerProfilePayload, buyerProfileFromUser } from '@/components/account/profileScore';

// Mon profil (SPEC §4, API.md §1) : coordonnées et profil d'investisseur de l'acquéreur (PUT /auth/profile), e-mail
// confirmé, identité via Stripe Identity (demandée avant l'engagement de confidentialité pour un acquéreur, avant le
// mandat pour un vendeur), préférence notifications, mot de passe, export (GET /auth/export) et suppression
// (DELETE /auth/account {password}). Aucun envoi de pièces d'identité.

const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';
const ROLE_LABEL = { seller: 'Vendeur', buyer: 'Acquéreur', admin: 'Administration' };

const Card = ({ title, icon: Icon, children, intro, id, testId }) => (
  <section className="card p-5 sm:p-6 min-w-0" aria-labelledby={id} data-testid={testId}>
    <h2 id={id} className="font-display text-lg font-bold text-brand-navy flex items-center gap-2">
      {Icon && <Icon className="w-5 h-5 text-brand-navy" aria-hidden="true" />}
      {title}
    </h2>
    {intro && <p className="text-sm text-gray-600 mt-1 leading-relaxed">{intro}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const storeUser = (fresh, setUser) => {
  try { localStorage.setItem('user', JSON.stringify(fresh)); } catch (e) { /* stockage indisponible */ }
  if (typeof setUser === 'function') setUser(fresh);
};

const ProfilePage = ({ user, setUser }) => {
  usePrivateSeo('Mon profil');
  const navigate = useNavigate();
  const [profile, setProfile] = useState(user);
  const [identity, setIdentity] = useState({ first_name: '', last_name: '', phone: '' });
  const [buyerProfile, setBuyerProfile] = useState(buyerProfileFromUser(user?.buyer_profile));
  const [optOut, setOptOut] = useState(!!user?.notifications_opt_out);
  const [saving, setSaving] = useState('');
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm: '' });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const applyUser = (fresh) => {
    setProfile(fresh);
    setIdentity({
      first_name: fresh.first_name || '',
      last_name: fresh.last_name || '',
      phone: fresh.phone || '',
    });
    setBuyerProfile(buyerProfileFromUser(fresh.buyer_profile));
    setOptOut(!!fresh.notifications_opt_out);
  };

  useEffect(() => {
    if (user) applyUser(user);
    axiosInstance.get('/auth/profile').then((res) => {
      applyUser(res.data);
      storeUser(res.data, setUser);
    }).catch(() => null);
  }, []);

  const isSeller = profile?.role === 'seller';
  const isBuyer = profile?.role === 'buyer';
  const isVerified = !!(profile?.identity_verified || profile?.kyc_status === 'verified' || profile?.kyc_status === 'approved');
  const localScore = useMemo(() => computeProfileScore(buyerProfile, identity.phone), [buyerProfile, identity.phone]);
  const serverScore = Number.isFinite(Number(profile?.profile_score)) ? Number(profile.profile_score) : null;

  const save = async (key, body, successMessage) => {
    setSaving(key);
    try {
      const res = await axiosInstance.put('/auth/profile', body);
      const fresh = res.data?.user || res.data;
      if (fresh && fresh.email) {
        applyUser(fresh);
        storeUser(fresh, setUser);
      }
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Les modifications n\'ont pas pu être enregistrées.'));
      return false;
    } finally {
      setSaving('');
    }
  };

  const saveIdentity = async (e) => {
    e.preventDefault();
    const body = {
      first_name: identity.first_name.trim(),
      last_name: identity.last_name.trim(),
      phone: identity.phone.trim(),
    };
    await save('identity', body, 'Coordonnées enregistrées');
  };

  const saveBuyerProfile = async (e) => {
    e.preventDefault();
    const body = { buyer_profile: buyerProfilePayload(buyerProfile), phone: identity.phone.trim() };
    if (body.buyer_profile.company_name) body.company_name = body.buyer_profile.company_name;
    await save('buyer', body, 'Profil d\'investisseur enregistré');
  };

  const toggleNotifications = async (checked) => {
    const previous = optOut;
    setOptOut(!checked);
    const ok = await save('notifications', { notifications_opt_out: !checked }, checked ? 'Vous recevrez les e-mails d\'information.' : 'E-mails d\'information désactivés.');
    if (!ok) setOptOut(previous);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passwords.new_password.length < 8) {
      toast.error('Le nouveau mot de passe doit contenir au moins 8 caractères');
      return;
    }
    if (passwords.new_password !== passwords.confirm) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }
    setSaving('password');
    try {
      const res = await axiosInstance.post('/auth/change-password', {
        current_password: passwords.current_password,
        new_password: passwords.new_password,
      });
      // Les anciens jetons sont révoqués : on remplace celui de la session
      if (res.data?.token) localStorage.setItem('token', res.data.token);
      toast.success(res.data?.message || 'Mot de passe modifié');
      setPasswords({ current_password: '', new_password: '', confirm: '' });
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Le mot de passe n\'a pas pu être modifié'));
    } finally {
      setSaving('');
    }
  };

  const exportData = async () => {
    setSaving('export');
    try {
      const res = await axiosInstance.get('/auth/export');
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${BRAND.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Export téléchargé (fichier JSON).');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'L\'export n\'a pas pu être généré'));
    } finally {
      setSaving('');
    }
  };

  const deleteAccount = async (e) => {
    e.preventDefault();
    if (!deletePassword) return;
    setSaving('delete');
    try {
      await axiosInstance.delete('/auth/account', { data: { password: deletePassword } });
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (typeof setUser === 'function') setUser(null);
      toast.success('Votre compte a été supprimé et vos données personnelles anonymisées.');
      navigate('/');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Le compte n\'a pas pu être supprimé'));
    } finally {
      setSaving('');
    }
  };

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-brand-surface">
      <AppHeader user={profile} setUser={setUser} />
      <PageBar onBack={() => goBack(navigate, homePathFor(profile))} title="Mon profil" width="max-w-5xl" />

      <main id="contenu" className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6 min-w-0">
        {/* Compte et e-mail */}
        <Card id="profile-account" title="Mon compte" icon={Mail} testId="user-info">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-brand-navy break-all" data-testid="user-email">{profile.email}</p>
              <p className="text-sm text-gray-600">{ROLE_LABEL[profile.role] || profile.role} · inscrit le {profile.created_at ? new Date(profile.created_at).toLocaleDateString('fr-FR') : '—'}</p>
            </div>
            {profile.email_verified === false ? (
              <span className="badge badge-warning"><MailWarning className="w-3.5 h-3.5" aria-hidden="true" />E-mail à confirmer</span>
            ) : (
              <span className="badge badge-verified"><MailCheck className="w-3.5 h-3.5" aria-hidden="true" />E-mail confirmé</span>
            )}
          </div>
          {profile.email_verified === false && (
            <div className="mt-4 rounded-xl overflow-hidden border border-brand-amber/30">
              <EmailVerificationBanner user={profile} setUser={(fresh) => { applyUser(fresh); storeUser(fresh, setUser); }} compact />
            </div>
          )}
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Coordonnées */}
          <Card id="profile-identity" title="Mes coordonnées" icon={UserRound} intro="Jamais publiées : votre nom n'est communiqué qu'après un engagement de confidentialité signé.">
            <form onSubmit={saveIdentity} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="profile-first-name" className="block text-sm font-semibold text-brand-navy mb-1">Prénom</label>
                  <input id="profile-first-name" autoComplete="given-name" value={identity.first_name} onChange={(e) => setIdentity({ ...identity, first_name: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label htmlFor="profile-last-name" className="block text-sm font-semibold text-brand-navy mb-1">Nom</label>
                  <input id="profile-last-name" autoComplete="family-name" value={identity.last_name} onChange={(e) => setIdentity({ ...identity, last_name: e.target.value })} className={inputClass} required />
                </div>
              </div>
              <div>
                <label htmlFor="profile-phone" className="block text-sm font-semibold text-brand-navy mb-1">Téléphone</label>
                <input id="profile-phone" type="tel" autoComplete="tel" value={identity.phone} onChange={(e) => setIdentity({ ...identity, phone: e.target.value })} className={inputClass} placeholder="06 12 34 56 78" />
              </div>
              <button type="submit" disabled={saving === 'identity'} className="btn-primary w-full sm:w-auto" data-testid="profile-save-identity">
                {saving === 'identity' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Enregistrer
              </button>
            </form>
          </Card>

          {/* Identité (Stripe) */}
          <Card id="profile-kyc" title="Vérification d'identité" icon={ShieldCheck} intro={identityPurpose(profile.role)} testId="kyc-section">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">Statut</p>
                <KYCStatus user={profile} />
                {isVerified && <span className="badge badge-verified mt-2" data-testid="kyc-status-badge"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Identité vérifiée</span>}
              </div>
              {!isVerified && profile?.role === 'buyer' && (
                // Acquéreur : la vérification (payante à l'usage) n'est ouverte qu'avant l'engagement de confidentialité,
                // depuis le dossier du bien, après acceptation de la demande par le vendeur
                <p className="text-sm text-gray-700 leading-relaxed" data-testid="kyc-buyer-later">
                  Elle vous sera demandée avant de signer l'engagement de confidentialité, une fois votre demande de dossier acceptée par le vendeur : pièce d'identité et selfie, en 3 minutes, via Stripe Identity. Seul le résultat est conservé, jamais les images.
                </p>
              )}
              {!isVerified && isSeller && (
                <>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Elle est demandée avant la signature du mandat : pièce d'identité et selfie, en 3 minutes, via Stripe Identity. Seul le résultat est conservé, jamais les images.
                  </p>
                  <KYCVerificationButton user={profile} className="w-full rounded-xl" />
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Profil acquéreur */}
        {isBuyer && (
          <Card id="profile-buyer" title="Mon projet d'investissement" icon={TrendingUp} intro="C'est la carte que les vendeurs lisent avant de vous répondre, sans votre nom tant que l'engagement de confidentialité n'est pas signé." testId="buyer-profile-section">
            <form onSubmit={saveBuyerProfile} className="space-y-6">
              <ScoreMeter score={serverScore ?? localScore.score} missing={localScore.missing} />
              <BuyerProfileFields value={buyerProfile} onChange={setBuyerProfile} />
              <button type="submit" disabled={saving === 'buyer'} className="btn-primary w-full sm:w-auto" data-testid="profile-save-buyer">
                {saving === 'buyer' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Enregistrer mon projet
              </button>
            </form>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Notifications */}
          <Card id="profile-notifications" title="Notifications" icon={Bell}>
            <div className="flex items-start gap-3">
              <input id="profile-notifications-toggle" type="checkbox" checked={!optOut} onChange={(e) => toggleNotifications(e.target.checked)} disabled={saving === 'notifications'}
                aria-describedby="profile-notifications-hint"
                className="mt-1 h-5 w-5 rounded border-gray-400 text-brand-navy focus:ring-brand-blue" data-testid="profile-notifications-toggle" />
              <div className="min-w-0">
                <label htmlFor="profile-notifications-toggle" className="block font-semibold text-brand-navy cursor-pointer">Recevoir les e-mails d'information</label>
                <p id="profile-notifications-hint" className="text-sm text-gray-600 leading-relaxed">
                  Point hebdomadaire, nouvelles annonces, conseils et rappels. Les e-mails liés à vos démarches (contacts, signatures, dossiers, offres, factures) sont toujours envoyés.
                </p>
              </div>
            </div>
          </Card>

          {/* Mot de passe */}
          <Card id="profile-password" title="Mot de passe" icon={KeyRound}>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label htmlFor="current-password" className="block text-sm font-semibold text-brand-navy mb-1">Mot de passe actuel</label>
                <input id="current-password" type="password" autoComplete="current-password" required className={inputClass}
                  value={passwords.current_password} onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-semibold text-brand-navy mb-1">Nouveau (8 caractères min.)</label>
                  <input id="new-password" type="password" autoComplete="new-password" minLength={8} required className={inputClass}
                    value={passwords.new_password} onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-semibold text-brand-navy mb-1">Confirmation</label>
                  <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required className={inputClass}
                    value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
                </div>
              </div>
              <button type="submit" disabled={saving === 'password'} className="btn-primary w-full sm:w-auto">
                {saving === 'password' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Changer le mot de passe
              </button>
            </form>
          </Card>
        </div>

        {/* Données */}
        <Card id="profile-data" title="Mes données" icon={Download} intro="Conformément au RGPD : export complet en JSON, suppression du compte avec anonymisation. Les mandats, factures et preuves de signature sont conservés le temps légal (10 ans), sans vos données personnelles dans le compte.">
          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" onClick={exportData} disabled={saving === 'export'} className="btn-secondary w-full sm:w-auto" data-testid="profile-export-btn">
              {saving === 'export' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
              Exporter mes données
            </button>
            {profile.role !== 'admin' && (
              <button type="button" onClick={() => setDeleteOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-red-700 border border-red-200 bg-white hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 w-full sm:w-auto" data-testid="profile-delete-btn">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                Supprimer mon compte
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">
            Durées de conservation détaillées dans la <Link to="/confidentialite" className="underline">politique de confidentialité</Link>.
          </p>
        </Card>
      </main>

      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeletePassword(''); }}>
        <DialogContent className="max-w-md">
          <form onSubmit={deleteAccount}>
            <DialogHeader>
              <DialogTitle>Supprimer mon compte</DialogTitle>
              <DialogDescription>
                Vos données personnelles seront anonymisées et vos annonces retirées. Cette action est définitive. Les mandats, factures et preuves de signature sont conservés le temps légal, sans votre identité dans le compte.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <label htmlFor="delete-password" className="block text-sm font-semibold text-brand-navy mb-1">Confirmez avec votre mot de passe</label>
              <input id="delete-password" type="password" autoComplete="current-password" required value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} className={inputClass} data-testid="profile-delete-password" />
            </div>
            <DialogFooter className="gap-2">
              <button type="button" onClick={() => setDeleteOpen(false)} className="btn-secondary">Annuler</button>
              <button type="submit" disabled={saving === 'delete' || !deletePassword} className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" data-testid="profile-delete-confirm">
                {saving === 'delete' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Supprimer définitivement
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProfilePage;

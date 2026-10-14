import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import { homePathFor } from '@/lib/navigation';
import NotFound from '@/pages/NotFound';
import ConnectedShell from '@/components/buyer/ConnectedShell';
import ClosingPanel from '@/components/closing/ClosingPanel';

// /vente/:closingId (API.md §7, SPEC §4.5) : étape de vente, pour le cédant comme pour le repreneur.
// GET /closing/{id} → vue (role, status, redacteur, declaration, invoice…) rendue par ClosingPanel.

const ClosingPage = ({ user, setUser }) => {
  const { closingId } = useParams();
  usePrivateSeo('Étape de vente');
  const [closing, setClosing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axiosInstance.get(`/closing/${closingId}`);
      setClosing(res.data);
      setMissing(false);
    } catch (error) {
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, [closingId]);

  useEffect(() => { load(); }, [load]);

  // Chaque action renvoie la vue à jour ; sans vue, on relit le serveur
  const onChange = async (next) => {
    if (next && next.id) setClosing(next);
    else await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement">
        <div className="spinner" />
      </div>
    );
  }
  if (missing || !closing) return <NotFound user={user} />;

  const home = homePathFor(user);
  const backLabel = user?.role === 'seller' ? 'Mon espace' : 'Mes dossiers';

  return (
    <ConnectedShell
      user={user}
      setUser={setUser}
      title="Étape de vente"
      eyebrow={closing.company_title || closing.company_label || undefined}
      backTo={home}
      backLabel={backLabel}
      wide
      actions={closing.company_id ? <Link to={`/company/${closing.company_id}`} className="btn-secondary px-4 py-2 text-sm">Voir l&apos;annonce</Link> : null}
    >
      <ClosingPanel closing={closing} user={user} onChange={onChange} />
    </ConnectedShell>
  );
};

export default ClosingPage;

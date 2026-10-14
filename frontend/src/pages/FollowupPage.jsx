import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { axiosInstance } from '@/App';
import { useSeo, NOINDEX } from '@/lib/seo';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import AuthShell from '@/components/account/AuthShell';
import { apiErrorMessage } from '@/components/account/errors';

// Page publique ouverte depuis l'e-mail de suivi d'une mise en relation : /suivi?token=XXX&r=<réponse>
// POST /followup/{token} {answer, comment?} → {label}. Les valeurs de réponse sont des identifiants techniques
// inchangés ; seuls les libellés sont propres à la vente d'un bien loué.

export const FOLLOWUP_ANSWERS = [
  { value: 'en_discussion', label: 'Toujours en discussion' },
  { value: 'rencontre', label: 'Visite faite ou prévue' },
  { value: 'accord', label: 'Nous avons trouvé un accord' },
  { value: 'pas_de_suite', label: 'Pas de suite donnée' },
];

const FollowupPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const initialAnswer = searchParams.get('r');
  const [answer, setAnswer] = useState(null);
  const [label, setLabel] = useState('');
  const [comment, setComment] = useState('');
  const [commentSent, setCommentSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(!token);
  const sentInitial = useRef(false);

  useSeo(`Suivi de votre mise en relation – ${BRAND.name}`, 'Dites-nous où en est votre échange au sujet de ce bien.', { robots: NOINDEX });

  const submit = async (value, withComment = false) => {
    if (!token) return;
    setLoading(true);
    try {
      const body = { answer: value };
      if (withComment && comment.trim()) body.comment = comment.trim();
      const res = await axiosInstance.post(`/followup/${encodeURIComponent(token)}`, body);
      setAnswer(value);
      setLabel(res.data?.label || FOLLOWUP_ANSWERS.find((a) => a.value === value)?.label || '');
      if (withComment) {
        setCommentSent(true);
        toast.success('Merci pour votre commentaire.');
      }
    } catch (error) {
      const status = error.response?.status;
      if (status === 400 || status === 404) {
        setInvalid(true);
      } else {
        toast.error(apiErrorMessage(error, 'Votre réponse n\'a pas pu être enregistrée. Réessayez dans quelques instants.'));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sentInitial.current) return;
    sentInitial.current = true;
    if (token && FOLLOWUP_ANSWERS.some((a) => a.value === initialAnswer)) {
      submit(initialAnswer);
    }
  }, []); // réponse du lien de l'e-mail enregistrée une seule fois, à l'ouverture

  return (
    <AuthShell
      title="Suivi de votre mise en relation"
      subtitle={invalid ? undefined : 'Votre réponse nous aide à vous accompagner jusqu\'à la signature chez le notaire.'}
      testId="followup-page"
      footer={<Link to="/" className="font-semibold text-brand-navy hover:underline" aria-label={`${BRAND.name} – accueil`}>Retour à l&apos;accueil</Link>}
    >
      {invalid ? (
        <div className="text-center space-y-3" role="alert" data-testid="followup-invalid">
          <AlertCircle className="w-10 h-10 text-red-700 mx-auto" aria-hidden="true" />
          <p className="text-gray-700">Ce lien de suivi est invalide ou a expiré.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {answer ? (
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-center" role="status" data-testid="followup-done">
              <CheckCircle2 className="w-8 h-8 text-brand-navy mx-auto mb-2" aria-hidden="true" />
              <p className="font-semibold text-brand-navy">Merci pour votre réponse.</p>
              <p className="text-sm text-gray-700 mt-1">Réponse enregistrée : « {label} »</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center text-gray-600 py-4" role="status">
              <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
              Enregistrement de votre réponse…
            </div>
          ) : (
            <p className="text-gray-700 text-center">Où en est votre échange au sujet de ce bien ?</p>
          )}

          <fieldset>
            <legend className={cn('text-sm text-gray-600 mb-3', !answer && 'sr-only')}>{answer ? 'Vous pouvez modifier votre réponse :' : 'Votre réponse'}</legend>
            <div className="grid sm:grid-cols-2 gap-3">
              {FOLLOWUP_ANSWERS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  aria-pressed={answer === a.value}
                  className={cn(answer === a.value ? 'btn-primary' : 'btn-secondary', 'w-full py-3 whitespace-normal')}
                  disabled={loading}
                  onClick={() => submit(a.value)}
                  data-testid={`followup-answer-${a.value}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </fieldset>

          {answer && (
            <div className="space-y-2">
              <label htmlFor="followup-comment" className="block text-sm font-semibold text-brand-navy">Un commentaire ? <span className="font-normal text-gray-500">(facultatif)</span></label>
              <textarea
                id="followup-comment"
                value={comment}
                onChange={(e) => { setComment(e.target.value); setCommentSent(false); }}
                placeholder="Visite, avant-contrat, difficultés rencontrées, suggestions…"
                className="w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                rows={4}
                maxLength={2000}
              />
              <button
                type="button"
                onClick={() => submit(answer, true)}
                disabled={loading || !comment.trim() || commentSent}
                className="btn-primary w-full py-3"
                data-testid="followup-comment-send"
              >
                {commentSent ? 'Commentaire envoyé' : loading ? 'Envoi…' : 'Envoyer mon commentaire'}
              </button>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
};

export default FollowupPage;

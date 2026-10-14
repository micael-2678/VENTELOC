import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { Building2, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { useSeo, NOINDEX } from '@/lib/seo';
import { BRAND } from '@/lib/brand';
import { apiErrorMessage } from '@/components/account/errors';

const ANSWERS = [
  { value: 'en_discussion', label: 'Toujours en discussion' },
  { value: 'rencontre', label: 'Nous nous sommes rencontrés' },
  { value: 'accord', label: 'Nous avons trouvé un accord' },
  { value: 'pas_de_suite', label: "Pas de suite donnée" },
];

// Page publique ouverte depuis l'email de suivi à 30 jours : /suivi?token=XXX&r=<answer>
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

  useSeo(`Suivi de votre mise en relation – ${BRAND.name}`, 'Dites-nous où en est votre projet de reprise.', { robots: NOINDEX });

  const submit = async (value, withComment = false) => {
    if (!token) return;
    setLoading(true);
    try {
      const body = { answer: value };
      if (withComment && comment.trim()) body.comment = comment.trim();
      const res = await axiosInstance.post(`/followup/${encodeURIComponent(token)}`, body);
      setAnswer(value);
      setLabel(res.data?.label || ANSWERS.find((a) => a.value === value)?.label || '');
      if (withComment) {
        setCommentSent(true);
        toast.success('Merci pour votre commentaire !');
      }
    } catch (error) {
      const status = error.response?.status;
      if (status === 400 || status === 404) {
        setInvalid(true);
      } else {
        toast.error(apiErrorMessage(error, "Votre réponse n'a pas pu être enregistrée. Réessayez dans quelques instants."));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sentInitial.current) return;
    sentInitial.current = true;
    if (token && ANSWERS.some((a) => a.value === initialAnswer)) {
      submit(initialAnswer);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-4 py-12">
      <div className="card max-w-lg w-full p-8" data-testid="followup-page">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <Building2 className="w-12 h-12 text-[#090e1c]" />
          </div>
          <h1 className="text-2xl font-bold text-[#090e1c] mb-2">Suivi de votre mise en relation</h1>
        </div>

        {invalid ? (
          <div className="text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
            <p className="text-gray-700">Ce lien de suivi est invalide ou a expiré.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {answer ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                <CheckCircle className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <p className="font-semibold text-emerald-800">Merci pour votre réponse !</p>
                <p className="text-sm text-emerald-700 mt-1">Réponse enregistrée : « {label} »</p>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center text-gray-500 py-4">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Enregistrement de votre réponse...
              </div>
            ) : (
              <p className="text-gray-700 text-center">Où en est votre échange avec le cédant ?</p>
            )}

            <div>
              {answer && <p className="text-sm text-gray-600 mb-3">Vous pouvez modifier votre réponse :</p>}
              <div className="grid sm:grid-cols-2 gap-3">
                {ANSWERS.map((a) => (
                  <Button
                    key={a.value}
                    type="button"
                    variant={answer === a.value ? 'default' : 'outline'}
                    className={`rounded-xl h-auto py-3 whitespace-normal ${answer === a.value ? 'bg-[#090e1c] hover:bg-[#1a1e3e]' : ''}`}
                    disabled={loading}
                    onClick={() => submit(a.value)}
                    data-testid={`followup-answer-${a.value}`}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>

            {answer && (
              <div className="space-y-2">
                <Label htmlFor="followup-comment">Un commentaire ? (optionnel)</Label>
                <Textarea
                  id="followup-comment"
                  value={comment}
                  onChange={(e) => { setComment(e.target.value); setCommentSent(false); }}
                  placeholder="Dites-nous en plus : difficultés rencontrées, suggestions..."
                  className="rounded-xl"
                  rows={4}
                />
                <Button
                  type="button"
                  onClick={() => submit(answer, true)}
                  disabled={loading || !comment.trim() || commentSent}
                  className="w-full bg-[#090e1c] hover:bg-[#1a1e3e] rounded-xl"
                >
                  {commentSent ? 'Commentaire envoyé' : loading ? 'Envoi...' : 'Envoyer mon commentaire'}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-center">
          <Link to="/" className="text-[#090e1c] font-semibold hover:underline" aria-label={`${BRAND.name} – accueil`}>Retour à l'accueil</Link>
        </div>
      </div>
    </div>
  );
};

export default FollowupPage;

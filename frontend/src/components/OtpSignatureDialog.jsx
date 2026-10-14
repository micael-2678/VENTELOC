import { useCallback, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { FileSignature, FlaskConical, Loader2, Mail, PenTool, ShieldCheck, X, AlertCircle, ChevronDown, ChevronUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { axiosInstance } from '@/App';
import { useTestMode } from '@/lib/testMode';

// Message d'erreur lisible à partir d'une erreur axios (FastAPI : detail texte, {code, message} ou liste 422)
export const apiErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.message) return String(detail.message);
  if (Array.isArray(detail) && detail.length) return detail.map((d) => d?.msg || String(d)).join(' ');
  const status = error?.response?.status;
  if (status === 400) return 'Code invalide ou expiré.';
  if (status === 429) return 'Trop de tentatives. Patientez quelques instants avant de réessayer.';
  return fallback;
};

const DEFAULT_RESEND = 60;
const SCROLL_TOLERANCE = 12;
// Zone de lecture défilable : focusable au clavier (la valeur est une constante, pas un littéral JSX)
const DOC_TABINDEX = 0;

// Signature électronique par code à usage unique envoyé par e-mail (SPEC §3.5).
// Étapes : résumé (facultatif) → lecture du texte intégral jusqu'à la fin → acceptation → envoi du code → saisie → onSign.
// - `summary` : lignes affichées au-dessus du texte ; avec un résumé, le texte intégral est replié par défaut (dépliable) ;
// - la case « J'ai lu » n'est activée qu'une fois le texte intégral parcouru jusqu'en bas (ou s'il tient sans défilement) ;
// - onSign(otpCode) renvoie une promesse ; en cas d'échec, le message du serveur est affiché ici.
// - mode test (MODE-TEST-ET-APP.md §B.2.2) : POST /signatures/request-code renvoie aussi `test_code` (jamais hors mode
//   test) ; il est affiché dans un encadré avec un bouton « Remplir ».
const OtpSignatureDialog = ({
  open,
  onClose,
  title,
  subtitle,
  contractId,
  documentText,
  summary,
  termsDate,
  extraContent,
  canRequest = true,
  acceptLabel = 'J\'ai lu et j\'accepte les termes de ce document. Je comprends que cette signature électronique a valeur juridique.',
  signLabel = 'Signer',
  onSign,
}) => {
  const hasSummary = Array.isArray(summary) && summary.length > 0;
  const hasDocument = typeof documentText === 'string' && documentText.trim().length > 0;
  const [expanded, setExpanded] = useState(!hasSummary);
  const [readToEnd, setReadToEnd] = useState(!hasDocument);
  const [accepted, setAccepted] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const { testMode } = useTestMode();
  const [sent, setSent] = useState(null); // { destination, expires_in, test_code? }
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState('');
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef(null);
  const docRef = useRef(null);

  // Réinitialisation à chaque ouverture / changement de document
  useEffect(() => {
    if (open) {
      setExpanded(!hasSummary);
      setReadToEnd(!hasDocument);
      setAccepted(false);
      setSent(null);
      setCooldown(0);
      setCode('');
      setError('');
    }
  }, [open, contractId, hasSummary, hasDocument]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const checkScrolled = useCallback(() => {
    const el = docRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_TOLERANCE) setReadToEnd(true);
  }, []);

  // Texte court qui tient sans défilement : la lecture est considérée faite dès l'affichage
  useEffect(() => {
    if (!open || !expanded || !hasDocument) return undefined;
    const t = setTimeout(checkScrolled, 50);
    return () => clearTimeout(t);
  }, [open, expanded, hasDocument, documentText, checkScrolled]);

  const requestCode = async () => {
    if (!accepted || !canRequest || requesting || cooldown > 0) return;
    setRequesting(true);
    setError('');
    try {
      const res = await axiosInstance.post('/signatures/request-code', { contract_id: contractId });
      const data = res.data || {};
      const testCode = data.test_code != null ? String(data.test_code).replace(/\D/g, '').slice(0, 6) : '';
      setSent({ destination: data.destination || 'votre adresse e-mail', expires_in: data.expires_in, test_code: testCode.length === 6 ? testCode : '' });
      setCooldown(Number(data.resend_after) > 0 ? Number(data.resend_after) : DEFAULT_RESEND);
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'envoyer le code. Réessayez dans quelques instants.'));
      if (e?.response?.status === 429) {
        const retry = Number(e.response.headers?.['retry-after']);
        setCooldown(retry > 0 ? retry : DEFAULT_RESEND);
      }
    } finally {
      setRequesting(false);
    }
  };

  const sign = async (e) => {
    e?.preventDefault();
    if (code.length !== 6 || signing || !accepted || !canRequest) return;
    setSigning(true);
    setError('');
    try {
      await onSign(code);
    } catch (err) {
      setError(apiErrorMessage(err, 'La signature n\'a pas pu être enregistrée. Réessayez.'));
    } finally {
      setSigning(false);
    }
  };

  const expiresMin = sent?.expires_in ? Math.round(sent.expires_in / 60) : null;
  const canAccept = readToEnd || !hasDocument;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o && !signing) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-1.5rem)] max-w-3xl max-h-[92vh] flex flex-col bg-white rounded-2xl shadow-xl focus:outline-none"
          data-testid="otp-signature-dialog"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3 p-4 sm:px-6 border-b bg-brand-navy text-white rounded-t-2xl">
            <div className="flex items-start gap-3 min-w-0">
              <FileSignature className="w-6 h-6 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <DialogPrimitive.Title className="font-display font-bold text-lg leading-snug break-words">{title}</DialogPrimitive.Title>
                {(subtitle || termsDate) && (
                  <p className="text-sm text-gray-300 break-words">
                    {subtitle}
                    {subtitle && termsDate ? ' · ' : ''}
                    {termsDate ? `Version du ${termsDate}` : ''}
                  </p>
                )}
              </div>
            </div>
            <DialogPrimitive.Close
              className="shrink-0 rounded-lg p-1.5 text-white/80 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Fermer"
              disabled={signing}
            >
              <X className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4 sm:px-6 bg-gray-50 space-y-3">
              {hasSummary && (
                <div data-testid="otp-summary">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">L'essentiel en {summary.length} points</p>
                  <ol className="space-y-2">
                    {summary.map((line, i) => (
                      <li key={line} className="flex gap-3 text-sm text-gray-800 leading-relaxed">
                        <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-navy text-white text-xs font-bold tabular" aria-hidden="true">{i + 1}</span>
                        <span className="min-w-0 break-words">{line}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {hasDocument && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{hasSummary ? 'Texte intégral' : '1. Lisez le document'}</p>
                    {hasSummary && (
                      <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        aria-expanded={expanded}
                        aria-controls="otp-document"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded"
                        data-testid="otp-toggle-document"
                      >
                        {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
                        {expanded ? 'Replier le texte' : 'Lire le texte intégral'}
                      </button>
                    )}
                  </div>
                  {expanded ? (
                    <div
                      id="otp-document"
                      ref={docRef}
                      onScroll={checkScrolled}
                      className="bg-white border rounded-xl p-4 sm:p-6 max-h-[40vh] overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                      tabIndex={DOC_TABINDEX}
                      aria-label="Texte du document à signer"
                      data-testid="otp-document"
                    >
                      <pre className="whitespace-pre-wrap break-words text-sm font-serif leading-relaxed text-gray-800">{documentText}</pre>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600" id="otp-document">La lecture du texte intégral est nécessaire avant de signer.</p>
                  )}
                  {expanded && !readToEnd && (
                    <p className="flex items-center gap-2 text-sm text-gray-600 mt-2" data-testid="otp-scroll-hint">
                      <ArrowDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Faites défiler le texte jusqu'à la fin pour pouvoir cocher la case d'acceptation.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 sm:px-6 space-y-4">
              {extraContent}

              <div className="flex items-start gap-3">
                <Checkbox
                  id="otp-accept"
                  checked={accepted}
                  disabled={!canAccept}
                  onCheckedChange={(v) => setAccepted(v === true)}
                  className="mt-0.5"
                  data-testid="otp-accept"
                />
                <label htmlFor="otp-accept" className={`text-sm cursor-pointer ${canAccept ? 'text-gray-700' : 'text-gray-500'}`}>{acceptLabel}{testMode && <span className="block mt-1 text-brand-amber font-medium" data-testid="otp-test-notice">Mode test : document de test, sans valeur juridique.</span>}</label>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">{hasSummary ? 'Confirmez avec votre code' : '2. Confirmez avec votre code'}</p>
                {!sent ? (
                  <Button
                    type="button"
                    onClick={requestCode}
                    disabled={!accepted || !canRequest || requesting || cooldown > 0}
                    className="w-full sm:w-auto rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white h-auto min-h-10 whitespace-normal"
                    data-testid="otp-request"
                  >
                    {requesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2 shrink-0" />}
                    {cooldown > 0 ? `Nouvel essai possible dans ${cooldown} s` : 'Recevoir mon code de signature par e-mail'}
                  </Button>
                ) : (
                  <form onSubmit={sign} className="space-y-3">
                    <p className="text-sm text-gray-700" data-testid="otp-sent">
                      Un code à 6 chiffres a été envoyé à <strong className="break-words">{sent.destination}</strong>
                      {expiresMin ? `. Il est valable ${expiresMin} minutes.` : '.'}
                    </p>
                    {sent.test_code && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-brand-amber/40 bg-brand-amber-soft px-3 py-2 text-sm text-brand-navy" data-testid="otp-test-code">
                        <FlaskConical className="w-4 h-4 shrink-0 text-brand-amber" aria-hidden="true" />
                        <span>Code (mode test) : <strong className="font-mono tracking-widest">{sent.test_code}</strong></span>
                        <button
                          type="button"
                          onClick={() => { setCode(sent.test_code); codeRef.current?.focus(); }}
                          className="rounded-lg border border-brand-navy bg-white px-3 py-1 font-semibold text-brand-navy hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                          data-testid="otp-test-fill"
                        >
                          Remplir
                        </button>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                      <div className="sm:w-48">
                        <label htmlFor="otp-code" className="block text-sm font-medium text-gray-700 mb-1">Code de signature</label>
                        <input
                          ref={codeRef}
                          id="otp-code"
                          name="otp-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="w-full h-11 rounded-xl border border-gray-300 px-3 text-center text-lg tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
                          placeholder="••••••"
                          data-testid="otp-code"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={code.length !== 6 || signing || !accepted || !canRequest}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white h-11"
                        data-testid="otp-sign"
                      >
                        {signing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenTool className="w-4 h-4 mr-2" />}
                        {signLabel}
                      </Button>
                    </div>
                    <button
                      type="button"
                      onClick={requestCode}
                      disabled={cooldown > 0 || requesting}
                      className="text-sm text-brand-blue hover:underline disabled:text-gray-400 disabled:no-underline"
                      data-testid="otp-resend"
                    >
                      {cooldown > 0 ? `Renvoyer le code (dans ${cooldown} s)` : 'Renvoyer le code'}
                    </button>
                  </form>
                )}
                {!canRequest && (
                  <p className="text-sm text-amber-800 mt-3">Complétez les informations ci-dessus pour pouvoir signer.</p>
                )}
                {error && (
                  <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3" role="alert" data-testid="otp-error">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </p>
                )}
              </div>

              <p className="flex items-start gap-2 text-sm text-gray-600">
                <ShieldCheck className="w-4 h-4 shrink-0 text-gray-500" aria-hidden="true" />
                <span>Signature électronique par code à usage unique envoyé à votre adresse confirmée. Dossier de preuve conservé dix ans : empreinte du document, date et heure, adresse IP, navigateur, identité vérifiée.</span>
              </p>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default OtpSignatureDialog;

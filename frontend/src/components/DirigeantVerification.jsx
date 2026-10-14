import { useState, useEffect } from "react";
import { axiosInstance } from "@/App";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/components/account/errors";
import {
  User,
  Mail,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserPlus,
  Building2,
  Shield,
  BadgeCheck,
} from "lucide-react";

// Contrôle « dirigeant » sur les bases publiques (SPEC §2.3 et §4.4) : GET /property/{siren}/dirigeants et
// POST /property/{siren}/verify-dirigeant → status ∈ match_exact | match_partial | no_match | unavailable (+ reason,
// message, president, can_invite_president). Ce n'est PLUS une condition de publication : c'est un badge et un
// drapeau de post-modération. Le signataire déclare sa qualité à la signature du mandat ; l'invitation du
// dirigeant reste possible pour qu'il signe lui-même.

// Dirigeants lus sur les bases publiques
export function DirigeantsDisplay({ dirigeants, president, onSelectDirigeant }) {
  if (!dirigeants || dirigeants.length === 0) {
    return (
      <div className="p-4 bg-brand-surface border border-brand-line rounded-lg">
        <p className="text-gray-700 text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-brand-amber" aria-hidden="true" />
          Dirigeants non disponibles sur les bases publiques pour cette entreprise. Ce n'est pas bloquant.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Dirigeants enregistrés (bases publiques)</Label>
      <div className="grid gap-2">
        {dirigeants.map((dirigeant, index) => {
          const isPresident = president && president.nom === dirigeant.nom;
          return (
            <div
              key={index}
              className={`p-3 border rounded-lg flex items-center justify-between gap-3 min-w-0 ${isPresident ? 'border-brand-green bg-brand-green-soft' : 'border-brand-line'}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-full shrink-0 ${dirigeant.type_personne === 'morale' ? 'bg-brand-blue-soft' : 'bg-brand-surface'}`}>
                  {dirigeant.type_personne === 'morale' ? (
                    <Building2 className="h-4 w-4 text-brand-blue" aria-hidden="true" />
                  ) : (
                    <User className="h-4 w-4 text-gray-600" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium break-words">{dirigeant.nom_complet || `${dirigeant.prenom || ''} ${dirigeant.nom || ''}`.trim()}</p>
                  <p className="text-sm text-gray-500">{dirigeant.qualite}</p>
                </div>
              </div>
              {onSelectDirigeant && dirigeant.type_personne !== 'morale' && (
                <Button variant="outline" size="sm" onClick={() => onSelectDirigeant(dirigeant)} className="shrink-0">
                  <Mail className="h-4 w-4 mr-1" aria-hidden="true" />
                  Inviter
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_TEXT = {
  match_partial: 'Votre nom correspond partiellement à un dirigeant enregistré.',
  no_match: 'Votre nom ne correspond à aucun dirigeant enregistré sur les bases publiques.',
  unavailable: 'Vérification différée : les bases publiques n\'ont pas répondu.',
};

// Résultat du contrôle : badge, jamais un blocage
export function VerificationDirigeantStatus({ verificationResult }) {
  if (!verificationResult) return null;

  if (verificationResult.verified || verificationResult.status === 'match_exact') {
    return (
      <div className="p-4 bg-brand-green-soft border border-brand-green/30 rounded-lg" data-testid="dirigeant-status-verified">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-brand-green shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-brand-green-dark flex flex-wrap items-center gap-2">
              Dirigeant reconnu
              <span className="badge badge-verified"><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />Badge dirigeant</span>
            </p>
            <p className="text-sm text-brand-green-dark">
              Vous êtes enregistré comme {verificationResult.matched_as || 'dirigeant'} de cette entreprise sur les bases publiques.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const unavailable = verificationResult.status === 'unavailable';
  const Icon = unavailable ? Clock : AlertTriangle;
  const presidentName = verificationResult.president
    ? (verificationResult.president.nom_complet || `${verificationResult.president.prenom || ''} ${verificationResult.president.nom || ''}`.trim())
    : '';

  return (
    <div className="p-4 bg-brand-amber-soft border border-brand-amber/30 rounded-lg" data-testid="dirigeant-status-unverified">
      <div className="flex items-start gap-3">
        <Icon className="h-6 w-6 text-brand-amber flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-brand-navy">
            {unavailable ? 'Contrôle dirigeant différé' : 'Vous n\'apparaissez pas comme dirigeant sur les bases publiques'}
          </p>
          <p className="text-sm text-gray-700 mt-1 leading-relaxed">
            {verificationResult.message || STATUS_TEXT[verificationResult.status] || STATUS_TEXT.no_match}
          </p>
          <p className="text-sm text-gray-700 mt-2 leading-relaxed">
            Ce n'est pas bloquant : à la signature du mandat, vous déclarez votre qualité (dirigeant, associé ou mandataire des
            associés). Si vous préférez que le dirigeant signe lui-même, invitez-le.
          </p>
          {presidentName && (
            <p className="text-sm text-gray-700 mt-2 break-words">
              <strong>Dirigeant enregistré :</strong> {presidentName}{verificationResult.president.qualite ? ` (${verificationResult.president.qualite})` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Invitation du dirigeant : il crée son compte, vérifie son identité et signe lui-même le mandat
export function InvitePresidentModal({
  propertyId,
  dirigeants = [],
  president,
  isOpen,
  onClose,
  onSuccess,
}) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    president_firstname: president?.prenom || "",
    president_lastname: president?.nom || "",
    president_email: "",
    president_phone: "",
    message: "",
  });

  useEffect(() => {
    if (isOpen && president) {
      setFormData((prev) => ({
        ...prev,
        president_firstname: prev.president_firstname || president.prenom || "",
        president_lastname: prev.president_lastname || president.nom || "",
      }));
    }
  }, [president, isOpen]);

  const handleSelectDirigeant = (dirigeant) => {
    setFormData((prev) => ({
      ...prev,
      president_firstname: dirigeant.prenom || "",
      president_lastname: dirigeant.nom || "",
    }));
  };

  const handleSubmit = async () => {
    if (!formData.president_firstname || !formData.president_lastname || !formData.president_email) {
      toast.error("Indiquez le prénom, le nom et l'e-mail du dirigeant.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.president_email)) {
      toast.error("Indiquez une adresse e-mail valide.");
      return;
    }

    setLoading(true);
    try {
      await axiosInstance.post(`/listings/${propertyId}/invite-president`, {
        property_id: propertyId,
        ...formData,
      });
      toast.success(`Invitation envoyée à ${formData.president_email}. Le dirigeant signera lui-même le mandat de vente.`);
      if (onSuccess) {
        onSuccess();
      } else {
        onClose();
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, "L'invitation n'a pas pu être envoyée."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            Inviter le dirigeant à signer le mandat
          </DialogTitle>
          <DialogDescription>
            Le dirigeant reçoit un lien pour créer son compte, vérifier son identité et signer lui-même le mandat de vente.
            Vous gardez la main sur l'annonce.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {dirigeants.length > 0 && (
            <div className="mb-4">
              <Label className="text-sm text-gray-500">Sélectionner un dirigeant</Label>
              <div className="grid gap-2 mt-2">
                {dirigeants.filter((d) => d.type_personne !== 'morale').map((dirigeant, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSelectDirigeant(dirigeant)}
                    className={`p-2 border rounded-lg text-left hover:bg-brand-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
                      formData.president_firstname === dirigeant.prenom && formData.president_lastname === dirigeant.nom
                        ? 'border-brand-navy bg-brand-surface'
                        : 'border-brand-line'
                    }`}
                  >
                    <p className="font-medium text-sm">{dirigeant.prenom} {dirigeant.nom}</p>
                    <p className="text-xs text-gray-500">{dirigeant.qualite}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="president_firstname">Prénom *</Label>
              <Input id="president_firstname" value={formData.president_firstname}
                onChange={(e) => setFormData((prev) => ({ ...prev, president_firstname: e.target.value }))} placeholder="Jean" />
            </div>
            <div>
              <Label htmlFor="president_lastname">Nom *</Label>
              <Input id="president_lastname" value={formData.president_lastname}
                onChange={(e) => setFormData((prev) => ({ ...prev, president_lastname: e.target.value }))} placeholder="Dupont" />
            </div>
          </div>

          <div>
            <Label htmlFor="president_email">E-mail *</Label>
            <Input id="president_email" type="email" value={formData.president_email}
              onChange={(e) => setFormData((prev) => ({ ...prev, president_email: e.target.value }))} placeholder="dirigeant@entreprise.fr" />
          </div>

          <div>
            <Label htmlFor="president_phone">Téléphone (facultatif)</Label>
            <Input id="president_phone" type="tel" value={formData.president_phone}
              onChange={(e) => setFormData((prev) => ({ ...prev, president_phone: e.target.value }))} placeholder="06 12 34 56 78" />
          </div>

          <div>
            <Label htmlFor="message">Message personnalisé (facultatif)</Label>
            <Textarea id="message" value={formData.message}
              onChange={(e) => setFormData((prev) => ({ ...prev, message: e.target.value }))}
              placeholder="Bonjour, je prépare la cession de notre entreprise et je vous propose de signer le mandat de vente…" rows={3} />
          </div>

          <div className="p-3 bg-brand-surface border border-brand-line rounded-lg">
            <p className="text-sm text-gray-700">
              <Shield className="h-4 w-4 inline mr-2 text-brand-navy" aria-hidden="true" />
              Rien n'est publié avant la signature du mandat. L'invitation est valable 7 jours.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-brand-navy hover:bg-brand-navy-light">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : <Send className="h-4 w-4 mr-2" aria-hidden="true" />}
            Envoyer l'invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Hook : lecture des dirigeants et contrôle de l'utilisateur
export function useDirigeantVerification() {
  const [loading, setLoading] = useState(false);
  const [dirigeantsData, setDirigeants] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null);

  const loadDirigeants = async (siren) => {
    if (!siren || siren.length < 9) return null;
    setLoading(true);
    try {
      const sirenClean = siren.replace(/\s/g, '').substring(0, 9);
      const response = await axiosInstance.get(`/property/${sirenClean}/dirigeants`);
      setDirigeants(response.data);
      return response.data;
    } catch (err) {
      setDirigeants({ dirigeants: [], status: 'unavailable', message: apiErrorMessage(err, STATUS_TEXT.unavailable) });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const verifyUserIsDirigeant = async (siren) => {
    if (!siren || siren.length < 9) return null;
    setLoading(true);
    try {
      const sirenClean = siren.replace(/\s/g, '').substring(0, 9);
      const response = await axiosInstance.post(`/property/${sirenClean}/verify-dirigeant`);
      setVerificationResult(response.data);
      return response.data;
    } catch (err) {
      const result = { verified: false, status: 'unavailable', reason: 'api_unavailable', message: apiErrorMessage(err, STATUS_TEXT.unavailable) };
      setVerificationResult(result);
      return result;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    dirigeantsData,
    verificationResult,
    loadDirigeants,
    verifyUserIsDirigeant,
    setDirigeants,
    setVerificationResult,
  };
}

export default {
  DirigeantsDisplay,
  VerificationDirigeantStatus,
  InvitePresidentModal,
  useDirigeantVerification,
};

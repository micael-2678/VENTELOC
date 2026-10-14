import { useCallback, useRef, useState } from 'react';
import { axiosInstance } from '@/App';

// SIRET : 14 chiffres, saisie tolérante aux espaces ; affichage « 123 456 789 00012 ».
export const cleanSiret = (value) => String(value == null ? '' : value).replace(/\D/g, '').slice(0, 14);
export const cleanSiren = (value) => String(value == null ? '' : value).replace(/\D/g, '').slice(0, 9);
export const formatSiret = (value) => {
  const d = cleanSiret(value);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9)].filter(Boolean).join(' ');
};
export const formatSiren = (value) => {
  const d = cleanSiren(value);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ');
};
export const isSiret = (value) => cleanSiret(value).length === 14;
export const isSiren = (value) => cleanSiren(value).length === 9;

const text = (v) => (v == null ? '' : String(v)).trim();

// Réponse de GET /estimates/property/{siret} → forme stable pour les pages (les deux variantes de nommage de l'API
// sont acceptées : company_name / nom_complet, naf_code / naf, staff_label / tranche_effectif…).
export const normalizeCompanyLookup = (data, siret) => {
  const c = (data && data.property) || {};
  const r = (data && data.rge) || {};
  const details = Array.isArray(r.details) ? r.details : [];
  const names = Array.isArray(r.qualifications) ? r.qualifications : [];
  const qualifications = details.length
    ? details.map((d) => ({
      name: text(d.nom_qualification || d.name),
      organisme: text(d.organisme || d.organisme_label),
      domaine: text(d.domaine || d.meta_domaine),
      dateDebut: d.lien_date_debut || d.date_debut || null,
      dateFin: d.lien_date_fin || d.date_fin || null,
      certificat: text(d.nom_certificat || d.certificat),
    })).filter((q) => q.name)
    : names.map((n) => ({ name: text(n), organisme: '', domaine: '', dateDebut: null, dateFin: null, certificat: '' }));
  return {
    siret: cleanSiret((data && data.siret) || siret),
    siren: cleanSiren((data && data.siren) || c.siren || siret),
    property: {
      available: c.available !== false,
      found: c.found === true || (!!text(c.company_name || c.nom_complet) && c.found !== false),
      message: text(c.message),
      name: text(c.company_name || c.nom_complet),
      naf: text(c.naf_code || c.naf),
      nafLabel: text(c.naf_label || c.naf_libelle),
      nafInBuilding: c.naf_in_building,
      creationDate: text(c.creation_date || c.date_creation),
      staffCount: Number.isFinite(Number(c.staff_count)) && c.staff_count !== null && c.staff_count !== '' ? Number(c.staff_count) : null,
      staffLabel: text(c.staff_label || c.tranche_effectif),
      department: text(c.department || c.departement),
      departmentLabel: text(c.department_label || c.departement_libelle),
      region: text(c.region),
      legalStructure: text(c.legal_structure),
      formeJuridique: text(c.forme_juridique),
      trades: Array.isArray(c.trades) ? c.trades : [],
      etat: text(c.etat),
      sirenActive: c.siren_active,
    },
    rge: {
      available: r.available !== false,
      found: r.found === true || qualifications.length > 0,
      message: text(r.message),
      qualifications,
      organismes: Array.isArray(r.organismes) ? r.organismes : [],
      domaines: Array.isArray(r.domaines) ? r.domaines : [],
      verifiedAt: r.verified_at || null,
    },
  };
};

// Recherche d'une entreprise par SIRET (open data + ADEME), jamais bloquante.
// status : idle | loading | found | not_found | unavailable | invalid
export const useCompanyLookup = () => {
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const seq = useRef(0);

  const reset = useCallback(() => {
    seq.current += 1;
    setStatus('idle');
    setResult(null);
    setMessage('');
  }, []);

  const lookup = useCallback(async (value) => {
    const siret = cleanSiret(value);
    if (siret.length !== 14) {
      setStatus('invalid');
      setMessage('Un SIRET compte 14 chiffres.');
      setResult(null);
      return null;
    }
    const mine = ++seq.current;
    setStatus('loading');
    setMessage('');
    try {
      const res = await axiosInstance.get(`/estimates/property/${siret}`);
      if (mine !== seq.current) return null;
      const data = normalizeCompanyLookup(res.data, siret);
      setResult(data);
      if (!data.property.available) {
        setStatus('unavailable');
        setMessage(data.property.message || "Vérification différée : l'annuaire des entreprises n'a pas répondu, vous pouvez continuer.");
      } else if (!data.property.found) {
        setStatus('not_found');
        setMessage(data.property.message || "Ce SIRET est inconnu de l'annuaire des entreprises. Vérifiez le numéro ; vous pouvez continuer sans.");
      } else {
        setStatus('found');
      }
      return data;
    } catch (error) {
      if (mine !== seq.current) return null;
      const detail = error?.response?.data?.detail;
      if (error?.response?.status === 400 && typeof detail === 'string') {
        setStatus('invalid');
        setMessage(detail);
        setResult(null);
        return null;
      }
      const data = normalizeCompanyLookup({ property: { available: false }, rge: { available: false } }, siret);
      setResult(data);
      setStatus('unavailable');
      setMessage("Vérification différée : l'annuaire des entreprises n'a pas répondu, vous pouvez continuer.");
      return data;
    }
  }, []);

  return { status, result, message, lookup, reset };
};

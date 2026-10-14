import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Briefcase, Building, Building2, Car, Home, Hotel, KeyRound, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { propertyTypeLabel } from '@/lib/referentiels';

// Visuel d'un bien : première photo publique de l'annonce, sinon pictogramme du type de bien sur fond clair.
// Photos (API.md §2) : `photos: [{id, url?…}]` dans l'annonce ; le contenu est servi par
// GET /properties/{id}/photos/{photo_id} → {content (base64), content_type}, ou par `url` si l'API en fournit une.
// Requête sans jeton (axios nu), différée jusqu'à l'apparition de la carte à l'écran (IntersectionObserver).

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');

export const PROPERTY_ICONS = {
  appartement: Building2,
  maison: Home,
  immeuble: Building,
  'residence-geree': Hotel,
  'local-commercial': Store,
  bureaux: Briefcase,
  parking: Car,
  autre: KeyRound,
};

export const PropertyPicto = ({ type, className = '', iconClassName = 'w-10 h-10' }) => {
  const Icon = PROPERTY_ICONS[type] || KeyRound;
  return (
    <div className={cn('flex items-center justify-center bg-gradient-to-br from-brand-teal-soft to-brand-surface text-brand-teal/70', className)} data-testid="property-picto">
      <Icon className={iconClassName} aria-hidden="true" strokeWidth={1.5} />
      <span className="sr-only">{propertyTypeLabel(type) || 'Bien loué'}, sans photo</span>
    </div>
  );
};

const cache = new Map();

export const firstPhoto = (property) => {
  const list = Array.isArray(property?.photos) ? property.photos : [];
  return list.find((p) => p && (p.visibility === undefined || p.visibility === 'public') && (p.id || p.url)) || null;
};

export const loadPhoto = async (propertyId, photo) => {
  if (!photo) return '';
  if (photo.url) return String(photo.url);
  const key = `${propertyId}/${photo.id}`;
  if (cache.has(key)) return cache.get(key);
  const res = await axios.get(`${BACKEND_URL}/api/properties/${propertyId}/photos/${photo.id}`);
  const { content, content_type: type } = res.data || {};
  const src = content ? `data:${type || 'image/jpeg'};base64,${content}` : '';
  cache.set(key, src);
  return src;
};

const PropertyPhoto = ({ property, className = '', iconClassName, alt }) => {
  const photo = firstPhoto(property);
  const [src, setSrc] = useState(() => (photo && cache.get(`${property?.id}/${photo.id}`)) || (photo?.url ? String(photo.url) : ''));
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const ref = useRef(null);
  const photoKey = photo ? `${property.id}/${photo.id || photo.url}` : '';

  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!photoKey || !visible || src) return undefined;
    let alive = true;
    loadPhoto(property.id, photo).then((s) => { if (alive && s) setSrc(s); }).catch(() => {});
    return () => { alive = false; };
  }, [photoKey, visible]);

  return (
    <div ref={ref} className={cn('relative overflow-hidden bg-brand-surface', className)}>
      {src ? (
        <img src={src} alt={alt || propertyTypeLabel(property?.property_type) || 'Bien loué'} className="absolute inset-0 w-full h-full object-cover" loading="lazy" data-testid="property-photo" />
      ) : (
        <PropertyPicto type={property?.property_type} className="absolute inset-0" iconClassName={iconClassName} />
      )}
    </div>
  );
};

export default PropertyPhoto;

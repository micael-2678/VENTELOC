// Jeu de données des parcours Playwright, créé par l'API du backend de test (e2e_server.py déjà démarré) :
// admin connecté (code reçu par e-mail), deux vendeurs, deux biens publiés (justificatif, identité, mandat signé).
// Écrit SEED_FILE : {admin, seller, seller2, property_id, property_address}.
// Usage : EMAILS_FILE=… SEED_FILE=… NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/harness/seed.js
const fs = require('fs');
const L = require('../lib');

const PASSWORD = 'Test1234!';
const register = async (email, first, last) => {
  const r = await L.api('POST', '/auth/register', { body: { email, password: PASSWORD, role: 'seller', first_name: first, last_name: last, phone: '06 12 34 56 78' } });
  if (r.status !== 200) throw new Error(`register ${email} ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.user };
};

(async () => {
  const stamp = Date.now();
  const admin = await L.login(process.env.ADMIN_EMAIL || 'admin@exemple.fr', process.env.ADMIN_PASSWORD || 'AdminTest123!');
  if (!admin || !admin.token) throw new Error('connexion admin impossible');
  const seller = await register(`vendeur.${stamp}@exemple.fr`, 'Michel', 'Dupont');
  const seller2 = await register(`vendeur2.${stamp}@exemple.fr`, 'Sophie', 'Bernard');
  const published = await L.publishProperty(seller, { address: `${12 + (stamp % 80)} rue de la Paix`, city: 'Lyon', postal_code: '69007', asking_price: 145000, rent_monthly: 640 });
  if (published.listing_status !== 'published') throw new Error(`bien non publié : ${JSON.stringify(published)}`);
  // Deuxième bien (maison, rendement plus élevé) pour les contrôles de liste, de tri et de filtres
  const second = await L.publishProperty(seller, { property_type: 'maison', address: `${3 + (stamp % 50)} allée des Tilleuls`, city: 'Nantes', postal_code: '44300',
    surface: 92, rooms: 4, floor: null, is_copro: false, copro_lots: null, copro_charges_annual: null, asking_price: 228000, rent_monthly: 1190, deposit: 1190 });
  if (second.listing_status !== 'published') throw new Error(`deuxième bien non publié : ${JSON.stringify(second)}`);
  const data = { admin, seller, seller2, property_id: published.id, property_address: published.address };
  fs.writeFileSync(L.SEED_FILE, JSON.stringify(data, null, 1));
  console.log(`jeu de données écrit dans ${L.SEED_FILE} (bien ${published.id})`);
})().catch((e) => { console.error(e); process.exit(1); });
